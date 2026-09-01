import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { handleSupabaseError } from '@/lib/errorHandler';
import { validateProject } from '@/lib/validators';
import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier } from '@/lib/rateLimiter';
import {
  deleteOffice365ListById,
  getOffice365ListIdForProject,
  syncOffice365Project,
} from '@/services/office365SyncService';
import {
  changeProjectStatus,
  deleteProjectPreservingContent,
} from '@/services/projectLifecycleService';

const PROJECT_UPDATE_FIELDS = [
  'name',
  'description',
  'status',
  'due_date',
  'area',
  'customer_id',
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
    .select('id, user_id, name, description, status, due_date, area, customer_id')
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

    // A status change is a lifecycle operation, not a field update: it closes
    // the project's open work, moves its notes onto the customer's record,
    // writes the close-out note and adds any key facts. That spans five tables,
    // so it runs as one Postgres transaction rather than a sequence of writes
    // here. The status is therefore held back from the ordinary update and
    // applied by the RPC.
    const { status: nextStatus, ...fieldUpdates } = updates;
    const statusChanging =
      Object.prototype.hasOwnProperty.call(updates, 'status')
      && nextStatus !== existingProject.status;

    let data = existingProject;

    if (Object.keys(fieldUpdates).length > 0) {
      const { data: updated, error } = await supabase
        .from('projects')
        .update({
          ...fieldUpdates,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

      if (error) {
        const errorMessage = handleSupabaseError(error, 'update');
        return NextResponse.json({ error: errorMessage }, { status: 400 });
      }
      data = updated;
    }

    let cascade = { tasksChanged: 0, taskState: null };
    if (statusChanging) {
      const cascadeResult = await changeProjectStatus({
        supabase,
        userId: session.user.id,
        projectId: id,
        previousStatus: existingProject.status,
        nextStatus,
        // Optional, and only meaningful on a close. The modal collects them.
        closeoutNote: typeof body?.closeout_note === 'string' ? body.closeout_note : null,
        facts: Array.isArray(body?.closeout_facts) ? body.closeout_facts : null,
      });

      // The whole change either happened or it did not, so there is no longer a
      // "project updated but tasks were not" state to report.
      if (cascadeResult.error) {
        return NextResponse.json(
          { error: cascadeResult.error.message },
          { status: cascadeResult.error.status || 500 }
        );
      }
      cascade = cascadeResult.data;

      const { data: refreshed } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id)
        .single();
      if (refreshed) data = refreshed;
    }

    try {
      await syncOffice365Project({ userId: session.user.id, projectId: id });
    } catch (err) {
      console.warn('Office365 sync failed for updated project:', err);
    }

    return NextResponse.json({ ...data, ...cascade });
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

    // Capture the Outlook list id BEFORE the delete. office365_project_lists
    // has ON DELETE CASCADE on project_id, so the cascade destroys the mapping
    // row and the cleanup below would find nothing, leaving the To Do list
    // orphaned in Outlook forever. Nothing enumerates remote lists, so "cleaned
    // up on the next sync" was never true.
    const office365ListId = await getOffice365ListIdForProject({
      userId: session.user.id,
      projectId: id,
    });

    // Deleting a project used to destroy every note on it: notes.project_id was
    // ON DELETE CASCADE, so the rows went with the project and there was no way
    // back. The RPC stamps a tombstone on every note the project owns or
    // previously handed to a customer, re-parents them to that customer (or
    // leaves them unfiled when there is none), and only then deletes the
    // project. All in one transaction, so there is no window where the project
    // is gone and the notes are not yet re-parented.
    //
    // ?destroyContent=true is the explicit opt-in for actually deleting them.
    // It is never the default.
    const { searchParams } = new URL(request.url);
    const { data: deleteResult, error } = await deleteProjectPreservingContent({
      supabase,
      userId: session.user.id,
      projectId: id,
      destroyContent: searchParams.get('destroyContent') === 'true',
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: error.status || 500 });
    }

    // Clean up Office365 after a successful DB delete, using the id captured
    // above. Best-effort: the project is already gone locally.
    await deleteOffice365ListById({ userId: session.user.id, listId: office365ListId });

    return NextResponse.json({ success: true, ...(deleteResult || {}) });
  } catch (error) {
    console.error('DELETE /api/projects/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
