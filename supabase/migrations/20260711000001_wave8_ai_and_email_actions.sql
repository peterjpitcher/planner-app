-- ============================================================
-- Planner redesign Wave 8 — AI day-planner + email actions
-- ============================================================
--
-- Additive and non-destructive.
--
--   user_settings.ai_planning_enabled — opt-in to AI-drafted day plans (off by
--     default; the deterministic rules remain the fallback).
--   tasks.plan_reason — the AI's one-line rationale for a placement, shown as
--     "why is this here" provenance. Server-managed; cleared on manual re-triage.
--   email_action_tokens — records CONSUMED signed action tokens so each
--     tap-to-confirm email link works exactly once (expiry lives in the token).

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS ai_planning_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS plan_reason text;

CREATE TABLE IF NOT EXISTS public.email_action_tokens (
  jti uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  action text NOT NULL,
  task_id uuid,
  used_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Only system/cron/service-role paths touch this table; enable RLS with no
-- policies so the anon/authenticated roles cannot read or write it.
ALTER TABLE public.email_action_tokens ENABLE ROW LEVEL SECURITY;
