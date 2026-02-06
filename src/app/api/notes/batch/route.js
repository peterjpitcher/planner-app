import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { handleSupabaseError } from '@/lib/errorHandler';
import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier } from '@/lib/rateLimiter';

// POST /api/notes/batch - Fetch notes for multiple tasks or projects
export async function POST(request) {
  try {
    // Rate limiting - higher limit for batch operations
    const clientId = getClientIdentifier(request);
    const rateLimitResult = checkRateLimit(`notes-batch-${clientId}`, 60, 60000); // 60 batch requests per minute
    
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', retryAfter: rateLimitResult.retryAfter },
        { 
          status: 429,
          headers: { 'Retry-After': rateLimitResult.retryAfter.toString() }
        }
      );
    }

    const { session, accessToken } = await getAuthContext(request);
    
    if (!session?.user?.id || !accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await request.json();
    const { taskIds, projectIds } = body;
    
    const hasTaskIds = taskIds && Array.isArray(taskIds) && taskIds.length > 0;
    const hasProjectIds = projectIds && Array.isArray(projectIds) && projectIds.length > 0;

    if (!hasTaskIds && !hasProjectIds) {
      return NextResponse.json({ error: 'Task IDs or Project IDs are required' }, { status: 400 });
    }
    
    // Limit the number of items that can be fetched at once
    const count = (hasTaskIds ? taskIds.length : 0) + (hasProjectIds ? projectIds.length : 0);
    if (count > 200) {
      return NextResponse.json({ error: 'Too many items requested (max 200)' }, { status: 400 });
    }
    
    const supabase = getSupabaseServer(accessToken);
    
    let query = supabase.from('notes')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });

    if (hasTaskIds) {
      query = query.in('task_id', taskIds);
    } else if (hasProjectIds) {
      query = query.in('project_id', projectIds);
    }
    
    const { data, error } = await query;
    
    if (error) {
      const errorMessage = handleSupabaseError(error, 'fetch');
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }
    
    // Group notes
    const result = {};
    
    if (hasTaskIds) {
      taskIds.forEach(id => { result[id] = []; });
      if (data) {
        data.forEach(note => {
          if (result[note.task_id]) {
            result[note.task_id].push(note);
          }
        });
      }
    } else if (hasProjectIds) {
      projectIds.forEach(id => { result[id] = []; });
      if (data) {
        data.forEach(note => {
          if (result[note.project_id]) {
            result[note.project_id].push(note);
          }
        });
      }
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('POST /api/notes/batch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
