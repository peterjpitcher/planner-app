-- ============================================================
-- Planner redesign Wave 1 A1 — remember a carried task's Today section
-- ============================================================
--
-- Additive and non-destructive. When the evening carry-forward cron demotes an
-- unfinished Good-to-Do / Quick-Wins task from Today to This Week, the state
-- trigger clears today_section; carried_section remembers what it was so the
-- next planning session can offer a one-tap "keep yesterday's plan" to restore
-- the task to the same section. NULL when the task is not a carried demotion.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS carried_section text;
