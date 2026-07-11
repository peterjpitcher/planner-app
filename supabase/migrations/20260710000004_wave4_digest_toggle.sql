-- ============================================================
-- Planner redesign Wave 4 — automation control: digest on/off
-- ============================================================
--
-- Additive and non-destructive. Lets the owner switch the morning digest email
-- off from the Automations control panel. Autopilot already has autopilot_level
-- and Outlook sync already has office365_connections.sync_enabled; the demote
-- crons stay always-on (shown in the heartbeat, not toggled).

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS digest_enabled boolean NOT NULL DEFAULT true;
