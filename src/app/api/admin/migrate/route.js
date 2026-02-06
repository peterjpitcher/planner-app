import { getAuthContext, isAdminSession, isDevelopment } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';

// POST /api/admin/migrate - Run database migrations
export async function POST(request) {
  try {
    const { session } = await getAuthContext(request, { requireAccessToken: false });
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isDevelopment() && !isAdminSession(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    const supabase = getSupabaseServiceRole();
    
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
        name: 'Create journal entries table and indexes',
        sql: `
          CREATE TABLE IF NOT EXISTS public.journal_entries (
            id uuid not null default gen_random_uuid(),
            user_id uuid not null default auth.uid(),
            content text not null,
            created_at timestamp with time zone not null default now(),
            updated_at timestamp with time zone not null default now(),
            constraint journal_entries_pkey primary key (id),
            constraint journal_entries_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade
          );

          CREATE INDEX IF NOT EXISTS journal_entries_user_id_idx 
          ON public.journal_entries (user_id);

          CREATE INDEX IF NOT EXISTS journal_entries_created_at_idx 
          ON public.journal_entries (created_at);
        `
      },
      {
        name: 'Add journal entry AI columns',
        sql: `
          ALTER TABLE public.journal_entries
            ADD COLUMN IF NOT EXISTS cleaned_content text;

          ALTER TABLE public.journal_entries
            ADD COLUMN IF NOT EXISTS ai_status text not null default 'skipped';

          ALTER TABLE public.journal_entries
            ADD COLUMN IF NOT EXISTS ai_error text;

          ALTER TABLE public.journal_entries
            ADD COLUMN IF NOT EXISTS cleaned_at timestamp with time zone;
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
      },
      {
        name: 'Enable RLS on journal entries',
        sql: `ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;`
      },
      {
        name: 'Create journal entries RLS policies',
        sql: `
          DROP POLICY IF EXISTS "Users can view their own journal entries" ON public.journal_entries;
          CREATE POLICY "Users can view their own journal entries" 
          ON public.journal_entries FOR SELECT 
          USING (auth.uid() = user_id);
          
          DROP POLICY IF EXISTS "Users can create their own journal entries" ON public.journal_entries;
          CREATE POLICY "Users can create their own journal entries" 
          ON public.journal_entries FOR INSERT 
          WITH CHECK (auth.uid() = user_id);
          
          DROP POLICY IF EXISTS "Users can update their own journal entries" ON public.journal_entries;
          CREATE POLICY "Users can update their own journal entries" 
          ON public.journal_entries FOR UPDATE 
          USING (auth.uid() = user_id) 
          WITH CHECK (auth.uid() = user_id);
          
          DROP POLICY IF EXISTS "Users can delete their own journal entries" ON public.journal_entries;
          CREATE POLICY "Users can delete their own journal entries" 
          ON public.journal_entries FOR DELETE 
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
    const { session } = await getAuthContext(request, { requireAccessToken: false });
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isDevelopment() && !isAdminSession(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    const supabase = getSupabaseServiceRole();
    
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
