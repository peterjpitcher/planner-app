-- Add urgency/importance scoring to tasks for visual prioritisation (unique migration version)

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS importance_score integer,
  ADD COLUMN IF NOT EXISTS urgency_score integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tasks_importance_score_range'
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_importance_score_range
      CHECK (importance_score IS NULL OR (importance_score >= 0 AND importance_score <= 100));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tasks_urgency_score_range'
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_urgency_score_range
      CHECK (urgency_score IS NULL OR (urgency_score >= 0 AND urgency_score <= 100));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_user_scores
  ON public.tasks (user_id, importance_score DESC, urgency_score DESC);
