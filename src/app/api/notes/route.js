import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { createClient } from '@supabase/supabase-js';
import { handleSupabaseError } from '@/lib/errorHandler';
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

// GET /api/notes - Fetch notes for a project or task
export async function GET(request) {
  try {
    // Rate limiting - increased limit for notes since they're fetched per task
    const clientId = getClientIdentifier(request);
    const rateLimitResult = checkRateLimit(`notes-get-${clientId}`, 100, 60000);
    
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
    const taskId = searchParams.get('taskId');
    
    let query = supabase
      .from('notes')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (projectId) {
      query = query.eq('project_id', projectId);
    }
    
    if (taskId) {
      query = query.eq('task_id', taskId);
    }
    
    const { data, error } = await query;
    
    if (error) {
      const errorMessage = handleSupabaseError(error, 'fetch');
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }
    
    return NextResponse.json(data || []);
  } catch (error) {
    console.error('GET /api/notes error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/notes - Create a new note
export async function POST(request) {
  try {
    // Rate limiting
    const clientId = getClientIdentifier(request);
    const rateLimitResult = checkRateLimit(`notes-post-${clientId}`, 20, 60000);
    
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
    
    // Validate required fields
    if (!body.content || (!body.project_id && !body.task_id)) {
      return NextResponse.json({ 
        error: 'Content and either project_id or task_id are required' 
      }, { status: 400 });
    }
    
    const noteData = {
      content: body.content.trim(),
      project_id: body.project_id || null,
      task_id: body.task_id || null,
      user_id: session.user.id,
      created_at: new Date().toISOString()
    };
    
    const supabase = getSupabaseServer(session.accessToken);
    
    // If note is for a task, verify the task belongs to the user
    if (noteData.task_id) {
      const { data: task, error: taskError } = await supabase
        .from('tasks')
        .select('user_id')
        .eq('id', noteData.task_id)
        .single();
        
      if (taskError || !task || task.user_id !== session.user.id) {
        return NextResponse.json({ error: 'Task not found or access denied' }, { status: 404 });
      }
    }
    
    // If note is for a project, verify the project belongs to the user
    if (noteData.project_id) {
      const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('user_id')
        .eq('id', noteData.project_id)
        .single();
        
      if (projectError || !project || project.user_id !== session.user.id) {
        return NextResponse.json({ error: 'Project not found or access denied' }, { status: 404 });
      }
    }
    
    const { data, error } = await supabase
      .from('notes')
      .insert(noteData)
      .select()
      .single();
    
    if (error) {
      const errorMessage = handleSupabaseError(error, 'create');
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('POST /api/notes error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}