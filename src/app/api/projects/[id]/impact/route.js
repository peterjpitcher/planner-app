import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier } from '@/lib/rateLimiter';
import { getOpenProjectTasks, getProjectDeletionImpact, getReopeningProjectTasks } from '@/services/projectLifecycleService';

// GET /api/projects/[id]/impact - What a status change or delete would affect.
//
// Backs the confirmation dialogs on the projects page: the open tasks that a
// close would cascade to (by name, so the user can check before committing) and
// the note count that a delete would destroy. Read-only.
export async function GET(request, { params }) {
  try {
    // Auth first, so the limit is keyed on the user id rather than a
    // client-supplied IP header (see rateLimiter.js).
    const { session } = await getAuthContext(request);
    const clientId = getClientIdentifier(request, session?.user?.id);
    const rateLimitResult = checkRateLimit(`projects-impact-${clientId}`, 60, 60000);

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter.toString() } }
      );
    }

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const supabase = getSupabaseServiceRole();

    // Verify ownership before revealing anything about the project's contents.
    const { data: project, error: fetchError } = await supabase
      .from('projects')
      .select('id, user_id, name, status')
      .eq('id', id)
      .single();

    if (fetchError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (project.user_id !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const [tasksResult, impactResult, reopeningResult] = await Promise.all([
      getOpenProjectTasks({ supabase, userId: session.user.id, projectId: id }),
      getProjectDeletionImpact({ supabase, userId: session.user.id, projectId: id }),
      getReopeningProjectTasks({ supabase, userId: session.user.id, projectId: id, status: project.status }),
    ]);

    if (tasksResult.error) {
      return NextResponse.json(
        { error: tasksResult.error.message },
        { status: tasksResult.error.status || 500 }
      );
    }
    if (impactResult.error) {
      return NextResponse.json(
        { error: impactResult.error.message },
        { status: impactResult.error.status || 500 }
      );
    }

    if (reopeningResult.error) {
      return NextResponse.json({ error: reopeningResult.error.message }, { status: reopeningResult.error.status });
    }

    return NextResponse.json({
      reopeningTasks: reopeningResult.data,
      projectName: project.name,
      status: project.status,
      openTasks: tasksResult.data,
      // What is kept and where it goes, not just what is destroyed. Notes now
      // move to the customer on delete rather than being cascaded away, so the
      // dialog can name the destination.
      noteCount: impactResult.data.noteCount,
      taskCount: impactResult.data.taskCount,
      customerId: impactResult.data.customerId,
      customerName: impactResult.data.customerName,
    });
  } catch (error) {
    console.error('GET /api/projects/[id]/impact error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
