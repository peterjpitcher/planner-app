import { NextResponse } from 'next/server';
import { verifyCronAuth, claimCronRun, updateCronRun } from '@/lib/cronAuth';
import { getTimeZoneParts, LONDON_TIME_ZONE, getLondonDateKey } from '@/lib/timezone';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { resolveDigestUserId } from '@/services/dailyTaskEmailService';
import { buildAutopilotPlan } from '@/services/autopilotService';
import { AUTOPILOT_LEVEL } from '@/lib/constants';

// A3 — Morning Autopilot cron. When enabled and the user has NOT already planned
// today, build today's plan (F1 ranking + soft caps) so the 08:00 digest reflects
// a built day. Off by default. Mirrors the demote/email cron's auth + exact
// London-hour gate + claimCronRun idempotency.
export async function GET(request) {
  try {
    const auth = verifyCronAuth(request);
    if (!auth.authorized) {
      const msg = auth.status === 401 ? 'Unauthorized' : 'Forbidden';
      return NextResponse.json({ error: msg }, { status: auth.status });
    }

    // Fire only at exactly 05:00 London year-round, before the 08:00 digest.
    // Paired with dual UTC cron schedules (0 4 + 0 5) in vercel.json so one run
    // lands at 05:00 London in both GMT and BST; the other lands at 04:00/06:00
    // London and is gated out here (mirrors the demote cron's exact-hour gate).
    const londonParts = getTimeZoneParts(new Date(), LONDON_TIME_ZONE);
    if (!auth.force && londonParts.hour !== 5) {
      return NextResponse.json({ skipped: true, reason: 'outside_window' }, { status: 200 });
    }

    const supabase = getSupabaseServiceRole();
    const runDate = getLondonDateKey();

    // Idempotency claim (skipped on dry run so it doesn't block the real cron).
    let runId = null;
    if (!auth.dryRun) {
      const claim = await claimCronRun({ supabase, operation: 'morning-autopilot', runDate });
      if (!claim.claimed) {
        return NextResponse.json({ skipped: true, reason: claim.reason }, { status: 200 });
      }
      runId = claim.runId;
    }

    const digestUserEmail = (
      process.env.DIGEST_USER_EMAIL ||
      process.env.DAILY_TASK_EMAIL_TO ||
      process.env.MICROSOFT_USER_EMAIL ||
      ''
    ).trim();
    let userId;
    try {
      userId = await resolveDigestUserId({ supabase, email: digestUserEmail });
    } catch (err) {
      try { await updateCronRun({ supabase, runId, patch: { status: 'failed', error: String(err.message) } }); } catch {}
      throw err;
    }

    // Trust control: autopilot is off by default. No row → treat as 'off'.
    // ai_planning_enabled (A5) is likewise opt-in; when true the plan is drafted
    // by the AI first, falling back to the rules on any failure.
    const { data: settings, error: settingsError } = await supabase
      .from('user_settings')
      .select('autopilot_level, ai_planning_enabled')
      .eq('user_id', userId)
      .maybeSingle();
    if (settingsError) {
      try { await updateCronRun({ supabase, runId, patch: { status: 'failed', error: String(settingsError.message) } }); } catch {}
      throw settingsError;
    }
    const level = settings?.autopilot_level || AUTOPILOT_LEVEL.OFF;
    if (level === AUTOPILOT_LEVEL.OFF) {
      try { await updateCronRun({ supabase, runId, patch: { tasks_affected: 0, status: 'success' } }); } catch {}
      return NextResponse.json({ skipped: true, reason: 'autopilot_off' }, { status: 200 });
    }

    // Never override an evening plan: if a daily planning session already exists
    // for today's London date, the user (or a previous autopilot run) built the
    // day — leave it alone.
    const todayKey = runDate;
    const { data: existingSession, error: guardError } = await supabase
      .from('planning_sessions')
      .select('id')
      .eq('user_id', userId)
      .eq('window_type', 'daily')
      .eq('window_date', todayKey)
      .maybeSingle();
    // Fail CLOSED: if we can't confirm whether a plan already exists, do NOT
    // build — a false "no session" here would override the user's evening plan.
    if (guardError) {
      console.error('Autopilot planning-session guard failed:', guardError);
      try { await updateCronRun({ supabase, runId, patch: { tasks_affected: 0, status: 'failed', error: 'session guard query failed' } }); } catch {}
      return NextResponse.json({ skipped: true, reason: 'session_guard_error' }, { status: 200 });
    }
    if (existingSession) {
      try { await updateCronRun({ supabase, runId, patch: { tasks_affected: 0, status: 'success' } }); } catch {}
      return NextResponse.json({ skipped: true, reason: 'planning_session_exists' }, { status: 200 });
    }

    if (auth.dryRun) {
      return NextResponse.json({ dryRun: true, level }, { status: 200 });
    }

    let result;
    try {
      result = await buildAutopilotPlan({
        supabase,
        userId,
        windowDate: todayKey,
        aiEnabled: settings?.ai_planning_enabled === true,
      });
    } catch (planError) {
      try { await updateCronRun({ supabase, runId, patch: { status: 'failed', error: String(planError.message) } }); } catch {}
      throw planError;
    }

    // Record the auto-built session so the review/undo banner can surface it and
    // the evening demote cron's guard leaves it alone.
    // 'auto' is fully hands-off: pre-acknowledge the session so the review
    // banner never appears. 'review' leaves reviewed_at null so the morning
    // banner prompts a look.
    const nowIso = new Date().toISOString();
    const { error: sessionError } = await supabase
      .from('planning_sessions')
      .upsert(
        {
          user_id: userId,
          window_type: 'daily',
          window_date: todayKey,
          completed_at: nowIso,
          auto_planned: true,
          reviewed_at: level === AUTOPILOT_LEVEL.AUTO ? nowIso : null,
        },
        { onConflict: 'user_id,window_type,window_date' }
      );

    const placedTotal = result.placed.must_do + result.placed.good_to_do + result.placed.quick_wins;
    const runErrors = [];
    if (result.failures && result.failures.length > 0) {
      runErrors.push(`${result.failures.length} placement failure(s): ${result.failures.join('; ')}`);
    }
    if (sessionError) {
      runErrors.push(`session upsert failed: ${sessionError.message || sessionError}`);
    }
    const finalStatus = runErrors.length > 0 ? 'partial' : 'success';
    try {
      await updateCronRun({
        supabase,
        runId,
        patch: {
          tasks_affected: placedTotal,
          status: finalStatus,
          ...(runErrors.length > 0 ? { error: runErrors.join(' | ') } : {}),
        },
      });
    } catch (runUpdateError) {
      console.error('Failed to update cron_runs status:', runUpdateError);
    }

    return NextResponse.json(
      {
        level,
        placed: result.placed,
        leftOver: result.leftOver,
        failures: result.failures ? result.failures.length : 0,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Morning autopilot cron failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
