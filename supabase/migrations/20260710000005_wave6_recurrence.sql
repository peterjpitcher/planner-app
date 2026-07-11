-- ============================================================
-- Planner redesign Wave 6 — recurring tasks
-- ============================================================
--
-- Additive and non-destructive. A task with a non-null `recurrence` spawns its
-- next occurrence (server-side, in taskService) when it is completed.
--
--   recurrence          — daily | weekdays | weekly | monthly, or NULL (one-off).
--   recurrence_interval — "every N" days/weeks/months (ignored for weekdays).

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS recurrence text,
  ADD COLUMN IF NOT EXISTS recurrence_interval integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'tasks' AND constraint_name = 'tasks_recurrence_check'
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_recurrence_check
      CHECK (recurrence IS NULL OR recurrence IN ('daily', 'weekdays', 'weekly', 'monthly'));
  END IF;
END $$;
