# Planner 2.0 — Redesign Wave 8: AI Day-Planner + Tap-to-Confirm Email Actions (Design Spec)

**Date:** 2026-07-11
**Status:** Approved to build (user chose both features; confirmed OK to send task titles + notes to OpenAI). Merge at the end of the wave.
**Phase:** 2, Wave 8 (A5 + signed email action links). Builds on Waves 1–7 (all merged to `main`).

## Goal of Wave 8

Two features:
1. **A5 — AI day-planner:** an AI (OpenAI, already used for the journal) drafts how to arrange your day from the candidate tasks, with a one-line reason per task. It's opt-in, and the deterministic Wave-1 rules are the fallback whenever the AI is off or fails — so a plan is always produced.
2. **Email actions:** the morning digest gets **tap-to-confirm buttons** — confirm today's plan, or mark a task done — via signed, single-use, expiring links, so you can act from your inbox without opening the app.

## Data model (one additive migration; then reconcile the ledger)

- `user_settings.ai_planning_enabled boolean NOT NULL DEFAULT false` — opt-in to AI drafting.
- `tasks.plan_reason text` — the AI's one-line rationale for where it placed a task (shown as "why is this here" provenance). Server-managed; cleared on manual re-triage like `autoplanned_at`.
- `email_action_tokens (jti uuid PK, user_id uuid NOT NULL, action text NOT NULL, task_id uuid, used_at timestamptz NOT NULL DEFAULT now())` — records **consumed** action tokens so each link works exactly once. (Expiry is carried inside the signed token, not stored.)

## A5 — AI day-planner

**`src/services/aiPlannerService.js`** (reuses the journal's OpenAI client pattern):
- `draftPlanWithAI({ candidates, caps, todayKey })` → calls OpenAI (gpt-4o) with the candidate tasks (title, notes/description, chips, due date, project, age) and the soft caps, requesting **structured JSON**: `{ assignments: [{ taskId, section, reason }] }` where section ∈ must_do/good_to_do/quick_wins. Validates the JSON (only known task ids, caps respected — trim overflow), returns `null` on any error/timeout so the caller falls back to rules. British-English reasons, ≤12 words. No secrets logged.
- Integrated into `buildAutopilotPlan` (Wave 3): when `ai_planning_enabled`, try `draftPlanWithAI` first; if it returns a valid plan use it and store each task's `plan_reason`; otherwise fall back to the existing rule-based assignment. Caps are always enforced in code regardless of what the model returns.
- On-demand: a **"Draft my day with AI"** button in the planning modal → `POST /api/planning/ai-draft` (session-auth) runs `draftPlanWithAI` over the current daily candidates and returns the suggested section per task with its reason, which the modal pre-selects (the user still confirms each / taps "Accept all").

**Settings:** an "AI day-planner" toggle in Settings → Planning (`ai_planning_enabled`), with a plain-English note that it sends task titles and notes to OpenAI. Surfaced in the Automations heartbeat as another automation.

**Provenance:** auto-placed tasks with a `plan_reason` show it in the drawer / as a tooltip on the "Auto-added" label, so the AI's reasoning is visible and inspectable.

## Email actions (signed, single-use, expiring)

**`src/lib/emailActionToken.js`:** `signActionToken({ userId, action, taskId?, ttlMinutes })` → `base64url(payload).base64url(HMAC-SHA256(payload, EMAIL_ACTION_SECRET))`, payload `{ jti, uid, act, tid?, exp }`. `verifyActionToken(token)` → `{ valid, payload, reason }` (checks signature + expiry). New env var `EMAIL_ACTION_SECRET` (documented in `.env.example`); if unset, email actions are simply not rendered (feature-flagged off, fail-safe).

**Route `src/app/api/actions/[token]/route.js`:**
- **GET** renders a small self-contained confirmation page ("Mark 'X' as done?" / "Confirm today's plan?") with a single **Confirm** button that POSTs — so an email client PRE-FETCHING the link never performs the action (avoids accidental single-use consumption). No app session required; the signed token is the authorisation.
- **POST** verifies the token, checks `email_action_tokens` for the `jti` (reject if already used), performs the action, records the `jti`, and shows a done page with a link into the app. Actions: `confirm_plan` (stamp today's daily `planning_sessions.reviewed_at`), `task_done` (complete the task, scoped to `uid`), `task_defer` (push the task's due date, scoped to `uid`). All actions re-check ownership by `uid`.

**Digest (A4):** when `EMAIL_ACTION_SECRET` is set, add a **"Confirm today's plan"** button and per-task **"Done"** links on the overdue + quick-win items (capped), each a freshly-signed token (ttl ~48h).

## Security notes (email actions)

Signed (HMAC, server secret) + expiring (exp in token) + single-use (jti recorded on use) + ownership-checked (uid re-verified) + GET-renders-confirm-POST-acts (prefetch-safe) + feature-flagged off when the secret is unset. No token or secret is logged. The link is the only authority, so tokens are short-TTL and one action each.

## What is NOT in Wave 8

Streaming AI, AI editing tasks/writing content, multi-day AI planning, arbitrary email actions beyond confirm/done/defer, and outbound chase messaging (user chose reminder-only in Wave 7).

## Rollout order

migration + ledger reconcile → A5 backend (service + autopilot + ai-draft route + settings) → A5 frontend (toggle + Draft-with-AI button + reason display) → email-action token lib + action route/page + digest buttons → adversarial review → fixes → merge.

## Acceptance criteria

- With `ai_planning_enabled=false` nothing calls OpenAI; the plan is exactly the Wave-1 rules (unchanged).
- With it on, the morning autopilot / "Draft with AI" uses the model, respects the soft caps in code, stores a `plan_reason`, and falls back to rules on any AI error (a plan is always produced).
- An email action link works exactly once, refuses after expiry, refuses a tampered token, only affects the owning user's data, and a prefetch of the GET link does not perform the action.
- If `EMAIL_ACTION_SECRET` is unset, the digest renders no action buttons and nothing breaks.

## Verification

Workspace pipeline: `npm run lint`, `npm test` (existing 246 + new AI-plan-validation, token sign/verify, and digest-button unit tests — OpenAI mocked, no real calls), `npm run build`. Migration applied to the live DB and the ledger reconciled. Adversarial interaction + security review of the whole Wave 8 diff before merge (esp. the token flow).
