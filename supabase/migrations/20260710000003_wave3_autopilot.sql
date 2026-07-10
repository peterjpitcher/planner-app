-- ============================================================
-- Planner redesign Wave 3 — morning autopilot + trust controls
-- ============================================================
--
-- Additive and non-destructive. No backfill (defaults suffice).
--
--   user_settings.autopilot_level — off (default) / review / auto. Governs the
--     morning-autopilot cron; 'off' preserves today's fully-manual behaviour.
--   planning_sessions.auto_planned — the session was created by the autopilot.
--   planning_sessions.reviewed_at  — when the user acknowledged an auto-built day.
--   tasks.autoplanned_at — set when the autopilot places a task into Today; drives
--     the "Auto-added" provenance label and the one-tap "Clear auto-plan" undo.

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS autopilot_level text NOT NULL DEFAULT 'off';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'user_settings' AND constraint_name = 'user_settings_autopilot_level_check'
  ) THEN
    ALTER TABLE public.user_settings
      ADD CONSTRAINT user_settings_autopilot_level_check
      CHECK (autopilot_level IN ('off', 'review', 'auto'));
  END IF;
END $$;

ALTER TABLE public.planning_sessions
  ADD COLUMN IF NOT EXISTS auto_planned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamp with time zone;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS autoplanned_at timestamp with time zone;
