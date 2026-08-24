import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { handleSupabaseError } from '@/lib/errorHandler';
import { validateProject } from '@/lib/validators';
import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier } from '@/lib/rateLimiter';
import { deleteOffice365Project, syncOffice365Project } from '@/services/office365SyncService';
import { cascadeProjectStatusToTasks } from '@/services/projectLifecycleService';

const PROJECT_UPDATE_FIELDS = [
  'name',
  'description',
  'status',
  'due_date',
  'stakeholders',
  'area',
];

function pickProjectUpdates(payload) {
  const updates = {};
  PROJECT_UPDATE_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      updates[field] = payload[field];
    }
  });
  return updates;
}

function stripUndefined(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

// PATCH /api/projects/[id] - Update a project
export async function PATCH(request, { params }) {
  try {
    // Rate limiting
    // Auth first, so the limit is keyed on the user id rather than a
    // client-supplied IP header (see rateLimiter.js).
    const { session } = await getAuthContext(request);
    const clientId = getClientIdentifier(request, session?.user?.id);
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

    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const { id } = await params;
    const body = await request.json();
    const updates = stripUndefined(pickProjectUpdates(body));
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }
    
  const supabase = getSupabaseServiceRole();
  
  // Verify ownership
  const { data: existingProject, error: fetchError } = await supabase
    .from('projects')
    .select('id, user_id, name, description, status, due_date, stakeholders, area')
      .eq('id', id)
      .single();
    
    if (fetchError || !existingProject) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    if (existingProject.user_id !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    const candidate = { ...existingProject, ...updates };
    const validation = validateProject(candidate);
    if (!validation.isValid) {
      return NextResponse.json({ error: 'Validation failed', details: validation.errors }, { status: 400 });
    }

    // Update project
    const { data, error } = await supabase
      .from('projects')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      const errorMessage = handleSupabaseError(error, 'update');
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    // Cascade a status change to the project's tasks. Closing a project closes
    // its open work (Completed -> done, Cancelled -> cancelled); reopening a
    // cancelled project returns its tasks to backlog. Done server-side so the
    // rule holds for every caller, not just the projects page.
    let cascade = { tasksChanged: 0, taskState: null };
    if (Object.prototype.hasOwnProperty.call(updates, 'status')
        && updates.status !== existingProject.status) {
      const cascadeResult = await cascadeProjectStatusToTasks({
        supabase,
        userId: session.user.id,
        projectId: id,
        previousStatus: existingProject.status,
        nextStatus: updates.status,
      });
      // A failed cascade leaves the project closed but its tasks live, which is
      // exactly the inconsistency this route exists to prevent. Surface it
      // rather than reporting a clean success.
      if (cascadeResult.error) {
        return NextResponse.json(
          { error: cascadeResult.error.message, projectUpdated: true },
          { status: cascadeResult.error.status || 500 }
        );
      }
      cascade = cascadeResult.data;
    }

    try {
      await syncOffice365Project({ userId: session.user.id, projectId: id });
    } catch (err) {
      console.warn('Office365 sync failed for updated project:', err);
    }

    return NextResponse.json({ ...data, tasksChanged: cascade.tasksChanged, taskState: cascade.taskState });
  } catch (error) {
    console.error('PATCH /api/projects/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/projects/[id] - Delete a project
export async function DELETE(request, { params }) {
  try {
    // Rate limiting
    // Auth first, so the limit is keyed on the user id rather than a
    // client-supplied IP header (see rateLimiter.js).
    const { session } = await getAuthContext(request);
    const clientId = getClientIdentifier(request, session?.user?.id);
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

    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const { id } = await params;
    const supabase = getSupabaseServiceRole();
    
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

    // Delete project from DB first (cascade will handle related tasks and notes)
    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', id);

    if (error) {
      const errorMessage = handleSupabaseError(error, 'delete');
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    // Clean up Office365 after successful DB delete (best-effort; orphaned lists cleaned on next sync)
    try {
      await deleteOffice365Project({ userId: session.user.id, projectId: id });
    } catch (err) {
      console.warn('Office365 cleanup failed for deleted project (will resolve on next sync):', err);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/projects/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
