import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { createClient } from '@supabase/supabase-js';
import { handleSupabaseError } from '@/lib/errorHandler';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { NextResponse } from 'next/server';

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

// GET /api/completed-items - Fetch completed tasks and projects
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const supabase = getSupabaseServer(session.accessToken);
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    
    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'Start date and end date are required' }, { status: 400 });
    }
    
    // Fetch completed tasks
    const { data: tasks, error: tasksError } = await supabase
      .from('tasks')
      .select('*, project:project_id(id, name, stakeholders)')
      .eq('user_id', session.user.id)
      .eq('is_completed', true)
      .gte('completed_at', startDate)
      .lte('completed_at', endDate)
      .order('completed_at', { ascending: true });
      
    if (tasksError) {
      const errorMessage = handleSupabaseError(tasksError, 'fetch');
      return NextResponse.json({ error: `Tasks: ${errorMessage}` }, { status: 400 });
    }
    
    // Fetch completed projects
    const { data: projects, error: projectsError } = await supabase
      .from('projects')
      .select('*, stakeholders')
      .eq('user_id', session.user.id)
      .eq('status', 'Completed')
      .gte('updated_at', startDate)
      .lte('updated_at', endDate)
      .order('updated_at', { ascending: true });
      
    if (projectsError) {
      const errorMessage = handleSupabaseError(projectsError, 'fetch');
      return NextResponse.json({ error: `Projects: ${errorMessage}` }, { status: 400 });
    }
    
    // Fetch all notes for completed items
    const taskIds = tasks?.map(t => t.id) || [];
    const projectIds = projects?.map(p => p.id) || [];
    
    let taskNotes = [];
    let projectNotes = [];
    
    if (taskIds.length > 0) {
      const { data: tNotes, error: tNotesError } = await supabase
        .from('notes')
        .select('*')
        .in('task_id', taskIds)
        .order('created_at', { ascending: true });
        
      if (tNotesError) {
        console.error('Error fetching task notes:', tNotesError);
      } else {
        taskNotes = tNotes || [];
      }
    }
    
    if (projectIds.length > 0) {
      const { data: pNotes, error: pNotesError } = await supabase
        .from('notes')
        .select('*')
        .in('project_id', projectIds)
        .order('created_at', { ascending: true });
        
      if (pNotesError) {
        console.error('Error fetching project notes:', pNotesError);
      } else {
        projectNotes = pNotes || [];
      }
    }
    
    // Attach notes to their respective tasks and projects
    const tasksWithNotes = (tasks || []).map(task => ({
      ...task,
      notes: taskNotes.filter(note => note.task_id === task.id)
    }));
    
    const projectsWithNotes = (projects || []).map(project => ({
      ...project,
      notes: projectNotes.filter(note => note.project_id === project.id)
    }));
    
    return NextResponse.json({
      tasks: tasksWithNotes,
      projects: projectsWithNotes,
      allNotes: [...taskNotes, ...projectNotes]
    });
  } catch (error) {
    console.error('GET /api/completed-items error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}