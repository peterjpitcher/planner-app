-- ============================================================
-- Planner redesign Wave 7 — waiting chase engine
-- ============================================================
--
-- Additive and non-destructive. Tracks how many times a waiting task's
-- follow-up has been re-armed (a "chase"), so the app can escalate a task that
-- has been chased too many times. Server-managed (never client-writable),
-- mirroring snooze_count.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS chase_count integer NOT NULL DEFAULT 0;
