-- Outlook integration schema additions

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

CREATE TABLE IF NOT EXISTS public.outlook_connections (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    microsoft_account_id text NOT NULL,
    tenant_id text,
    planner_list_id text NOT NULL,
    refresh_token_secret uuid,
    access_token text,
    access_token_expires_at timestamptz,
    delta_token text,
    subscription_id text,
    subscription_expiration timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.outlook_connections IS 'Stores Microsoft Graph connection metadata per user for task sync.';

ALTER TABLE public.outlook_connections ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_outlook_connections_subscription ON public.outlook_connections(subscription_id);

CREATE TABLE IF NOT EXISTS public.task_sync_state (
    task_id uuid PRIMARY KEY REFERENCES public.tasks(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    graph_task_id text NOT NULL,
    graph_etag text,
    last_synced_at timestamptz,
    last_sync_direction text CHECK (last_sync_direction IN ('local', 'remote')),
    last_error text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.task_sync_state IS 'Tracks Graph task mappings and sync metadata per local task.';

ALTER TABLE public.task_sync_state ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_task_sync_state_user ON public.task_sync_state(user_id);
CREATE INDEX IF NOT EXISTS idx_task_sync_state_graph ON public.task_sync_state(graph_task_id);

CREATE TABLE IF NOT EXISTS public.task_sync_jobs (
    id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
    action text NOT NULL CHECK (action IN ('create', 'update', 'delete', 'full_sync')),
    payload jsonb DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    attempts integer NOT NULL DEFAULT 0,
    last_error text,
    scheduled_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.task_sync_jobs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_task_sync_jobs_status_schedule
  ON public.task_sync_jobs(status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_task_sync_jobs_user
  ON public.task_sync_jobs(user_id);

-- RLS policies

CREATE POLICY "Users manage their own connections" ON public.outlook_connections
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access to connections" ON public.outlook_connections
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Users manage their own sync state" ON public.task_sync_state
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access to sync state" ON public.task_sync_state
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Users manage their own sync jobs" ON public.task_sync_jobs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access to sync jobs" ON public.task_sync_jobs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Updated_at triggers

CREATE TRIGGER handle_outlook_connections_updated_at
  BEFORE UPDATE ON public.outlook_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER handle_task_sync_state_updated_at
  BEFORE UPDATE ON public.task_sync_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER handle_task_sync_jobs_updated_at
  BEFORE UPDATE ON public.task_sync_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Grants

GRANT SELECT, INSERT, UPDATE, DELETE ON public.outlook_connections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_sync_state TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_sync_jobs TO authenticated;

GRANT ALL ON public.outlook_connections TO service_role;
GRANT ALL ON public.task_sync_state TO service_role;
GRANT ALL ON public.task_sync_jobs TO service_role;

RESET ALL;
