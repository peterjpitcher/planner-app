import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { NextResponse } from 'next/server';

// POST /api/admin/migrate - Run database migrations
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const supabase = getSupabaseServer(session.accessToken);
    
    // Migration statements - breaking down into smaller chunks for better error handling
    const migrations = [
      {
        name: 'Create projects indexes',
        sql: `
          CREATE INDEX IF NOT EXISTS idx_projects_user_status_updated 
          ON public.projects (user_id, status, updated_at DESC);
          
          CREATE INDEX IF NOT EXISTS idx_projects_user_due_date 
          ON public.projects (user_id, due_date) 
          WHERE status NOT IN ('Completed', 'Cancelled');
        `
      },
      {
        name: 'Create tasks indexes',
        sql: `
          CREATE INDEX IF NOT EXISTS idx_tasks_user_completed_due_priority 
          ON public.tasks (user_id, is_completed, due_date, priority DESC);
          
          CREATE INDEX IF NOT EXISTS idx_tasks_project_id 
          ON public.tasks (project_id);
          
          CREATE INDEX IF NOT EXISTS idx_tasks_user_project 
          ON public.tasks (user_id, project_id);
        `
      },
      {
        name: 'Create notes indexes',
        sql: `
          CREATE INDEX IF NOT EXISTS idx_notes_task_created 
          ON public.notes (task_id, created_at DESC);
          
          CREATE INDEX IF NOT EXISTS idx_notes_project_created 
          ON public.notes (project_id, created_at DESC);
        `
      },
      {
        name: 'Enable RLS on projects',
        sql: `ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;`
      },
      {
        name: 'Create projects RLS policies',
        sql: `
          DROP POLICY IF EXISTS "Users can view their own projects" ON public.projects;
          CREATE POLICY "Users can view their own projects" 
          ON public.projects FOR SELECT 
          USING (auth.uid() = user_id);
          
          DROP POLICY IF EXISTS "Users can insert their own projects" ON public.projects;
          CREATE POLICY "Users can insert their own projects" 
          ON public.projects FOR INSERT 
          WITH CHECK (auth.uid() = user_id);
          
          DROP POLICY IF EXISTS "Users can update their own projects" ON public.projects;
          CREATE POLICY "Users can update their own projects" 
          ON public.projects FOR UPDATE 
          USING (auth.uid() = user_id) 
          WITH CHECK (auth.uid() = user_id);
          
          DROP POLICY IF EXISTS "Users can delete their own projects" ON public.projects;
          CREATE POLICY "Users can delete their own projects" 
          ON public.projects FOR DELETE 
          USING (auth.uid() = user_id);
        `
      },
      {
        name: 'Enable RLS on tasks',
        sql: `ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;`
      },
      {
        name: 'Create tasks RLS policies',
        sql: `
          DROP POLICY IF EXISTS "Users can view their own tasks" ON public.tasks;
          CREATE POLICY "Users can view their own tasks" 
          ON public.tasks FOR SELECT 
          USING (auth.uid() = user_id);
          
          DROP POLICY IF EXISTS "Users can insert their own tasks" ON public.tasks;
          CREATE POLICY "Users can insert their own tasks" 
          ON public.tasks FOR INSERT 
          WITH CHECK (auth.uid() = user_id);
          
          DROP POLICY IF EXISTS "Users can update their own tasks" ON public.tasks;
          CREATE POLICY "Users can update their own tasks" 
          ON public.tasks FOR UPDATE 
          USING (auth.uid() = user_id) 
          WITH CHECK (auth.uid() = user_id);
          
          DROP POLICY IF EXISTS "Users can delete their own tasks" ON public.tasks;
          CREATE POLICY "Users can delete their own tasks" 
          ON public.tasks FOR DELETE 
          USING (auth.uid() = user_id);
        `
      },
      {
        name: 'Enable RLS on notes',
        sql: `ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;`
      },
      {
        name: 'Create notes RLS policies',
        sql: `
          DROP POLICY IF EXISTS "Users can view their own notes" ON public.notes;
          CREATE POLICY "Users can view their own notes" 
          ON public.notes FOR SELECT 
          USING (auth.uid() = user_id);
          
          DROP POLICY IF EXISTS "Users can insert their own notes" ON public.notes;
          CREATE POLICY "Users can insert their own notes" 
          ON public.notes FOR INSERT 
          WITH CHECK (auth.uid() = user_id);
          
          DROP POLICY IF EXISTS "Users can update their own notes" ON public.notes;
          CREATE POLICY "Users can update their own notes" 
          ON public.notes FOR UPDATE 
          USING (auth.uid() = user_id) 
          WITH CHECK (auth.uid() = user_id);
          
          DROP POLICY IF EXISTS "Users can delete their own notes" ON public.notes;
          CREATE POLICY "Users can delete their own notes" 
          ON public.notes FOR DELETE 
          USING (auth.uid() = user_id);
        `
      }
    ];
    
    const results = [];
    const errors = [];
    
    // Execute each migration
    for (const migration of migrations) {
      try {
        // Use raw SQL execution through Supabase
        const { data, error } = await supabase.rpc('exec_sql', {
          query: migration.sql
        }).maybeSingle();
        
        if (error) {
          // If the RPC doesn't exist, try a different approach
          if (error.code === 'PGRST202' || error.message?.includes('not exist')) {
            // Try using a direct query (this might fail due to RLS)
            const testResult = await supabase
              .from('projects')
              .select('count')
              .limit(1)
              .maybeSingle();
            
            errors.push({
              migration: migration.name,
              error: 'Cannot execute SQL directly through API. Please run migrations manually in Supabase SQL editor.',
              sql: migration.sql
            });
          } else {
            errors.push({
              migration: migration.name,
              error: error.message,
              sql: migration.sql
            });
          }
        } else {
          results.push({
            migration: migration.name,
            status: 'success'
          });
        }
      } catch (err) {
        errors.push({
          migration: migration.name,
          error: err.message,
          sql: migration.sql
        });
      }
    }
    
    // Return results
    if (errors.length > 0) {
      return NextResponse.json({
        message: 'Migration partially completed with errors',
        successful: results,
        failed: errors,
        instructions: 'Please run the failed migrations manually in your Supabase SQL editor'
      }, { status: 207 }); // 207 Multi-Status
    }
    
    return NextResponse.json({
      message: 'All migrations completed successfully',
      results
    });
    
  } catch (error) {
    console.error('Migration error:', error);
    return NextResponse.json({ 
      error: 'Migration failed', 
      details: error.message 
    }, { status: 500 });
  }
}

// GET /api/admin/migrate - Check migration status
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const supabase = getSupabaseServer(session.accessToken);
    
    // Check if indexes exist by querying pg_indexes
    const { data: indexes, error: indexError } = await supabase.rpc('get_indexes', {
      schema_name: 'public'
    }).maybeSingle();
    
    if (indexError) {
      // Fallback: just check if tables have RLS enabled
      const checks = {
        rlsEnabled: {
          projects: false,
          tasks: false,
          notes: false
        },
        message: 'Unable to check index status. Please verify manually in Supabase.'
      };
      
      return NextResponse.json(checks);
    }
    
    return NextResponse.json({
      indexes: indexes || [],
      message: 'Index status retrieved'
    });
    
  } catch (error) {
    return NextResponse.json({ 
      error: 'Status check failed', 
      details: error.message 
    }, { status: 500 });
  }
}