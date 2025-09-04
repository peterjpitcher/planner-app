-- ============================================================
-- Planner App Database Migration
-- ============================================================
-- This migration adds performance indexes and Row Level Security
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Step 1: Create Performance Indexes
-- ====================================
-- These indexes will significantly improve query performance

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

-- Step 2: Enable Row Level Security
-- ==================================
-- This ensures users can only access their own data

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

-- Step 3: Create RLS Policies for Projects
-- =========================================

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can insert their own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can update their own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can delete their own projects" ON public.projects;

-- Create new policies
CREATE POLICY "Users can view their own projects" 
ON public.projects FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own projects" 
ON public.projects FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own projects" 
ON public.projects FOR UPDATE 
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own projects" 
ON public.projects FOR DELETE 
USING (auth.uid() = user_id);

-- Step 4: Create RLS Policies for Tasks
-- ======================================

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users can insert their own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users can update their own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users can delete their own tasks" ON public.tasks;

-- Create new policies
CREATE POLICY "Users can view their own tasks" 
ON public.tasks FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own tasks" 
ON public.tasks FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tasks" 
ON public.tasks FOR UPDATE 
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tasks" 
ON public.tasks FOR DELETE 
USING (auth.uid() = user_id);

-- Step 5: Create RLS Policies for Notes
-- ======================================

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own notes" ON public.notes;
DROP POLICY IF EXISTS "Users can insert their own notes" ON public.notes;
DROP POLICY IF EXISTS "Users can update their own notes" ON public.notes;
DROP POLICY IF EXISTS "Users can delete their own notes" ON public.notes;

-- Create new policies
CREATE POLICY "Users can view their own notes" 
ON public.notes FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own notes" 
ON public.notes FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own notes" 
ON public.notes FOR UPDATE 
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own notes" 
ON public.notes FOR DELETE 
USING (auth.uid() = user_id);

-- Step 6: Verify Migration Success
-- =================================
-- Run these queries to confirm everything worked

-- Check indexes were created
SELECT 
    schemaname,
    tablename,
    indexname
FROM 
    pg_indexes
WHERE 
    schemaname = 'public'
    AND tablename IN ('projects', 'tasks', 'notes')
    AND indexname LIKE 'idx_%'
ORDER BY 
    tablename, indexname;

-- Check RLS is enabled
SELECT 
    schemaname,
    tablename,
    rowsecurity
FROM 
    pg_tables
WHERE 
    schemaname = 'public'
    AND tablename IN ('projects', 'tasks', 'notes');

-- Check policies exist
SELECT 
    schemaname,
    tablename,
    policyname
FROM 
    pg_policies
WHERE 
    schemaname = 'public'
    AND tablename IN ('projects', 'tasks', 'notes')
ORDER BY 
    tablename, policyname;

-- ============================================================
-- Migration Complete!
-- ============================================================
-- Expected results:
-- - 7 indexes created
-- - RLS enabled on 3 tables
-- - 12 policies created (4 per table)
-- ============================================================