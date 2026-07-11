import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { sortTasksByPriority } from '@/lib/taskSort';
import { STALE_BACKLOG_DAYS, REVIEW_BACKLOG_CAP } from '@/lib/constants';
import { NextResponse } from 'next/server';

const CANDIDATE_SELECT = 'id, name, due_date, state, today_section, sort_order, area, task_type, chips, project_id, waiting_reason, follow_up_date, chase_count, entered_state_at, snoozed_until, snooze_count, carried_section, carried_count, created_at';

// GET /api/planning-candidates?windowType=daily&windowDate=2026-04-15
export async function GET(request) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const windowType = searchParams.get('windowType');
    const windowDate = searchParams.get('windowDate');

    // Validate params
    if (!windowType || !['daily', 'weekly'].includes(windowType)) {
      return NextResponse.json({ error: 'Invalid windowType — must be "daily" or "weekly"' }, { status: 400 });
    }
    if (!windowDate || !/^\d{4}-\d{2}-\d{2}$/.test(windowDate)) {
      return NextResponse.json({ error: 'Invalid windowDate — must be YYYY-MM-DD' }, { status: 400 });
    }
    const parsedDate = new Date(windowDate + 'T12:00:00Z');
    if (isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== windowDate) {
      return NextResponse.json({ error: 'Invalid windowDate — not a real calendar date' }, { status: 400 });
    }

    const supabase = getSupabaseServiceRole();
    const userId = session.user.id;

    // First-class snooze (F2): a task is only a candidate when it is not snoozed
    // past the planning window — snoozed_until IS NULL OR snoozed_until <= windowDate.
    // Snoozed rows disappear until their date, then reappear automatically. windowDate
    // is already validated as YYYY-MM-DD above, so it is safe to interpolate here.
    const snoozeFilter = `snoozed_until.is.null,snoozed_until.lte.${windowDate}`;

    if (windowType === 'daily') {
      // F4 backlog-ageing threshold. Derive the cutoff date from the validated
      // windowDate (noon UTC to sidestep DST edges, mirroring the weekly weekEnd
      // computation below and getDatePlusDays), never a live clock, so it tracks
      // the planning window. A backlog task whose entered_state_at falls before
      // this date has aged past STALE_BACKLOG_DAYS and is due a "still needed?"
      // review.
      // Subtract STALE_BACKLOG_DAYS-1 so the strict `.lt(entered_state_at, ...)`
      // below includes tasks aged EXACTLY STALE_BACKLOG_DAYS days (entered on
      // windowDate-14), matching the "14+ days" label — entered_state_at is a
      // timestamptz, so `.lt` against windowDate-14's midnight would wrongly
      // exclude a task entered at any time on windowDate-14.
      const staleThreshold = new Date(windowDate + 'T12:00:00Z');
      staleThreshold.setUTCDate(staleThreshold.getUTCDate() - (STALE_BACKLOG_DAYS - 1));
      const staleThresholdDate = staleThreshold.toISOString().slice(0, 10);

      const [carriedFromToday, inbox, dueTomorrow, overdue, undatedThisWeek, reviewBacklog, reviewBacklogCount, chaseDue] = await Promise.all([
        // 0. Carry-forward (A1): unfinished Good to Do / Quick Wins demoted from
        //    Today by the evening cron keep their original today_section in
        //    carried_section. Surface them FIRST as their own group so the modal
        //    can offer a one-tap "Keep yesterday's plan". Any this_week task with a
        //    carried_section is here ONLY — the due/overdue/undated buckets below
        //    exclude carried_section to avoid duplicate rows (mirrors the inbox
        //    dedup). Respects the shared snooze filter.
        supabase
          .from('tasks')
          .select(CANDIDATE_SELECT + ', projects!tasks_project_id_fkey(name, area)')
          .eq('user_id', userId)
          .eq('state', 'this_week')
          .not('carried_section', 'is', null)
          .eq('inbox', false)
          .or(snoozeFilter)
          .order('sort_order', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true }),

        // 1. Capture inbox (F3): every freshly captured, not-yet-triaged task
        //    (inbox=true), so nothing sinks into undated backlog unseen. Respects
        //    the same snooze filter as the other buckets; done tasks are excluded
        //    defensively (triage clears inbox, so an inbox task is never done).
        //    Inbox tasks that also carry a due date are surfaced HERE only — the
        //    dueTomorrow/overdue buckets below exclude inbox to avoid duplicate rows.
        supabase
          .from('tasks')
          .select(CANDIDATE_SELECT + ', projects!tasks_project_id_fkey(name, area)')
          .eq('user_id', userId)
          .eq('inbox', true)
          .not('state', 'in', '("done")')
          .or(snoozeFilter)
          .order('sort_order', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true }),

        // 2. Due tomorrow, not already in today/done, not an untriaged inbox item,
        //    not a carried-from-today item (surfaced in its own group above).
        supabase
          .from('tasks')
          .select(CANDIDATE_SELECT + ', projects!tasks_project_id_fkey(name, area)')
          .eq('user_id', userId)
          .eq('due_date', windowDate)
          .eq('inbox', false)
          .is('carried_section', null)
          .not('state', 'in', '("today","done")')
          .or(snoozeFilter)
          .order('sort_order', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true }),

        // 3. Overdue: due before windowDate, not in today/done, not an inbox item,
        //    not a carried-from-today item (surfaced in its own group above).
        supabase
          .from('tasks')
          .select(CANDIDATE_SELECT + ', projects!tasks_project_id_fkey(name, area)')
          .eq('user_id', userId)
          .lt('due_date', windowDate)
          .eq('inbox', false)
          .is('carried_section', null)
          .not('state', 'in', '("today","done")')
          .or(snoozeFilter)
          .order('due_date', { ascending: true })
          .order('created_at', { ascending: true }),

        // 4. Undated THIS_WEEK tasks (inbox items are always backlog, so no
        //    overlap). Excludes carried-from-today items (own group above).
        supabase
          .from('tasks')
          .select(CANDIDATE_SELECT + ', projects!tasks_project_id_fkey(name, area)')
          .eq('user_id', userId)
          .eq('state', 'this_week')
          .is('due_date', null)
          .is('carried_section', null)
          .eq('inbox', false)
          .or(snoozeFilter)
          .order('sort_order', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true }),

        // 5. Review backlog (F4): undated backlog tasks that have aged past
        //    STALE_BACKLOG_DAYS resurface for a "still needed?" decision so nothing
        //    sits unseen forever. Undated only (due_date IS NULL) so it never
        //    double-counts with the dated dueTomorrow/overdue buckets; inbox=false
        //    so it never overlaps the inbox bucket. Ordered oldest-first (longest
        //    in state) so the cap keeps the items most at risk of being lost, then
        //    re-ranked by the F1 comparator for display. Capped at
        //    REVIEW_BACKLOG_CAP so an old vault cannot flood the modal.
        supabase
          .from('tasks')
          .select(CANDIDATE_SELECT + ', projects!tasks_project_id_fkey(name, area)')
          .eq('user_id', userId)
          .eq('state', 'backlog')
          .eq('inbox', false)
          .is('due_date', null)
          .lt('entered_state_at', staleThresholdDate)
          .or(snoozeFilter)
          .order('entered_state_at', { ascending: true })
          .order('created_at', { ascending: true })
          .limit(REVIEW_BACKLOG_CAP),

        // 6. Full count of matching aged backlog rows (head:true — count only, no
        //    rows) so the modal can show "+N more ageing in backlog" when the list
        //    exceeds the cap. Filters mirror bucket 5 exactly.
        supabase
          .from('tasks')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('state', 'backlog')
          .eq('inbox', false)
          .is('due_date', null)
          .lt('entered_state_at', staleThresholdDate)
          .or(snoozeFilter),

        // 7. Chase-due (Wave 7): waiting tasks whose self-reminder has arrived —
        //    state='waiting', a non-null follow_up_date on/before windowDate. So
        //    the evening plan can prompt "chase these". Snooze-aware via the same
        //    shared filter. Waiting tasks never appear in the other buckets (those
        //    require this_week/backlog/today or inbox), so no cross-bucket dedup is
        //    needed. Re-ranked by the F1 comparator for display below.
        supabase
          .from('tasks')
          .select(CANDIDATE_SELECT + ', projects!tasks_project_id_fkey(name, area)')
          .eq('user_id', userId)
          .eq('state', 'waiting')
          .not('follow_up_date', 'is', null)
          .lte('follow_up_date', windowDate)
          .or(snoozeFilter)
          .order('follow_up_date', { ascending: true })
          .order('created_at', { ascending: true }),
      ]);

      if (carriedFromToday.error || inbox.error || dueTomorrow.error || overdue.error || undatedThisWeek.error || reviewBacklog.error || reviewBacklogCount.error || chaseDue.error) {
        const err = carriedFromToday.error || inbox.error || dueTomorrow.error || overdue.error || undatedThisWeek.error || reviewBacklog.error || reviewBacklogCount.error || chaseDue.error;
        console.error('Planning candidates query error:', err);
        return NextResponse.json({ error: 'Failed to fetch planning candidates' }, { status: 500 });
      }

      // Re-rank each bucket in JS with the deterministic priority comparator so
      // the planning modal arrives pre-ranked. windowDate is the reference "today":
      // buckets are built relative to it, so overdue/today-tomorrow bands stay coherent.
      return NextResponse.json({
        data: {
          carriedFromToday: sortTasksByPriority(flattenProjects(carriedFromToday.data), { todayKey: windowDate }),
          inbox: sortTasksByPriority(flattenProjects(inbox.data), { todayKey: windowDate }),
          dueTomorrow: sortTasksByPriority(flattenProjects(dueTomorrow.data), { todayKey: windowDate }),
          overdue: sortTasksByPriority(flattenProjects(overdue.data), { todayKey: windowDate }),
          undatedThisWeek: sortTasksByPriority(flattenProjects(undatedThisWeek.data), { todayKey: windowDate }),
          reviewBacklog: sortTasksByPriority(flattenProjects(reviewBacklog.data), { todayKey: windowDate }),
          reviewBacklogTotal: reviewBacklogCount.count ?? 0,
          chaseDue: sortTasksByPriority(flattenProjects(chaseDue.data), { todayKey: windowDate }),
        },
      });
    }

    // Weekly
    const weekEnd = new Date(windowDate + 'T12:00:00Z');
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const weekEndStr = weekEnd.toISOString().slice(0, 10);

    const [dueThisWeek, overdue] = await Promise.all([
      // 1. Due in target week, not already accepted (this_week) or today/done.
      //    Excluding this_week here stops tasks accepted earlier in the session
      //    reappearing as unactioned candidates on reopen (FF-052).
      supabase
        .from('tasks')
        .select(CANDIDATE_SELECT + ', projects!tasks_project_id_fkey(name, area)')
        .eq('user_id', userId)
        .gte('due_date', windowDate)
        .lte('due_date', weekEndStr)
        .not('state', 'in', '("this_week","today","done")')
        .or(snoozeFilter)
        .order('due_date', { ascending: true })
        .order('created_at', { ascending: true }),

      // 2. Overdue / carried over: due before Monday, not in today/done.
      //    Includes this_week tasks left over from a previous week (e.g. when a
      //    Sunday demote cron misses a run) so they are not stranded out of the
      //    weekly planning flow (FF-049).
      supabase
        .from('tasks')
        .select(CANDIDATE_SELECT + ', projects!tasks_project_id_fkey(name, area)')
        .eq('user_id', userId)
        .lt('due_date', windowDate)
        .not('state', 'in', '("today","done")')
        .or(snoozeFilter)
        .order('due_date', { ascending: true })
        .order('created_at', { ascending: true }),
    ]);

    if (dueThisWeek.error || overdue.error) {
      const err = dueThisWeek.error || overdue.error;
      console.error('Planning candidates query error:', err);
      return NextResponse.json({ error: 'Failed to fetch planning candidates' }, { status: 500 });
    }

    // Re-rank each bucket in JS with the deterministic priority comparator.
    // windowDate is the reference "today" for the date bands (see daily branch).
    return NextResponse.json({
      data: {
        dueThisWeek: sortTasksByPriority(flattenProjects(dueThisWeek.data), { todayKey: windowDate }),
        overdue: sortTasksByPriority(flattenProjects(overdue.data), { todayKey: windowDate }),
      },
    });
  } catch (err) {
    console.error('Planning candidates error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Flatten the nested project join into top-level project_name and project_area fields.
 */
function flattenProjects(tasks) {
  return (tasks || []).map((t) => {
    const { projects, ...rest } = t;
    return {
      ...rest,
      project_name: projects?.name || null,
      project_area: projects?.area || null,
    };
  });
}
