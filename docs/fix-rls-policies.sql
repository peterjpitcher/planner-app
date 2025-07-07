-- Fix Row Level Security Policies for Planner App
-- Run this in your Supabase SQL editor

-- First, drop the existing overly permissive policies
DROP POLICY IF EXISTS "Authenticated users can manage all projects" ON public.projects;
DROP POLICY IF EXISTS "Authenticated users can manage all tasks" ON public.tasks;

-- Create proper user-specific policies for projects
CREATE POLICY "Users can view own projects" 
ON public.projects FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own projects" 
ON public.projects FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own projects" 
ON public.projects FOR UPDATE 
TO authenticated 
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own projects" 
ON public.projects FOR DELETE 
TO authenticated 
USING (auth.uid() = user_id);

-- Create proper user-specific policies for tasks
CREATE POLICY "Users can view own tasks" 
ON public.tasks FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tasks" 
ON public.tasks FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tasks" 
ON public.tasks FOR UPDATE 
TO authenticated 
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own tasks" 
ON public.tasks FOR DELETE 
TO authenticated 
USING (auth.uid() = user_id);

-- Notes policies are already correct, but let's verify
-- They should only allow users to manage their own notes
SELECT polname, polcmd, qual::text 
FROM pg_policies 
WHERE tablename = 'notes' 
ORDER BY polname;