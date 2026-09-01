-- ============================================================
-- Customers, Phase 0: foundations
-- ============================================================
--
-- Spec: docs/superpowers/specs/2026-09-01-customers-crm-design.md sections 7.8, 11.
--
-- No customer tables here. This migration removes a known open door and
-- establishes the conventions every lifecycle RPC that follows must obey.
--
-- 1. Drop the permissive RLS policies on projects and tasks.
-- 2. Add the ownership guard those RPCs will call.
--
-- Nothing in this application reads or writes through PostgREST with the anon
-- key: every route uses the service-role client, which bypasses RLS entirely.
-- So dropping the permissive policies changes nothing the app can do, and closes
-- what any Supabase-authenticated JWT could currently do with the public key.

BEGIN;

-- ------------------------------------------------------------
-- 1. Permissive policies
-- ------------------------------------------------------------
--
-- 20250707_initial_schema.sql created these two with USING (true) WITH CHECK
-- (true) for the `authenticated` role. 20250904_performance_and_rls.sql later
-- added correct per-user policies alongside them, but never removed these.
--
-- PostgreSQL ORs permissive policies together, so the pair means the per-user
-- policies have no effect: any authenticated JWT can read and write every row
-- in projects and tasks through PostgREST using the public anon key.
--
-- This was a documented known issue while those tables held task names and due
-- dates. The customers work puts customer identity on both tables and hangs
-- facts, contacts, notes and files off their relationships, so it is closed now.

DROP POLICY IF EXISTS "Authenticated users can manage all projects" ON public.projects;
DROP POLICY IF EXISTS "Authenticated users can manage all tasks"    ON public.tasks;

-- The per-user policies from 20250904_performance_and_rls.sql remain in place:
--   projects: view / insert / update / delete "their own"
--   tasks:    view / insert / update / delete "their own"
-- Assert that, so this migration cannot silently leave a table with no policy
-- at all, which would look like a lockout rather than a fix.
DO $$
DECLARE
  project_policies int;
  task_policies    int;
BEGIN
  SELECT count(*) INTO project_policies
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'projects';
  SELECT count(*) INTO task_policies
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tasks';

  IF project_policies < 1 THEN
    RAISE EXCEPTION 'projects has no RLS policies left after the drop';
  END IF;
  IF task_policies < 1 THEN
    RAISE EXCEPTION 'tasks has no RLS policies left after the drop';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. Ownership guard for lifecycle RPCs
-- ------------------------------------------------------------
--
-- Every lifecycle RPC added from Phase 1 onwards is SECURITY DEFINER, because
-- it has to write across several tables in one transaction and is called by the
-- service-role client. That means RLS gives it no protection at all: the
-- function must check ownership itself, on the user id the caller passes in.
--
-- The convention, which every such function must follow:
--   * SECURITY DEFINER
--   * SET search_path = public, pg_catalog
--   * takes p_user_id and verifies it before touching anything
--   * SELECT ... FOR UPDATE on the target row, so concurrent submissions
--     serialise instead of interleaving
--   * REVOKE EXECUTE from public, anon, authenticated
--
-- Deliberately not dynamic SQL. A generic fn_assert_owner(table_name, ...) would
-- need EXECUTE format(...), which is an injection surface inside a function that
-- already runs as the definer. One small typed guard per table is duller and safe.

CREATE OR REPLACE FUNCTION public.fn_assert_project_owner(
  p_project_id uuid,
  p_user_id    uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_project_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'project and user are both required'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.projects
     WHERE id = p_project_id AND user_id = p_user_id
  ) THEN
    -- 42501 is insufficient_privilege. src/lib/rpc.js maps it to a 403 so a
    -- route never has to guess whether a failure was "not yours" or "broken".
    RAISE EXCEPTION 'project % is not owned by user %', p_project_id, p_user_id
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_assert_project_owner(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

COMMIT;
