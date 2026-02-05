import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier } from '@/lib/rateLimiter';
import { createTask, updateTask, deleteTask } from '@/services/taskService';
import { maybeAutoSyncOffice365 } from '@/services/office365SyncService';
import { handleSupabaseError } from '@/lib/errorHandler';

// GET /api/tasks - Fetch tasks with support for upcoming range
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

    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const autoSyncMinutes = Number(process.env.OFFICE365_AUTO_SYNC_MINUTES || 2);
    const forceSync = searchParams.get('forceSync') === 'true';

    if (Number.isFinite(autoSyncMinutes) && autoSyncMinutes > 0) {
      try {
        await maybeAutoSyncOffice365({
          userId: session.user.id,
          minIntervalMinutes: forceSync ? 0 : autoSyncMinutes,
          reason: 'tasks-get',
        });
      } catch (err) {
        console.warn('Office365 auto-sync failed (tasks-get):', err);
      }
    }

    const supabase = getSupabaseServer(session.accessToken);

    // Parse query parameters
    const projectId = searchParams.get('projectId');
    const includeCompleted = searchParams.get('includeCompleted') === 'true';
    const range = searchParams.get('range'); // 'upcoming' or undefined
    const days = parseInt(searchParams.get('days') || '14', 10);
    const includeOverdue = searchParams.get('includeOverdue') !== 'false'; // default true
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 200);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // Build base query
    let query = supabase
      .from('tasks')
      .select('*, projects(id, name, job)', { count: 'exact' })
      .eq('user_id', session.user.id);

    // Apply project filter if specified
    if (projectId) {
      query = query.eq('project_id', projectId);
    }

    // Apply completion filter
    if (!includeCompleted) {
      query = query.eq('is_completed', false);
    }

    // Apply upcoming range filter
    if (range === 'upcoming') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayISO = today.toISOString();

      const endDate = new Date();
      endDate.setDate(endDate.getDate() + days);
      endDate.setHours(23, 59, 59, 999);
      const endDateISO = endDate.toISOString();

      // Build date filter conditions
      if (includeOverdue) {
        // Include all tasks with due_date <= endDate (includes overdue)
        query = query.lte('due_date', endDateISO);
      } else {
        // Only include tasks from today onwards
        query = query.gte('due_date', todayISO).lte('due_date', endDateISO);
      }

      // Sort by due_date first for upcoming view
      query = query.order('due_date', { ascending: true, nullsFirst: false })
        .order('priority', { ascending: false }) // High -> Medium -> Low
        .order('created_at', { ascending: false });
    } else {
      // Default sorting for non-upcoming views
      query = query.order('created_at', { ascending: false });
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      const errorMessage = handleSupabaseError(error, 'fetch');
      return NextResponse.json({ error: errorMessage }, { status: 500 });
    }

    // Transform data to include project_name at top level for easier consumption
    const transformedData = (data || []).map(task => ({
      ...task,
      project_name: task.projects?.name || null,
      project_job: task.projects?.job || null
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

    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const supabase = getSupabaseServer(session.accessToken);
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
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'Task ID is required' }, { status: 400 });
    }

    const supabase = getSupabaseServer(session.accessToken);

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
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Task ID is required' }, { status: 400 });
    }

    const supabase = getSupabaseServer(session.accessToken);

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
