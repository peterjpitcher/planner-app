import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { createClient } from '@supabase/supabase-js';
import { handleSupabaseError } from '@/lib/errorHandler';
import { validateTask } from '@/lib/validators';
import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier } from '@/lib/rateLimiter';

// Create a Supabase client for server-side operations
function getSupabaseServer(accessToken = null) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables');
  }
  
  const options = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    }
  };
  
  // If we have a service key, use it (bypasses RLS)
  // Otherwise, use anon key with user's access token
  if (!process.env.SUPABASE_SERVICE_KEY && accessToken) {
    options.global = {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    };
  }
  
  return createClient(supabaseUrl, supabaseKey, options);
}

// GET /api/tasks - Fetch tasks (optionally filtered by project)
export async function GET(request) {
  try {
    // Rate limiting
    const clientId = getClientIdentifier(request);
    const rateLimitResult = checkRateLimit(`tasks-get-${clientId}`, 30, 60000); // 30 requests per minute
    
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
    const projectId = searchParams.get('projectId');
    const includeCompleted = searchParams.get('includeCompleted') === 'true';
    
    let query = supabase
      .from('tasks')
      .select('*, projects(id, name)')
      .order('created_at', { ascending: false });
    
    if (projectId) {
      query = query.eq('project_id', projectId);
    }
    
    if (!includeCompleted) {
      query = query.eq('is_completed', false);
    }
    
    const { data, error } = await query;
    
    if (error) {
      const errorMessage = handleSupabaseError(error, 'fetch');
      return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
    
    return NextResponse.json({ data: data || [] });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/tasks - Create a new task
export async function POST(request) {
  try {
    // Rate limiting
    const clientId = getClientIdentifier(request);
    const rateLimitResult = checkRateLimit(`tasks-post-${clientId}`, 10, 60000); // 10 creates per minute
    
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
    const taskData = {
      ...body,
      user_id: session.user.id,
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
    
    const supabase = getSupabaseServer(session.accessToken);
    
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