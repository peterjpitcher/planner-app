import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { handleSupabaseError } from '@/lib/errorHandler';
import { validateTask } from '@/lib/validators';
import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier } from '@/lib/rateLimiter';
import { PRIORITY, PROJECT_STATUS } from '@/lib/constants';

async function ensureUnassignedProject(supabase, userId) {
  // Try to find an existing "Unassigned" project for this user
  const { data: existingProject, error: fetchError } = await supabase
    .from('projects')
    .select('id')
    .eq('user_id', userId)
    .ilike('name', 'unassigned')
    .maybeSingle();

  if (fetchError) {
    throw fetchError;
  }

  if (existingProject?.id) {
    return existingProject.id;
  }

  // Create a new Unassigned project scoped to the user
  const { data: createdProject, error: createError } = await supabase
    .from('projects')
    .insert({
      user_id: userId,
      name: 'Unassigned',
      status: PROJECT_STATUS.OPEN,
      priority: PRIORITY.MEDIUM,
      stakeholders: [],
      description: 'Auto-generated project for unassigned tasks.'
    })
    .select('id')
    .single();

  if (createError) {
    // Handle potential race condition where another request created it first
    if (createError.code === '23505') {
      const { data: raceProject, error: raceFetchError } = await supabase
        .from('projects')
        .select('id')
        .eq('user_id', userId)
        .ilike('name', 'unassigned')
        .maybeSingle();

      if (raceFetchError || !raceProject?.id) {
        throw createError;
      }

      return raceProject.id;
    }

    throw createError;
  }

  return createdProject.id;
}

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
    
    const supabase = getSupabaseServer(session.accessToken);
    const { searchParams } = new URL(request.url);
    
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
      .select('*, projects(id, name)', { count: 'exact' })
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
      project_name: task.projects?.name || null
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

    let resolvedProjectId = body?.project_id;

    if (!resolvedProjectId) {
      try {
        resolvedProjectId = await ensureUnassignedProject(supabase, session.user.id);
      } catch (resolveError) {
        console.error('Failed to resolve unassigned project:', resolveError);
        return NextResponse.json({ error: 'Unable to resolve target project' }, { status: 500 });
      }
    }

    const taskData = {
      ...body,
      user_id: session.user.id,
      project_id: resolvedProjectId,
      is_completed: false
    };
    
    // Validate task data
    const validation = validateTask(taskData);
    if (!validation.isValid) {
      return NextResponse.json({ 
        error: 'Validation failed', 
        details: validation.errors 
      }, { status: 400 });
    }
    
    // Verify project ownership
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('user_id')
      .eq('id', taskData.project_id)
      .single();
    
    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    if (project.user_id !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    // Create task
    const { data, error } = await supabase
      .from('tasks')
      .insert(taskData)
      .select('*, projects(id, name)')
      .single();
    
    if (error) {
      const errorMessage = handleSupabaseError(error, 'create');
      return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
    
    // Update project's updated_at timestamp
    await supabase
      .from('projects')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', taskData.project_id);
    
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
    
    // Verify ownership
    const { data: existingTask, error: fetchError } = await supabase
      .from('tasks')
      .select('user_id, project_id')
      .eq('id', id)
      .single();
    
    if (fetchError || !existingTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    
    if (existingTask.user_id !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    // Handle completion status changes
    if ('is_completed' in updates) {
      updates.completed_at = updates.is_completed ? new Date().toISOString() : null;
    }
    
    // Update task
    const { data, error } = await supabase
      .from('tasks')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      const errorMessage = handleSupabaseError(error, 'update');
      return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
    
    // Update parent project's updated_at timestamp
    if (existingTask.project_id) {
      await supabase
        .from('projects')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', existingTask.project_id);
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
    
    // Verify ownership
    const { data: existingTask, error: fetchError } = await supabase
      .from('tasks')
      .select('user_id, project_id')
      .eq('id', id)
      .single();
    
    if (fetchError || !existingTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    
    if (existingTask.user_id !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    // Delete task
    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', id);
    
    if (error) {
      const errorMessage = handleSupabaseError(error, 'delete');
      return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
    
    // Update parent project's updated_at timestamp
    if (existingTask.project_id) {
      await supabase
        .from('projects')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', existingTask.project_id);
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
