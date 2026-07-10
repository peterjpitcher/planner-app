# Planner 2.0 — Redesign Wave 3: Morning Autopilot + Trust Controls (Design Spec)

**Date:** 2026-07-10
**Status:** Approved to build (user delegated: "do whatever you recommend best"). Wave-by-wave; will merge at the end of the wave.
**Phase:** 2, Wave 3. Builds on Wave 1 (ranking/snooze/inbox/carry) and Wave 2 (nothing-lost/digest), both merged to `main`.

## Goal of Wave 3

Deliver the north-star outcome — **"I don't have to plan my day"** — safely. An opt-in early-morning cron builds today's plan when you didn't plan last night, using the same F1 ranking and soft caps. The safety layer (F5-lite) makes it trustworthy: it is **off by default**, has a **review/undo** path, and every auto-placed task says **why it's there**.

Two parts: **A3 Morning Autopilot** and **F5-lite Trust Controls**.

> Design-intent note: this is the furthest step from the app's original "no automation" ethos, so the guard-rails are non-negotiable — default off, explicit review, one-tap clear, visible provenance. No LLM (rules only, reusing F1).

## Data model (one additive migration)

- `user_settings.autopilot_level text NOT NULL DEFAULT 'off'` — CHECK in ('off','review','auto').
- `planning_sessions.auto_planned boolean NOT NULL DEFAULT false` and `planning_sessions.reviewed_at timestamptz` — mark a session the autopilot created and whether the user has acknowledged it.
- `tasks.autoplanned_at timestamptz` — set when the autopilot places a task into Today; drives provenance and the one-tap clear. Cleared on any manual re-triage (state/section change) via the existing trigger-adjacent reset in taskService.

All additive; no backfill.

## A3 — Morning Autopilot

**Shared rule engine (new `src/services/autopilotService.js`):** `buildAutopilotPlan({ supabase, userId, windowDate })` — fetches the same candidate pool the planning modal uses (extract/reuse the daily candidate query so the two never diverge), ranks with the F1 comparator, and assigns to Today sections respecting the soft caps:
- overdue + due-today → **Must Do** (cap 5, highest-ranked first),
- `task_type` quick items → **Quick Wins** (cap 8),
- remainder → **Good to Do** (cap 5); anything beyond the caps is left where it is (surfaces in the digest/modal as usual).
Placed tasks get `state='today'`, the section, an append `sort_order`, and `autoplanned_at=now`. Carried Must Do already in Today are kept and counted against the cap. Returns a summary (counts per section, left-over count).

**Cron `/api/cron/morning-autopilot`:** dual UTC schedule (`0 4 * * *` + `0 5 * * *`) gated to exactly London hour 05 (mirrors the demote/email gate), idempotent via `cron_runs`. For the digest user: if `autopilot_level != 'off'` AND no daily `planning_sessions` row exists for **today's** date (so it never overrides an evening plan the user already made for today), run `buildAutopilotPlan({ windowDate: todayLondon })`, then upsert a `planning_sessions` row (`window_type='daily'`, `window_date=today`, `auto_planned=true`). Runs before the 08:00 digest, so the digest reflects the built day. Records partial status if any placement fails.

## F5-lite — Trust Controls

- **Level setting** (`autopilot_level`, default **off**): `off` (nothing — current behaviour), `review` (autopilot builds the day but the app shows a prominent "I built your day — review it" banner until acknowledged), `auto` (builds the day; a lighter "Your day's ready — auto-built" banner). Both levels place tasks; the difference is banner prominence and whether `reviewed_at` gates it.
- **Review / undo banner** (Today view + AppShell): when today's session is `auto_planned` and (`review` level and not yet `reviewed_at`), show a banner with **Looks good** (stamps `reviewed_at`), **Re-plan** (opens the planning modal), and **Clear auto-plan** (moves every still-`autoplanned_at`, un-touched task back to `this_week`, clears the flag, deletes the session). `auto` level shows the same banner minus the "review required" emphasis.
- **Provenance — "why is this here":** Today `TaskCard`s show a small, non-colour-only label: **Auto-added** (`autoplanned_at` set), **Carried** (`carried_count > 0`), **Snoozed-return** (returned from snooze today — optional if cheap). Derived from existing fields; no colour-only signalling (a11y).
- **Settings UI:** an autopilot selector in `/settings/planning` (Off / Review each morning / Fully automatic) with a one-line explanation of each, saved via the existing user-settings PATCH.

## What is NOT in Wave 3

LLM-drafted plans (A5), signed email action links, capacity/calendar awareness (A7), the full per-automation on/off matrix and heartbeat/health page (rest of F5), project-radar (P1), recurrence (P4), chase-engine outbound (S1). This wave is one automation (morning plan) plus the controls that make it safe.

## Rollout order within the wave

migration → autopilotService rule engine (reuse candidate query + F1 + caps) → morning-autopilot cron + vercel schedule → user-settings autopilot_level plumbing → settings UI → review/undo banner → provenance labels. Backend first, then UI.

## Acceptance criteria

- With `autopilot_level='off'` nothing changes (safe default; no session, no placement).
- With `'review'`: after the 05:00 cron on an unplanned day, Today is populated (caps respected, F1 order), a review banner shows, "Clear auto-plan" empties it back to This Week, "Looks good" dismisses it.
- If the user already planned last night (a session for today exists), the autopilot skips entirely.
- Auto-placed tasks show an "Auto-added" label; carried tasks show "Carried".
- The rule engine and the planning modal draw from the same candidate definition (no divergence).
- Idempotent: a second cron run the same morning places nothing new and does not duplicate the session.

## Verification

Workspace pipeline: `npm run lint` (zero warnings), `npm test` (existing 139 + new autopilot rule-engine unit tests — mock Supabase, never place against a real DB), `npm run build`. Migration applied to the live DB after it is written. Adversarial interaction review of the whole Wave 3 diff before merge.
