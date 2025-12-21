-- Performance indexes for Planner application
-- Run this migration in Supabase SQL editor

-- Projects indexes
CREATE INDEX IF NOT EXISTS idx_projects_user_status_updated 
ON public.projects (user_id, status, updated_at DESC);

-- Tasks indexes
CREATE INDEX IF NOT EXISTS idx_tasks_user_completed_due_priority 
ON public.tasks (user_id, is_completed, due_date, priority DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_project_id 
ON public.tasks (project_id);

-- Notes indexes
CREATE INDEX IF NOT EXISTS idx_notes_task_created 
ON public.notes (task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notes_project_created 
ON public.notes (project_id, created_at DESC);

-- Journal entries table (if missing)
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  content text not null,
  cleaned_content text,
  ai_status text not null default 'skipped',
  ai_error text,
  cleaned_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint journal_entries_pkey primary key (id),
  constraint journal_entries_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade
);

ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS cleaned_content text;

ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS ai_status text not null default 'skipped';

ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS ai_error text;

ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS cleaned_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS journal_entries_user_id_idx 
ON public.journal_entries (user_id);

CREATE INDEX IF NOT EXISTS journal_entries_created_at_idx 
ON public.journal_entries (created_at);

-- Additional useful indexes
CREATE INDEX IF NOT EXISTS idx_projects_user_due_date 
ON public.projects (user_id, due_date) WHERE status NOT IN ('Completed', 'Cancelled');

CREATE INDEX IF NOT EXISTS idx_tasks_user_project 
ON public.tasks (user_id, project_id);

-- RLS policy updates for better security
-- Ensure all tables have proper user isolation

-- Projects RLS policies
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

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

-- Tasks RLS policies
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

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

-- Notes RLS policies (already exist but ensure they're correct)
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

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

-- Journal entries RLS policies
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

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
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own journal entries" ON public.journal_entries;
CREATE POLICY "Users can delete their own journal entries" 
ON public.journal_entries FOR DELETE 
USING (auth.uid() = user_id);
