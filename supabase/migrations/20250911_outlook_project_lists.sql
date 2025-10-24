SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER TABLE public.task_sync_state
  ADD COLUMN IF NOT EXISTS graph_list_id text;

CREATE TABLE IF NOT EXISTS public.project_outlook_lists (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  graph_list_id text NOT NULL,
  graph_etag text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (user_id, graph_list_id),
  UNIQUE (project_id)
);

COMMENT ON TABLE public.project_outlook_lists IS 'Maps Planner projects to Microsoft To Do lists.';

ALTER TABLE public.project_outlook_lists ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_project_outlook_lists_user ON public.project_outlook_lists(user_id);
CREATE INDEX IF NOT EXISTS idx_project_outlook_lists_graph ON public.project_outlook_lists(graph_list_id);

DROP POLICY IF EXISTS "Users manage their project list links" ON public.project_outlook_lists;
CREATE POLICY "Users manage their project list links" ON public.project_outlook_lists
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access to project list links" ON public.project_outlook_lists;
CREATE POLICY "Service role full access to project list links" ON public.project_outlook_lists
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS handle_project_outlook_lists_updated_at ON public.project_outlook_lists;
CREATE TRIGGER handle_project_outlook_lists_updated_at
  BEFORE UPDATE ON public.project_outlook_lists
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_outlook_lists TO authenticated;
GRANT ALL ON public.project_outlook_lists TO service_role;

RESET ALL;
