-- ============================================================
-- FF-011: persist a "reconnect needed" state on the connection
-- ============================================================
--
-- When the Microsoft refresh token expires or is revoked (OAuth
-- invalid_grant / interaction_required), every automatic sync fails forever
-- while the status endpoint keeps reporting a healthy connection. These columns
-- let the connection service record a persistent error so the status endpoint
-- and settings UI can prompt the user to reconnect. The error is cleared on the
-- next successful token refresh or (re)connect.
--
-- Additive and non-destructive (IF NOT EXISTS); no data is dropped.

ALTER TABLE public.office365_connections
  ADD COLUMN IF NOT EXISTS sync_error text,
  ADD COLUMN IF NOT EXISTS sync_error_at timestamp with time zone;
