# Planner 2.0 — Redesign Wave 4: Automation Control Panel + Heartbeat (Design Spec)

**Date:** 2026-07-10
**Status:** Approved to build (user delegated + "continue to wave 4"). Wave-by-wave; merge at the end of the wave.
**Phase:** 2, Wave 4 (completes F5). Builds on Waves 1–3 (all merged to `main`).

## Goal of Wave 4

Give the owner one place to **see and govern every automation**, and to tell at a glance **whether each one is actually working**. This completes the F5 "trust ramp": Wave 3 added the autopilot level, provenance and undo; Wave 4 adds the control panel + a heartbeat that surfaces silent cron failures (the documented "no emails flowing / cron quietly stopped" risk).

Rules-only, no new external data flow, no LLM.

## Data model (one additive migration)

- `user_settings.digest_enabled boolean NOT NULL DEFAULT true` — lets the owner switch the morning digest email off. (Autopilot already has `autopilot_level`; Office365 sync already has `office365_connections.sync_enabled`; the demote crons are core lifecycle and stay always-on — shown, not toggled.)

## Backend

**GET `/api/automations` (session-auth, user-scoped)** — returns:
- `settings`: `{ autopilot_level, digest_enabled, office365_sync_enabled }` (the last from the user's `office365_connections.sync_enabled`, or null if not connected).
- `health`: one entry per automation with `{ key, label, description, lastRunAt, status, detail }`:
  - **Morning autopilot** — latest `cron_runs` row where `operation='morning-autopilot'` (status, run_date).
  - **Evening tidy (Today → This Week)** — latest `cron_runs` `operation='demote_today'`.
  - **Weekly tidy (This Week → Backlog)** — latest `cron_runs` `operation='demote_week'`.
  - **Morning digest email** — latest `daily_task_email_runs` for the user (status, sent_at).
  - **Outlook sync** — `office365_connections` for the user (`last_synced_at`, `sync_error`/`sync_error_at`, `sync_enabled`).
  Status is normalised to `ok` | `partial` | `failed` | `off` | `never` (with a stale flag when the last run is older than expected — e.g. a daily job not seen in >48h). No secrets returned.

**Digest gating:** `/api/cron/daily-task-email` skips (records a `skipped: digest_disabled` result) when the resolved user's `digest_enabled` is false. Idempotency and schedules unchanged.

**Settings plumbing:** `/api/user-settings` GET returns `digest_enabled`; PATCH accepts and validates it (boolean). Existing time-field + autopilot validation untouched.

## Frontend

An **"Automations"** section on the Planning settings page (co-located with the existing autopilot selector — no new nav):
- **Controls:** the autopilot level (already present), a **Morning digest email** on/off toggle (`digest_enabled`), and a read-only note pointing to Settings → Integrations for the Outlook sync toggle.
- **Heartbeat list:** each automation as a row — friendly label + one-line description, a status pill (Working / Ran with problems / Failed / Off / Not run yet, **not colour-only** — text + icon), and a relative "last ran …" time (via the project's date utils, Europe/London). A stale daily job (no run in >48h) is flagged "hasn't run recently".
- Handles loading (skeleton), empty (no runs yet → "Not run yet"), and error (inline message, retry) states. Fetches from `/api/automations` on mount and on focus.

## What is NOT in Wave 4

Toggles for the core demote crons (they stay always-on; only shown), per-automation scheduling UI, alerting/notifications on failure (surfaced in-app only this wave), and anything LLM/capacity-related (later waves).

## Rollout order

migration → user-settings digest_enabled + digest cron gating → GET /api/automations → Automations UI (controls + heartbeat).

## Acceptance criteria

- The Automations section lists all five automations with a last-run time and a correct status pill; a never-run automation shows "Not run yet"; a `failed`/`partial` cron_runs row shows the matching pill.
- Turning the digest off (`digest_enabled=false`) makes the 08:00 cron skip (no email) and record a `digest_disabled` result; turning it back on resumes it.
- A daily automation with no run in >48h is flagged as stale.
- Status is never conveyed by colour alone.
- No secrets (tokens, secret ids) are returned by `/api/automations`.

## Verification

Workspace pipeline: `npm run lint`, `npm test` (existing 155 + new status-normalisation/gating unit tests, mocked IO), `npm run build`. Migration applied to the live DB. Adversarial interaction review of the whole Wave 4 diff before merge.
