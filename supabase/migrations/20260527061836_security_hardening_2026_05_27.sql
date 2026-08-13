-- ============================================================
-- Security hardening for OJ-Planner2.0
-- ============================================================
--
-- RECOVERED MIGRATION. This was applied directly to the production database on
-- 2026-05-27 without a corresponding file ever being committed, so the repo was
-- not a complete record of the live schema. The body below is reproduced
-- verbatim from supabase_migrations.schema_migrations (version 20260527061836).
--
-- It is already applied in production and is recorded in the migration history,
-- so `supabase db push` will not re-run it. It is committed so a database
-- rebuilt from this directory matches production.
--
-- Note for anyone replaying this on a fresh database: it assumes
-- public.vault_secrets, public.event_reminder_runs and the listed functions
-- already exist (both tables are present in production and confirmed by
-- to_regclass). Run it after the migrations that create them.

-- 1. Lock down vault_secrets (used only via service_role, anon must not read sensitive 'secret' column)
ALTER TABLE public.vault_secrets ENABLE ROW LEVEL SECURITY;
-- No policies added: anon/authenticated denied by default; service_role bypasses RLS

-- 2. Lock down event_reminder_runs (system cron tracking table)
ALTER TABLE public.event_reminder_runs ENABLE ROW LEVEL SECURITY;

-- 3. Revoke anon/authenticated EXECUTE on functions designed for service_role only
-- (exec_sql + vault_* are called only from src/lib/supabaseVault.js and src/app/api/admin/migrate/route.js, both via service-role client)
REVOKE EXECUTE ON FUNCTION public.exec_sql(text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.vault_create_secret(text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.vault_delete_secret(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.vault_get_secret(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.vault_update_secret(uuid, text) FROM anon, authenticated, PUBLIC;

-- 4. Set immutable search_path on all public functions (hardening against search_path attacks)
ALTER FUNCTION public.exec_sql(text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.vault_create_secret(text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.vault_delete_secret(uuid) SET search_path = public, pg_catalog;
ALTER FUNCTION public.vault_get_secret(uuid) SET search_path = public, pg_catalog;
ALTER FUNCTION public.vault_update_secret(uuid, text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.fn_batch_update_sort_order(uuid, jsonb) SET search_path = public, pg_catalog;
ALTER FUNCTION public.fn_task_state_cleanup() SET search_path = public, pg_catalog;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public, pg_catalog;
ALTER FUNCTION public.update_user_settings_updated_at() SET search_path = public, pg_catalog;
