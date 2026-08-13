-- ============================================================
-- Restore the hardened search_path on fn_task_state_cleanup
-- ============================================================
--
-- 20260527061836_security_hardening set an immutable search_path on nine public
-- functions. Eight still have it. fn_task_state_cleanup lost it, because
-- CREATE OR REPLACE FUNCTION resets every property not restated in the command,
-- including SET clauses (Postgres: "All other function properties are assigned
-- the values specified or implied in the command"). Two later migrations
-- replaced this function without restating it:
--
--   20260709000001_fix_completed_at_coalesce   (dropped it first)
--   20260813111540_task_cancelled_state        (reproduced the omission)
--
-- Impact is low: the function is SECURITY INVOKER, so it already executes with
-- the caller's own privileges rather than the definer's. This restores parity
-- with its eight siblings and closes the drift.
--
-- The fix is the SET clause INSIDE the function definition rather than a
-- separate ALTER FUNCTION. An out-of-band ALTER is exactly what got silently
-- undone twice; carried in the definition, it survives any future
-- CREATE OR REPLACE that starts from this body.

CREATE OR REPLACE FUNCTION fn_task_state_cleanup()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
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
$$;
