import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    
    // Create sample projects
    const sampleProjects = [
      {
        name: 'Website Redesign',
        priority: 'High',
        status: 'In Progress',
        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 1 week from now
        stakeholders: ['Design Team', 'Marketing'],
        user_id: session.user.id
      },
      {
        name: 'Mobile App Development',
        priority: 'Medium',
        status: 'Open',
        due_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 2 weeks from now
        stakeholders: ['Development', 'Product'],
        user_id: session.user.id
      },
      {
        name: 'Q1 Marketing Campaign',
        priority: 'Low',
        status: 'Open',
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 1 month from now
        stakeholders: ['Marketing', 'Sales'],
        user_id: session.user.id
      }
    ];
    
    const { data: projects, error: projectError } = await supabase
      .from('projects')
      .insert(sampleProjects)
      .select();
    
    if (projectError) {
      console.error('Project creation error:', projectError);
      return NextResponse.json({ error: projectError.message }, { status: 500 });
    }
    
    // Create sample tasks for the first project
    const sampleTasks = projects && projects[0] ? [
      {
        name: 'Create wireframes',
        project_id: projects[0].id,
        priority: 'High',
        status: 'Open',
        is_completed: false,
        due_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        user_id: session.user.id
      },
      {
        name: 'Review competitor sites',
        project_id: projects[0].id,
        priority: 'Medium',
        status: 'Open',
        is_completed: false,
        due_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        user_id: session.user.id
      },
      {
        name: 'Gather user feedback',
        project_id: projects[0].id,
        priority: 'Medium',
        status: 'Open',
        is_completed: false,
        due_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        user_id: session.user.id
      }
    ] : [];
    
    let tasks = [];
    if (sampleTasks.length > 0) {
      const { data: taskData, error: taskError } = await supabase
        .from('tasks')
        .insert(sampleTasks)
        .select();
      
      if (taskError) {
        console.error('Task creation error:', taskError);
      } else {
        tasks = taskData;
      }
    }
    
    return NextResponse.json({
      message: 'Sample data created successfully',
      created: {
        projects: projects?.length || 0,
        tasks: tasks?.length || 0
      },
      data: {
        projects,
        tasks
      }
    });
  } catch (error) {
    console.error('Seed data error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}