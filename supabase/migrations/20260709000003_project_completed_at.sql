-- ============================================================
-- FF-004: Add projects.completed_at so the completed-items report
--         keys off a stable completion timestamp, not updated_at
-- ============================================================
--
-- The completed-items report filtered completed projects by projects.updated_at
-- between the reporting window. But updated_at churns constantly — it is bumped
-- by every task create/update/delete on the project and by the every-minute
-- Office365 sync — so a project completed in month M drifts into a later month
-- (or vanishes from its own month) as soon as anything touches it.
--
-- Tasks already have a stable tasks.completed_at maintained by the
-- fn_task_state_cleanup trigger; projects never got the equivalent column. This
-- migration mirrors that pattern for projects:
--   (a) add projects.completed_at,
--   (b) add a BEFORE INSERT OR UPDATE trigger that stamps completed_at when the
--       status transitions into 'Completed' and clears it when it leaves, and
--   (c) backfill completed_at = updated_at for existing completed projects.
--
-- NOTE: src/app/api/completed-items/route.js is updated to filter/report on
-- projects.completed_at. That code change REQUIRES this migration to be applied
-- first — until the column exists the projects query will error.

-- (a) Add the column (nullable; only set while status = 'Completed')
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- (b) Trigger function: set/clear completed_at on status transitions.
-- Mirrors fn_task_state_cleanup (COALESCE preserves a supplied value on entry,
-- NULL on exit). Fires BEFORE INSERT OR UPDATE so a project created directly as
-- 'Completed' is also stamped.
CREATE OR REPLACE FUNCTION public.fn_project_completed_at()
RETURNS TRIGGER AS $$
BEGIN
  -- Entering 'Completed' — stamp completion time, preserving any supplied value
  IF NEW.status = 'Completed' AND (OLD IS NULL OR OLD.status <> 'Completed') THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
  END IF;
  -- Leaving 'Completed' — clear the completion time
  IF OLD IS NOT NULL AND NEW.status <> 'Completed' AND OLD.status = 'Completed' THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_completed_at ON public.projects;
CREATE TRIGGER trg_project_completed_at
  BEFORE INSERT OR UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.fn_project_completed_at();

-- (c) Backfill existing completed projects from updated_at. Best-available proxy
-- for historical completions; idempotent via the IS NULL guard. The trigger sees
-- no status change on this UPDATE, so it leaves the assigned value untouched.
UPDATE public.projects
  SET completed_at = updated_at
  WHERE status = 'Completed' AND completed_at IS NULL;

-- Support the report's window filter on the new column
CREATE INDEX IF NOT EXISTS idx_projects_user_completed_at
  ON public.projects (user_id, completed_at DESC)
  WHERE completed_at IS NOT NULL;
