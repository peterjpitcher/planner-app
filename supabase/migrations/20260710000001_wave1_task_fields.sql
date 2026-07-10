-- ============================================================
-- Planner redesign Wave 1 — foundation columns on tasks
-- ============================================================
--
-- Additive and non-destructive. Adds the four fields the Wave 1 foundations
-- need; existing rows take the defaults, so no backfill is required.
--
--   snoozed_until  (F2) — a task is hidden from planning candidates until this
--                   date, then guaranteed to resurface. NULL = not snoozed.
--   snooze_count   (F2) — number of times the task has been snoozed; drives the
--                   "you've snoozed this 3x — decide" escalation.
--   inbox          (F3) — true for freshly captured / promoted / Office365-pulled
--                   tasks that have not yet been triaged; guarantees they appear
--                   in the next planning session. Cleared once actioned.
--   carried_count  (A1) — number of consecutive days an unfinished Today task has
--                   been carried forward; drives the "carried 3 days" exception.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS snoozed_until date,
  ADD COLUMN IF NOT EXISTS snooze_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inbox boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS carried_count integer NOT NULL DEFAULT 0;

-- Partial indexes to keep the candidate-query filters cheap.
CREATE INDEX IF NOT EXISTS idx_tasks_snoozed_until
  ON public.tasks (user_id, snoozed_until)
  WHERE snoozed_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_inbox
  ON public.tasks (user_id)
  WHERE inbox = true;
