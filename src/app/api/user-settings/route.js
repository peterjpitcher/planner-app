import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';
import { PLANNING_DEFAULTS, AUTOPILOT_LEVEL } from '@/lib/constants';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const AUTOPILOT_LEVELS = Object.values(AUTOPILOT_LEVEL); // ['off','review','auto']

// Columns returned by GET/PATCH. autopilot_level (A3) defaults to 'off';
// digest_enabled (Wave 4) defaults to true (DB column is NOT NULL DEFAULT true);
// ai_planning_enabled (A5) defaults to false (DB column is NOT NULL DEFAULT false).
const SETTINGS_SELECT =
  'daily_plan_start, daily_plan_end, weekly_plan_start, weekly_plan_end, autopilot_level, digest_enabled, ai_planning_enabled';

const DEFAULTS = {
  daily_plan_start: PLANNING_DEFAULTS.DAILY_START,
  daily_plan_end: PLANNING_DEFAULTS.DAILY_END,
  weekly_plan_start: PLANNING_DEFAULTS.WEEKLY_START,
  weekly_plan_end: PLANNING_DEFAULTS.WEEKLY_END,
  autopilot_level: AUTOPILOT_LEVEL.OFF,
  digest_enabled: true,
  ai_planning_enabled: false,
};

// GET /api/user-settings — returns user's planning settings or defaults
export async function GET(request) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabaseServiceRole();
    const { data, error } = await supabase
      .from('user_settings')
      .select(SETTINGS_SELECT)
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (error) {
      console.error('User settings lookup error:', error);
      return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
    }

    // Return saved settings or defaults (don't create a row). A row that predates
    // the autopilot column still reads back the DB default, but guard here too.
    return NextResponse.json({
      data: data
        ? {
            ...data,
            autopilot_level: data.autopilot_level || DEFAULTS.autopilot_level,
            // A row that predates the digest_enabled column reads back the DB
            // default (true); guard here too so null/undefined never leaks out.
            digest_enabled: data.digest_enabled ?? DEFAULTS.digest_enabled,
            // A5: same guard so a null/undefined never leaks out as the AI flag.
            ai_planning_enabled: data.ai_planning_enabled ?? DEFAULTS.ai_planning_enabled,
          }
        : {
            daily_plan_start: DEFAULTS.daily_plan_start,
            daily_plan_end: DEFAULTS.daily_plan_end,
            weekly_plan_start: DEFAULTS.weekly_plan_start,
            weekly_plan_end: DEFAULTS.weekly_plan_end,
            autopilot_level: DEFAULTS.autopilot_level,
            digest_enabled: DEFAULTS.digest_enabled,
            ai_planning_enabled: DEFAULTS.ai_planning_enabled,
          },
    });
  } catch (err) {
    console.error('User settings GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH /api/user-settings — update planning window times
export async function PATCH(request) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { daily_plan_start, daily_plan_end, weekly_plan_start, weekly_plan_end, autopilot_level, digest_enabled, ai_planning_enabled } = body;

    const supabase = getSupabaseServiceRole();

    // Fetch the user's existing settings so cross-field validation (start !=
    // end) checks provided values against what is actually stored, not
    // hardcoded defaults — otherwise a partial update merged over stale
    // defaults could persist a zero-length planning window (FF-055).
    const { data: existingSettings, error: fetchError } = await supabase
      .from('user_settings')
      .select('daily_plan_start, daily_plan_end, weekly_plan_start, weekly_plan_end')
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (fetchError) {
      console.error('User settings lookup error:', fetchError);
      return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
    }

    const storedSettings = existingSettings || DEFAULTS;

    // Validate all four time fields
    const fields = { daily_plan_start, daily_plan_end, weekly_plan_start, weekly_plan_end };
    const errors = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue; // allow partial updates
      if (typeof value !== 'string' || !TIME_REGEX.test(value)) {
        errors[key] = 'Must be a valid time in HH:MM format (00:00 to 23:59)';
      }
    }

    // Validate autopilot_level (A3) — one of the three allowed levels.
    if (autopilot_level !== undefined && !AUTOPILOT_LEVELS.includes(autopilot_level)) {
      errors.autopilot_level = `Must be one of: ${AUTOPILOT_LEVELS.join(', ')}`;
    }

    // Validate digest_enabled (Wave 4) — must be a boolean when provided.
    if (digest_enabled !== undefined && typeof digest_enabled !== 'boolean') {
      errors.digest_enabled = 'Must be a boolean (true or false)';
    }

    // Validate ai_planning_enabled (A5) — must be a boolean when provided.
    if (ai_planning_enabled !== undefined && typeof ai_planning_enabled !== 'boolean') {
      errors.ai_planning_enabled = 'Must be a boolean (true or false)';
    }

    // Check start != end for daily and weekly pairs, merging provided values
    // over the user's stored settings (falling back to defaults only when no
    // row exists yet). Stored values may be 'HH:MM:SS' (Postgres TIME) while
    // provided values are 'HH:MM', so normalise both sides to HH:MM before the
    // equality comparison — otherwise a zero-length window could slip through.
    const toHM = (t) => (t || '').slice(0, 5);
    const effectiveDaily = {
      start: daily_plan_start !== undefined ? daily_plan_start : storedSettings.daily_plan_start,
      end: daily_plan_end !== undefined ? daily_plan_end : storedSettings.daily_plan_end,
    };
    const effectiveWeekly = {
      start: weekly_plan_start !== undefined ? weekly_plan_start : storedSettings.weekly_plan_start,
      end: weekly_plan_end !== undefined ? weekly_plan_end : storedSettings.weekly_plan_end,
    };
    if (toHM(effectiveDaily.start) === toHM(effectiveDaily.end)) {
      errors.daily_plan_start = 'Start and end times cannot be the same';
    }
    if (toHM(effectiveWeekly.start) === toHM(effectiveWeekly.end)) {
      errors.weekly_plan_start = 'Start and end times cannot be the same';
    }

    if (Object.keys(errors).length > 0) {
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 });
    }

    // Build update object with only provided fields
    const updates = {};
    if (daily_plan_start !== undefined) updates.daily_plan_start = daily_plan_start;
    if (daily_plan_end !== undefined) updates.daily_plan_end = daily_plan_end;
    if (weekly_plan_start !== undefined) updates.weekly_plan_start = weekly_plan_start;
    if (weekly_plan_end !== undefined) updates.weekly_plan_end = weekly_plan_end;
    if (autopilot_level !== undefined) updates.autopilot_level = autopilot_level;
    if (digest_enabled !== undefined) updates.digest_enabled = digest_enabled;
    if (ai_planning_enabled !== undefined) updates.ai_planning_enabled = ai_planning_enabled;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('user_settings')
      .upsert(
        {
          user_id: session.user.id,
          ...updates,
        },
        { onConflict: 'user_id' }
      )
      .select(SETTINGS_SELECT)
      .single();

    if (error) {
      console.error('User settings update error:', error);
      return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error('User settings PATCH error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
