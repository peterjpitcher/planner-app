-- ============================================================
-- Add a 'cancelled' state for tasks
-- ============================================================
--
-- Cancelling a project now cascades to its open tasks. Those tasks are not
-- "done": the work was abandoned, not finished. Reusing state='done' would
-- have silently inflated the completed report and the monthly completion
-- numbers, so cancelled work gets its own terminal state.
--
-- 'cancelled' joins 'done' as a CLOSED state (see CLOSED_STATES in
-- src/lib/constants.js). Every query that previously excluded 'done' now
-- excludes both, so cancelled tasks drop out of Today, the Plan board,
-- planning candidates, the autopilot pool and the daily digest.
--
-- cancelled_at mirrors completed_at: owned exclusively by fn_task_state_cleanup,
-- never written by the app layer. Keeping the timestamp (rather than deleting
-- the row) means a project that is reopened can restore its tasks.

BEGIN;

-- 1. Allow the new state
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_state_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_state_check
  CHECK (state IN ('today', 'this_week', 'backlog', 'waiting', 'done', 'cancelled'));

-- 2. Record when a task was cancelled
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- 3. Extend the state-cleanup trigger to own cancelled_at symmetrically with
--    completed_at. Reproduces 20260709000001 unchanged and adds the two
--    cancelled_at branches, so the existing trg_task_state_cleanup binding and
--    the COALESCE fix for Office365 completion times both survive.
CREATE OR REPLACE FUNCTION fn_task_state_cleanup()
RETURNS TRIGGER AS $$
BEGIN
  -- Clear today_section when leaving today state
  IF NEW.state != 'today' AND NEW.today_section IS NOT NULL THEN
    NEW.today_section := NULL;
  END IF;
  -- Auto-set completed_at when moving to done, preserving a supplied value
  IF NEW.state = 'done' AND (OLD IS NULL OR OLD.state != 'done') THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
  END IF;
  -- Auto-clear completed_at when moving out of done
  IF OLD IS NOT NULL AND NEW.state != 'done' AND OLD.state = 'done' THEN
    NEW.completed_at := NULL;
  END IF;
  -- Auto-set cancelled_at when moving to cancelled, preserving a supplied value
  IF NEW.state = 'cancelled' AND (OLD IS NULL OR OLD.state != 'cancelled') THEN
    NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
  END IF;
  -- Auto-clear cancelled_at when moving out of cancelled
  IF OLD IS NOT NULL AND NEW.state != 'cancelled' AND OLD.state = 'cancelled' THEN
    NEW.cancelled_at := NULL;
  END IF;
  -- Track state changes
  IF OLD IS NULL OR NEW.state != OLD.state THEN
    NEW.entered_state_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Partial index for the cascade queries (find a project's open tasks) and
--    for the reopen path (find a project's cancelled tasks).
CREATE INDEX IF NOT EXISTS idx_tasks_project_state
  ON public.tasks (project_id, state);

COMMIT;
