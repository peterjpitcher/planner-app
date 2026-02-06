import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { handleSupabaseError } from '@/lib/errorHandler';
import { NextResponse } from 'next/server';

// GET /api/completed-items - Fetch completed tasks and projects
export async function GET(request) {
  try {
    const { session } = await getAuthContext(request);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const supabase = getSupabaseServiceRole();
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    
    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'Start date and end date are required' }, { status: 400 });
    }
    
    // Fetch completed tasks
    const { data: tasks, error: tasksError } = await supabase
      .from('tasks')
      .select('*, project:project_id(id, name, stakeholders, job)')
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
      .select('*, stakeholders, job')
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
        .eq('user_id', session.user.id)
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
        .eq('user_id', session.user.id)
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
