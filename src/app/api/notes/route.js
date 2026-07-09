import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { handleSupabaseError } from '@/lib/errorHandler';
import { validateNote } from '@/lib/validators';
import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier } from '@/lib/rateLimiter';

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

    const { session } = await getAuthContext(request);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const supabase = getSupabaseServiceRole();
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const taskId = searchParams.get('taskId');
    
    let query = supabase
      .from('notes')
      .select('*')
      .eq('user_id', session.user.id)
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
    
    return NextResponse.json({ data: data || [] });
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

    const { session } = await getAuthContext(request);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await request.json();

    // FF-031: a note may have exactly one parent (project, task, or idea). The
    // DB constraint check_note_parent enforces this, but reject more than one
    // here with a clear 400 before hitting the database.
    const projectId = body.project_id || null;
    const taskId = body.task_id || null;
    const ideaId = body.idea_id || null;

    if ([projectId, taskId, ideaId].filter(Boolean).length > 1) {
      return NextResponse.json(
        { error: 'A note must belong to exactly one parent (project, task, or idea)' },
        { status: 400 }
      );
    }

    const noteData = {
      content: typeof body.content === 'string' ? body.content.trim() : '',
      project_id: projectId,
      task_id: taskId,
      idea_id: ideaId,
      user_id: session.user.id,
      created_at: new Date().toISOString()
    };

    // FF-031: use the shared validator (content required + length, at least one
    // parent) instead of the hand-rolled check that ignored idea_id and length.
    const validation = validateNote(noteData);
    if (!validation.isValid) {
      return NextResponse.json({ error: 'Validation failed', details: validation.errors }, { status: 400 });
    }

    const supabase = getSupabaseServiceRole();

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

    // FF-031: if note is for an idea, verify the idea belongs to the user
    if (noteData.idea_id) {
      const { data: idea, error: ideaError } = await supabase
        .from('ideas')
        .select('user_id')
        .eq('id', noteData.idea_id)
        .single();

      if (ideaError || !idea || idea.user_id !== session.user.id) {
        return NextResponse.json({ error: 'Idea not found or access denied' }, { status: 404 });
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
    
    return NextResponse.json({ data });
  } catch (error) {
    console.error('POST /api/notes error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
