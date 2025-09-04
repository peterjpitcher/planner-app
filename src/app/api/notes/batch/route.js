import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { createClient } from '@supabase/supabase-js';
import { handleSupabaseError } from '@/lib/errorHandler';
import { getSupabaseServer } from '@/lib/supabaseServer';
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
  
  if (!process.env.SUPABASE_SERVICE_KEY && accessToken) {
    options.global = {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    };
  }
  
  return createClient(supabaseUrl, supabaseKey, options);
}

// POST /api/notes/batch - Fetch notes for multiple tasks
export async function POST(request) {
  try {
    // Rate limiting - higher limit for batch operations
    const clientId = getClientIdentifier(request);
    const rateLimitResult = checkRateLimit(`notes-batch-${clientId}`, 10, 60000);
    
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
    const { taskIds } = body;
    
    if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
      return NextResponse.json({ error: 'Task IDs are required' }, { status: 400 });
    }
    
    // Limit the number of tasks that can be fetched at once
    if (taskIds.length > 200) {
      return NextResponse.json({ error: 'Too many tasks requested (max 200)' }, { status: 400 });
    }
    
    const supabase = getSupabaseServer(session.accessToken);
    
    // Fetch all notes for the given task IDs
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .in('task_id', taskIds)
      .order('created_at', { ascending: false });
    
    if (error) {
      const errorMessage = handleSupabaseError(error, 'fetch');
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }
    
    // Group notes by task ID
    const notesByTask = {};
    taskIds.forEach(id => {
      notesByTask[id] = [];
    });
    
    if (data) {
      data.forEach(note => {
        if (notesByTask[note.task_id]) {
          notesByTask[note.task_id].push(note);
        }
      });
    }
    
    return NextResponse.json(notesByTask);
  } catch (error) {
    console.error('POST /api/notes/batch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}