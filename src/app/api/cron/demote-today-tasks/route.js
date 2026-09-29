import { NextResponse } from 'next/server';
import { verifyCronAuth, claimCronRun, updateCronRun } from '@/lib/cronAuth';
import { getTimeZoneParts, LONDON_TIME_ZONE } from '@/lib/timezone';
import { getLondonDateKey } from '@/lib/timezone';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { resolveDigestUserId } from '@/services/dailyTaskEmailService';
import { computeSortOrder } from '@/lib/sortOrder';
import { STATE, TODAY_SECTION } from '@/lib/constants';

// The evening tidy runs silently: its "Daily Review" email was retired on
// 29 Sep 2026 at the owner's request. The carry-forward itself is unchanged.
export async function GET(request) {
  try {
    const auth = verifyCronAuth(request);
    if (!auth.authorized) {
      const msg = auth.status === 401 ? 'Unauthorized' : 'Forbidden';
      return NextResponse.json({ error: msg }, { status: auth.status });
    }

    // FF-002: fire only at exactly 19:55 London year-round, before the 20:05
    // planning window opens. Paired with dual UTC cron schedules (55 18 + 55 19)
    // in vercel.json so one run lands at 19:55 London in both GMT and BST; the
    // other lands at 18:55 or 20:55 London and is gated out here.
    const londonParts = getTimeZoneParts(new Date(), LONDON_TIME_ZONE);
    if (!auth.force && !(londonParts.hour === 19 && londonParts.minute >= 55)) {
      return NextResponse.json(
        { skipped: true, reason: 'outside_window' },
        { status: 200 }
      );
    }

    const supabase = getSupabaseServiceRole();
    const runDate = getLondonDateKey();

    // Dry runs skip the idempotency claim so they don't block the real cron
    let runId = null;
    if (!auth.dryRun) {
      const claim = await claimCronRun({ supabase, operation: 'demote_today', runDate });
      if (!claim.claimed) {
        return NextResponse.json(
          { skipped: true, reason: claim.reason },
          { status: 200 }
        );
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

    // FF-002 belt-and-braces: if the user has already completed tomorrow's daily
    // planning session, the evening plan is made — never demote it, even if a
    // mistimed or forced run reaches this point. windowDate mirrors the client's
    // getActivePlanningWindow (tomorrow's London date) so it matches the recorded row.
    const tomorrow = new Date(runDate + 'T12:00:00Z');
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const windowDate = tomorrow.toISOString().slice(0, 10);
    try {
      const { data: existingPlan } = await supabase
        .from('planning_sessions')
        .select('id')
        .eq('user_id', userId)
        .eq('window_type', 'daily')
        .eq('window_date', windowDate)
        .maybeSingle();
      if (existingPlan) {
        try { await updateCronRun({ supabase, runId, patch: { tasks_affected: 0, status: 'success' } }); } catch {}
        return NextResponse.json(
          { skipped: true, reason: 'planning_session_exists' },
          { status: 200 }
        );
      }
    } catch (guardError) {
      // Fail open — the schedule + 19:55 gate already prevent mistimed runs.
      console.error('Planning session guard check failed:', guardError);
    }

    const { data: tasks, error: fetchError } = await supabase
      .from('tasks')
      .select('id, today_section, carried_count')
      .eq('state', 'today')
      .eq('user_id', userId);

    if (fetchError) {
      try { await updateCronRun({ supabase, runId, patch: { status: 'failed', error: String(fetchError.message) } }); } catch {}
      throw fetchError;
    }

    if (!tasks || tasks.length === 0) {
      try { await updateCronRun({ supabase, runId, patch: { tasks_affected: 0, status: 'success' } }); } catch {}
      return NextResponse.json(
        { skipped: true, reason: 'no_tasks' },
        { status: 200 }
      );
    }

    if (auth.dryRun) {
      return NextResponse.json(
        { dryRun: true, tasksCount: tasks.length },
        { status: 200 }
      );
    }

    // A1 — selective carry-forward (replaces the old blanket demotion). Writes are
    // DIRECT supabase updates, NOT taskService.updateTask, so the carry markers are
    // exact and do not trip updateTask's re-triage reset (which would immediately
    // wipe carried_count/carried_section). All fetched tasks are unfinished — a
    // completed task is state='done', never 'today'.
    //   - Must Do: STAYS in Today (same section, sort_order preserved). Only the
    //     carry counter is bumped; no state/section change.
    //   - Good to Do / Quick Wins: demote to this_week, remembering their section in
    //     carried_section so the modal can restore them. The DB trigger clears
    //     today_section and stamps entered_state_at; carried_section persists.
    //   - updated_at is auto-stamped by the handle_tasks_updated_at trigger.
    // Demoted tasks append to the END of This Week: their old Today sort_order is
    // meaningless in the new column and would otherwise make them jump to the top
    // (updateTask normally computes this append, but the carry writes are direct).
    // Seed from the current max This Week sort_order, then step by a gap per task.
    const { data: maxThisWeek } = await supabase
      .from('tasks')
      .select('sort_order')
      .eq('user_id', userId)
      .eq('state', STATE.THIS_WEEK)
      .not('sort_order', 'is', null)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    let thisWeekOrder = maxThisWeek?.sort_order ?? null;

    const keptTasks = [];   // Must Do — remained in Today
    const movedTasks = [];  // Good to Do / Quick Wins — moved to This Week
    const failedUpdates = [];
    for (const task of tasks) {
      const staysInToday = task.today_section === TODAY_SECTION.MUST_DO;
      const nextCarried = (task.carried_count || 0) + 1;
      let patch;
      if (staysInToday) {
        patch = { carried_count: nextCarried };
      } else {
        thisWeekOrder = computeSortOrder(thisWeekOrder, null); // append to end of This Week
        patch = {
          state: STATE.THIS_WEEK,
          carried_section: task.today_section || null,
          carried_count: nextCarried,
          sort_order: thisWeekOrder,
          // Leaving Today ends any autopilot provenance (the "Auto-added" label
          // is Today-only; keeps the flag from lingering on This Week cards). Also
          // clear the AI plan_reason so a stale reason can't resurface on a later
          // rules-based auto-placement (A5).
          autoplanned_at: null,
          plan_reason: null,
        };
      }

      const { error: updateError } = await supabase
        .from('tasks')
        .update(patch)
        .eq('id', task.id)
        .eq('user_id', userId);

      if (updateError) {
        failedUpdates.push(`${task.id}: ${updateError.message || 'update failed'}`);
      } else if (staysInToday) {
        keptTasks.push(task);
      } else {
        movedTasks.push(task);
      }
    }

    // FF-050: a run where any task update failed is 'partial', not 'success',
    // with the failures recorded in the error column for diagnosis.
    const hasUpdateFailures = failedUpdates.length > 0;
    const finalStatus = hasUpdateFailures ? 'partial' : 'success';
    const runErrors = [];
    if (hasUpdateFailures) {
      runErrors.push(
        `${failedUpdates.length} of ${tasks.length} task update(s) failed: ${failedUpdates.join('; ')}`
      );
    }
    try {
      await updateCronRun({
        supabase,
        runId,
        patch: {
          tasks_affected: keptTasks.length + movedTasks.length,
          status: finalStatus,
          ...(runErrors.length > 0 ? { error: runErrors.join(' | ') } : {}),
        },
      });
    } catch (runUpdateError) {
      console.error('Failed to update cron_runs status:', runUpdateError);
    }

    return NextResponse.json(
      { kept: keptTasks.length, moved: movedTasks.length },
      { status: 200 }
    );
  } catch (error) {
    console.error('Demote today tasks cron failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
