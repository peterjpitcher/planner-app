import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { handleSupabaseError } from '@/lib/errorHandler';
import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier } from '@/lib/rateLimiter';

// POST /api/tasks/batch - Fetch tasks for multiple projects
export async function POST(request) {
  try {
    // Rate limiting - higher limit for batch operations
    const clientId = getClientIdentifier(request);
    const rateLimitResult = checkRateLimit(`tasks-batch-${clientId}`, 60, 60000); // 60 batch requests per minute
    
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
    const { projectIds } = body;
    
    if (!projectIds || !Array.isArray(projectIds) || projectIds.length === 0) {
      return NextResponse.json({ error: 'Project IDs are required' }, { status: 400 });
    }
    
    // Limit the number of projects that can be fetched at once
    if (projectIds.length > 50) {
      return NextResponse.json({ error: 'Too many projects requested (max 50)' }, { status: 400 });
    }
    
    const supabase = getSupabaseServer(accessToken);
    
    // Fetch all tasks for the given project IDs
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .in('project_id', projectIds)
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });
    
    if (error) {
      const errorMessage = handleSupabaseError(error, 'fetch');
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }
    
    // Group tasks by project ID
    const tasksByProject = {};
    projectIds.forEach(id => {
      tasksByProject[id] = [];
    });
    
    if (data) {
      data.forEach(task => {
        if (tasksByProject[task.project_id]) {
          tasksByProject[task.project_id].push(task);
        }
      });
    }
    
    return NextResponse.json(tasksByProject);
  } catch (error) {
    console.error('POST /api/tasks/batch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
