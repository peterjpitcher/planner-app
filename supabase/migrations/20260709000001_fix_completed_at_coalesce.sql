-- ============================================================
-- Fix: preserve a supplied completed_at when a task enters 'done'
-- ============================================================
--
-- fn_task_state_cleanup is the single owner of tasks.completed_at. The original
-- version (20260404000001_prioritisation_replacement.sql) unconditionally stamped
-- now() whenever a task entered the 'done' state, which clobbered a legitimately
-- supplied completion time — most notably the real Graph completedDateTime pushed
-- in by the Office365 pull (FF-021). Now the app layer no longer writes
-- completed_at at all (see taskService.js), so this trigger is the only writer.
--
-- Change: on the branch that enters 'done', use COALESCE(NEW.completed_at, now())
-- so an explicitly provided completion time is preserved and only falls back to
-- now() when none was supplied. The leaving-'done' branch (null it out) and the
-- entered_state_at tracking are reproduced unchanged.
--
-- CREATE OR REPLACE keeps the existing trg_task_state_cleanup trigger binding, so
-- the trigger itself does not need to be recreated.

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
  -- Track state changes
  IF OLD IS NULL OR NEW.state != OLD.state THEN
    NEW.entered_state_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
