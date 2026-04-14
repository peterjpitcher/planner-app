import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

// Inline defaults — will be replaced by PLANNING_DEFAULTS from constants.js once that export is available
const DEFAULTS = {
  daily_plan_start: '20:05',
  daily_plan_end: '20:00',
  weekly_plan_start: '20:05',
  weekly_plan_end: '20:00',
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
      .select('daily_plan_start, daily_plan_end, weekly_plan_start, weekly_plan_end')
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (error) {
      console.error('User settings lookup error:', error);
      return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
    }

    // Return saved settings or defaults (don't create a row)
    return NextResponse.json({
      data: data || {
        daily_plan_start: DEFAULTS.daily_plan_start,
        daily_plan_end: DEFAULTS.daily_plan_end,
        weekly_plan_start: DEFAULTS.weekly_plan_start,
        weekly_plan_end: DEFAULTS.weekly_plan_end,
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
    const { daily_plan_start, daily_plan_end, weekly_plan_start, weekly_plan_end } = body;

    // Validate all four fields
    const fields = { daily_plan_start, daily_plan_end, weekly_plan_start, weekly_plan_end };
    const errors = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue; // allow partial updates
      if (typeof value !== 'string' || !TIME_REGEX.test(value)) {
        errors[key] = 'Must be a valid time in HH:MM format (00:00 to 23:59)';
      }
    }

    // Check start != end for daily and weekly pairs
    const effectiveDaily = {
      start: daily_plan_start || DEFAULTS.daily_plan_start,
      end: daily_plan_end || DEFAULTS.daily_plan_end,
    };
    const effectiveWeekly = {
      start: weekly_plan_start || DEFAULTS.weekly_plan_start,
      end: weekly_plan_end || DEFAULTS.weekly_plan_end,
    };
    if (effectiveDaily.start === effectiveDaily.end) {
      errors.daily_plan_start = 'Start and end times cannot be the same';
    }
    if (effectiveWeekly.start === effectiveWeekly.end) {
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

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const supabase = getSupabaseServiceRole();
    const { data, error } = await supabase
      .from('user_settings')
      .upsert(
        {
          user_id: session.user.id,
          ...updates,
        },
        { onConflict: 'user_id' }
      )
      .select('daily_plan_start, daily_plan_end, weekly_plan_start, weekly_plan_end')
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
