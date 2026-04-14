import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';

const CANDIDATE_SELECT = 'id, name, due_date, state, today_section, sort_order, area, task_type, chips, project_id, waiting_reason, follow_up_date, created_at';

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

    if (windowType === 'daily') {
      const [dueTomorrow, overdue, undatedThisWeek] = await Promise.all([
        // 1. Due tomorrow, not already in today/done
        supabase
          .from('tasks')
          .select(CANDIDATE_SELECT + ', projects!tasks_project_id_fkey(name, area)')
          .eq('user_id', userId)
          .eq('due_date', windowDate)
          .not('state', 'in', '("today","done")')
          .order('sort_order', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true }),

        // 2. Overdue: due before windowDate, not in today/done
        supabase
          .from('tasks')
          .select(CANDIDATE_SELECT + ', projects!tasks_project_id_fkey(name, area)')
          .eq('user_id', userId)
          .lt('due_date', windowDate)
          .not('state', 'in', '("today","done")')
          .order('due_date', { ascending: true })
          .order('created_at', { ascending: true }),

        // 3. Undated THIS_WEEK tasks
        supabase
          .from('tasks')
          .select(CANDIDATE_SELECT + ', projects!tasks_project_id_fkey(name, area)')
          .eq('user_id', userId)
          .eq('state', 'this_week')
          .is('due_date', null)
          .order('sort_order', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true }),
      ]);

      if (dueTomorrow.error || overdue.error || undatedThisWeek.error) {
        const err = dueTomorrow.error || overdue.error || undatedThisWeek.error;
        console.error('Planning candidates query error:', err);
        return NextResponse.json({ error: 'Failed to fetch planning candidates' }, { status: 500 });
      }

      return NextResponse.json({
        data: {
          dueTomorrow: flattenProjects(dueTomorrow.data),
          overdue: flattenProjects(overdue.data),
          undatedThisWeek: flattenProjects(undatedThisWeek.data),
        },
      });
    }

    // Weekly
    const weekEnd = new Date(windowDate + 'T12:00:00Z');
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const weekEndStr = weekEnd.toISOString().slice(0, 10);

    const [dueThisWeek, overdue] = await Promise.all([
      // 1. Due in target week, not in today/done
      supabase
        .from('tasks')
        .select(CANDIDATE_SELECT + ', projects!tasks_project_id_fkey(name, area)')
        .eq('user_id', userId)
        .gte('due_date', windowDate)
        .lte('due_date', weekEndStr)
        .not('state', 'in', '("today","done")')
        .order('due_date', { ascending: true })
        .order('created_at', { ascending: true }),

      // 2. Overdue: due before Monday, not in this_week/today/done
      supabase
        .from('tasks')
        .select(CANDIDATE_SELECT + ', projects!tasks_project_id_fkey(name, area)')
        .eq('user_id', userId)
        .lt('due_date', windowDate)
        .not('state', 'in', '("this_week","today","done")')
        .order('due_date', { ascending: true })
        .order('created_at', { ascending: true }),
    ]);

    if (dueThisWeek.error || overdue.error) {
      const err = dueThisWeek.error || overdue.error;
      console.error('Planning candidates query error:', err);
      return NextResponse.json({ error: 'Failed to fetch planning candidates' }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        dueThisWeek: flattenProjects(dueThisWeek.data),
        overdue: flattenProjects(overdue.data),
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
