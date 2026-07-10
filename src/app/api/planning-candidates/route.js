import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { sortTasksByPriority } from '@/lib/taskSort';
import { NextResponse } from 'next/server';

const CANDIDATE_SELECT = 'id, name, due_date, state, today_section, sort_order, area, task_type, chips, project_id, waiting_reason, follow_up_date, entered_state_at, snoozed_until, snooze_count, created_at';

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
      const [dueTomorrow, overdue, undatedThisWeek] = await Promise.all([
        // 1. Due tomorrow, not already in today/done
        supabase
          .from('tasks')
          .select(CANDIDATE_SELECT + ', projects!tasks_project_id_fkey(name, area)')
          .eq('user_id', userId)
          .eq('due_date', windowDate)
          .not('state', 'in', '("today","done")')
          .or(snoozeFilter)
          .order('sort_order', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true }),

        // 2. Overdue: due before windowDate, not in today/done
        supabase
          .from('tasks')
          .select(CANDIDATE_SELECT + ', projects!tasks_project_id_fkey(name, area)')
          .eq('user_id', userId)
          .lt('due_date', windowDate)
          .not('state', 'in', '("today","done")')
          .or(snoozeFilter)
          .order('due_date', { ascending: true })
          .order('created_at', { ascending: true }),

        // 3. Undated THIS_WEEK tasks
        supabase
          .from('tasks')
          .select(CANDIDATE_SELECT + ', projects!tasks_project_id_fkey(name, area)')
          .eq('user_id', userId)
          .eq('state', 'this_week')
          .is('due_date', null)
          .or(snoozeFilter)
          .order('sort_order', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true }),
      ]);

      if (dueTomorrow.error || overdue.error || undatedThisWeek.error) {
        const err = dueTomorrow.error || overdue.error || undatedThisWeek.error;
        console.error('Planning candidates query error:', err);
        return NextResponse.json({ error: 'Failed to fetch planning candidates' }, { status: 500 });
      }

      // Re-rank each bucket in JS with the deterministic priority comparator so
      // the planning modal arrives pre-ranked. windowDate is the reference "today":
      // buckets are built relative to it, so overdue/today-tomorrow bands stay coherent.
      return NextResponse.json({
        data: {
          dueTomorrow: sortTasksByPriority(flattenProjects(dueTomorrow.data), { todayKey: windowDate }),
          overdue: sortTasksByPriority(flattenProjects(overdue.data), { todayKey: windowDate }),
          undatedThisWeek: sortTasksByPriority(flattenProjects(undatedThisWeek.data), { todayKey: windowDate }),
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
