import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { handleSupabaseError } from '@/lib/errorHandler';
import { validateProject } from '@/lib/validators';
import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier } from '@/lib/rateLimiter';
import { PROJECT_STATUS } from '@/lib/constants';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { getConnection } from '@/services/outlookSyncService';
import { deleteTodoList } from '@/lib/microsoftGraphClient';

const TERMINAL_PROJECT_STATUSES = new Set([PROJECT_STATUS.COMPLETED, PROJECT_STATUS.CANCELLED]);

async function archiveOutlookList({ userId, projectId }) {
  const supabase = getSupabaseServiceRole();

  const { data: mapping } = await supabase
    .from('project_outlook_lists')
    .select('id, graph_list_id')
    .eq('project_id', projectId)
    .maybeSingle();

  if (!mapping) {
    return;
  }

  const connection = await getConnection(userId);
  if (connection && mapping.graph_list_id) {
    try {
      await deleteTodoList(connection.accessToken, mapping.graph_list_id);
    } catch (error) {
      if (error?.status !== 404) {
        console.error('Failed to delete Outlook list for project', { projectId, error });
      }
    }
  }

  await supabase
    .from('project_outlook_lists')
    .update({
      is_active: false,
      graph_list_id: null,
      graph_etag: null,
      subscription_id: null,
      subscription_expires_at: null,
      delta_token: null
    })
    .eq('id', mapping.id);

  if (mapping.graph_list_id) {
    await supabase
      .from('task_sync_state')
      .delete()
      .eq('graph_list_id', mapping.graph_list_id);
  }

  const { data: projectTasks } = await supabase
    .from('tasks')
    .select('id')
    .eq('project_id', projectId);

  const taskIds = (projectTasks || []).map((task) => task.id);

  if (taskIds.length > 0) {
    await supabase
      .from('task_sync_state')
      .delete()
      .in('task_id', taskIds);

    await supabase
      .from('task_sync_jobs')
      .delete()
      .in('task_id', taskIds)
      .in('status', ['pending', 'failed']);
  }
}

// PATCH /api/projects/[id] - Update a project
export async function PATCH(request, { params }) {
  try {
    // Rate limiting
    const clientId = getClientIdentifier(request);
    const rateLimitResult = checkRateLimit(`projects-patch-${clientId}`, 20, 60000);
    
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', retryAfter: rateLimitResult.retryAfter },
        { 
          status: 429,
          headers: { 'Retry-After': rateLimitResult.retryAfter.toString() }
        }
      );
    }

    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const { id } = params;
    const body = await request.json();
    
  const supabase = getSupabaseServer(session.accessToken);
  
  // Verify ownership
  const { data: existingProject, error: fetchError } = await supabase
    .from('projects')
    .select('user_id, status')
      .eq('id', id)
      .single();
    
    if (fetchError || !existingProject) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    if (existingProject.user_id !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    // Update project
    const { data, error } = await supabase
      .from('projects')
      .update({
        ...body,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      const errorMessage = handleSupabaseError(error, 'update');
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    if (body?.status && existingProject.status !== body.status && TERMINAL_PROJECT_STATUSES.has(body.status)) {
      await archiveOutlookList({ userId: session.user.id, projectId: id });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('PATCH /api/projects/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/projects/[id] - Delete a project
export async function DELETE(request, { params }) {
  try {
    // Rate limiting
    const clientId = getClientIdentifier(request);
    const rateLimitResult = checkRateLimit(`projects-delete-${clientId}`, 10, 60000);
    
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', retryAfter: rateLimitResult.retryAfter },
        { 
          status: 429,
          headers: { 'Retry-After': rateLimitResult.retryAfter.toString() }
        }
      );
    }

    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const { id } = params;
    const supabase = getSupabaseServer();
    
    // Verify ownership
    const { data: existingProject, error: fetchError } = await supabase
      .from('projects')
      .select('user_id')
      .eq('id', id)
      .single();
    
    if (fetchError || !existingProject) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    if (existingProject.user_id !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    // Delete project (cascade will handle related tasks and notes)
    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', id);
    
    if (error) {
      const errorMessage = handleSupabaseError(error, 'delete');
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/projects/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
