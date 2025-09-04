-- Performance indexes and RLS policies for Planner application

-- ============================================================
-- PERFORMANCE INDEXES
-- ============================================================

-- Projects table indexes
CREATE INDEX IF NOT EXISTS idx_projects_user_status_updated 
ON public.projects (user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_projects_user_due_date 
ON public.projects (user_id, due_date) 
WHERE status NOT IN ('Completed', 'Cancelled');

-- Tasks table indexes
CREATE INDEX IF NOT EXISTS idx_tasks_user_completed_due_priority 
ON public.tasks (user_id, is_completed, due_date, priority DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_project_id 
ON public.tasks (project_id);

CREATE INDEX IF NOT EXISTS idx_tasks_user_project 
ON public.tasks (user_id, project_id);

-- Notes table indexes
CREATE INDEX IF NOT EXISTS idx_notes_task_created 
ON public.notes (task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notes_project_created 
ON public.notes (project_id, created_at DESC);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PROJECTS RLS POLICIES
-- ============================================================

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

-- ============================================================
-- TASKS RLS POLICIES
-- ============================================================

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

-- ============================================================
-- NOTES RLS POLICIES
-- ============================================================

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