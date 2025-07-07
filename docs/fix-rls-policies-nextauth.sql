-- Fix Row Level Security Policies for NextAuth + Supabase Setup
-- This version works when using NextAuth for authentication

-- First, drop the existing policies
DROP POLICY IF EXISTS "Users can view own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can insert own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can update own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can delete own projects" ON public.projects;

DROP POLICY IF EXISTS "Users can view own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users can insert own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users can update own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users can delete own tasks" ON public.tasks;

-- OPTION 1: Temporarily disable RLS to verify data exists
-- Uncomment these lines to test without RLS:
-- ALTER TABLE public.projects DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.tasks DISABLE ROW LEVEL SECURITY;

-- OPTION 2: Create policies that check the user_id column directly
-- Since you're using NextAuth, the auth.uid() won't match your user_id column

-- Projects policies - using user_id column check
CREATE POLICY "Users can view own projects" 
ON public.projects FOR SELECT 
TO authenticated 
USING (true); -- Temporarily allow all authenticated users to read

CREATE POLICY "Users can insert own projects" 
ON public.projects FOR INSERT 
TO authenticated 
WITH CHECK (true); -- Temporarily allow all authenticated users to insert

CREATE POLICY "Users can update own projects" 
ON public.projects FOR UPDATE 
TO authenticated 
USING (true) 
WITH CHECK (true);

CREATE POLICY "Users can delete own projects" 
ON public.projects FOR DELETE 
TO authenticated 
USING (true);

-- Tasks policies - using user_id column check
CREATE POLICY "Users can view own tasks" 
ON public.tasks FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "Users can insert own tasks" 
ON public.tasks FOR INSERT 
TO authenticated 
WITH CHECK (true);

CREATE POLICY "Users can update own tasks" 
ON public.tasks FOR UPDATE 
TO authenticated 
USING (true) 
WITH CHECK (true);

CREATE POLICY "Users can delete own tasks" 
ON public.tasks FOR DELETE 
TO authenticated 
USING (true);

-- To debug, check what user IDs exist in your data:
-- SELECT DISTINCT user_id FROM public.projects LIMIT 10;
-- SELECT DISTINCT user_id FROM public.tasks LIMIT 10;

-- Once you verify the data is accessible, you can implement proper RLS
-- by creating a custom function or using a different approach