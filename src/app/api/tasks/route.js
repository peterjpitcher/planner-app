import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier } from '@/lib/rateLimiter';
import { createTask, updateTask, deleteTask } from '@/services/taskService';
import { maybeAutoSyncOffice365 } from '@/services/office365SyncService';
import { handleSupabaseError } from '@/lib/errorHandler';

const TASK_SELECT_FIELDS = 'id, name, description, due_date, state, today_section, sort_order, area, task_type, chips, waiting_reason, follow_up_date, project_id, user_id, completed_at, entered_state_at, source_idea_id, created_at, updated_at';

// GET /api/tasks - Fetch tasks with support for state-based filtering
export async function GET(request) {
  try {
    // Rate limiting
    const clientId = getClientIdentifier(request);
    const rateLimitResult = checkRateLimit(`tasks-get-${clientId}`, 120, 60000); // 120 requests per minute (2/sec)

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', retryAfter: rateLimitResult.retryAfter },
        {
          status: 429,
          headers: { 'Retry-After': rateLimitResult.retryAfter.toString() }
        }
      );
    }

    const { session } = await getAuthContext(request);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const autoSyncMinutes = Number(process.env.OFFICE365_AUTO_SYNC_MINUTES || 2);
    const forceSync = searchParams.get('forceSync') === 'true';

    // Fire Office365 auto-sync in the background — do NOT await it.
    // Awaiting a full Graph API sync on every GET request causes the tasks page
    // to hang indefinitely when the sync is slow or the token needs refreshing.
    if (Number.isFinite(autoSyncMinutes) && autoSyncMinutes > 0) {
      maybeAutoSyncOffice365({
        userId: session.user.id,
        minIntervalMinutes: forceSync ? 0 : autoSyncMinutes,
        reason: 'tasks-get',
      }).catch((err) => {
        console.warn('Office365 auto-sync failed (tasks-get):', err);
      });
    }

    const supabase = getSupabaseServiceRole();

    // Parse query parameters
    const projectId = searchParams.get('projectId');
    const state = searchParams.get('state');
    const statesParam = searchParams.get('states');
    const completedSince = searchParams.get('completedSince');
    const parsedLimit = parseInt(searchParams.get('limit') || '100', 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 100;
    const parsedOffset = parseInt(searchParams.get('offset') || '0', 10);
    const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;

    // Build base query
    let query = supabase
      .from('tasks')
      .select(`${TASK_SELECT_FIELDS}, projects(id, name, area)`, { count: 'exact' })
      .eq('user_id', session.user.id);

    // Apply project filter if specified
    if (projectId) {
      query = query.eq('project_id', projectId);
    }

    // Apply state-based filtering
    if (state) {
      query = query.eq('state', state);
    } else if (statesParam) {
      const statesArray = statesParam.split(',').map(s => s.trim()).filter(Boolean);
      if (statesArray.length > 0) {
        query = query.in('state', statesArray);
      }
    }

    // Apply completedSince filter (for "completed today" queries)
    if (completedSince) {
      query = query.gte('completed_at', completedSince);
    }

    // Default ordering: sort_order ASC, created_at ASC
    query = query
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      const errorMessage = handleSupabaseError(error, 'fetch');
      return NextResponse.json({ error: errorMessage }, { status: 500 });
    }

    // Transform data to include project_name and project_area at top level for easier consumption
    const transformedData = (data || []).map(task => ({
      ...task,
      project_name: task.projects?.name || null,
      project_area: task.projects?.area || null
    }));

    // Build response with pagination info if count is available
    const response = {
      data: transformedData
    };

    if (count !== null) {
      response.pagination = {
        total: count,
        limit,
        offset,
        hasMore: (offset + limit) < count
      };
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('GET /api/tasks error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/tasks - Create a new task
export async function POST(request) {
  try {
    // Rate limiting
    const clientId = getClientIdentifier(request);
    const rateLimitResult = checkRateLimit(`tasks-post-${clientId}`, 30, 60000); // 30 creates per minute

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', retryAfter: rateLimitResult.retryAfter },
        {
          status: 429,
          headers: { 'Retry-After': rateLimitResult.retryAfter.toString() }
        }
      );
    }

    const { session } = await getAuthContext(request);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const supabase = getSupabaseServiceRole();
    const { data, error } = await createTask({
      supabase,
      userId: session.user.id,
      payload: body
    });

    if (error) {
      const response = { error: error.message || 'Unable to create task' };
      if (error.details) {
        response.details = error.details;
      }
      return NextResponse.json(response, { status: error.status || 500 });
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH /api/tasks - Update a task
export async function PATCH(request) {
  try {
    const { session } = await getAuthContext(request);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'Task ID is required' }, { status: 400 });
    }

    const supabase = getSupabaseServiceRole();

    const { data, error } = await updateTask({
      supabase,
      userId: session.user.id,
      taskId: id,
      updates
    });

    if (error) {
      return NextResponse.json({ error: error.message || 'Unable to update task' }, { status: error.status || 500 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/tasks - Delete a task
export async function DELETE(request) {
  try {
    const { session } = await getAuthContext(request);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Task ID is required' }, { status: 400 });
    }

    const supabase = getSupabaseServiceRole();

    const { data, error } = await deleteTask({
      supabase,
      userId: session.user.id,
      taskId: id
    });

    if (error) {
      return NextResponse.json({ error: error.message || 'Unable to delete task' }, { status: error.status || 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
