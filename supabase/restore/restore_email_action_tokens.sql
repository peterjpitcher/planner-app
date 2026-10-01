-- ============================================================
-- Restore public.email_action_tokens after 20260930133014_retire_email_action_tokens
-- ============================================================
--
-- Not a migration: run by hand only if the signed email action links come
-- back, which also means reverting PR #49 (the route, the token module and the
-- middleware exception). The table was empty when it was dropped, so this
-- restores its shape only; there are no rows to bring back.
--
-- Columns, types, defaults and the primary key match live on 30 September
-- 2026. Row-level security is on with no policies, as before. Grants are
-- deliberately tighter than before: the table used to carry every privilege
-- for anon and authenticated (blocked only by RLS); here only service_role,
-- the one role the route used, gets access.
--
-- One transaction: if the table already exists, CREATE TABLE fails and
-- nothing changes.

BEGIN;

CREATE TABLE public.email_action_tokens (
  jti uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  action text NOT NULL,
  task_id uuid,
  used_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.email_action_tokens ENABLE ROW LEVEL SECURITY;

-- Remove whatever the schema's default privileges granted at CREATE time.
REVOKE ALL ON public.email_action_tokens FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_action_tokens TO service_role;

COMMIT;
