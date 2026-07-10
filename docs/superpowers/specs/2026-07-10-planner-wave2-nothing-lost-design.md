# Planner 2.0 — Redesign Wave 2: Nothing Gets Lost + a Useful Digest (Design Spec)

**Date:** 2026-07-10
**Status:** DRAFT — awaiting approval before implementation (per "approve each wave").
**Phase:** 2, Wave 2. Builds on Wave 1 (F1 ranking, F2 snooze, F3 inbox, A1 carry-forward — merged to `main`).
**Source:** [2026-07-09-planning-automation-opportunities.md](../brainstorms/2026-07-09-planning-automation-opportunities.md)

## Goal of Wave 2

Wave 1 stopped *new* captures getting lost and removed the nightly rebuild. Wave 2 makes two guarantees:

1. **F4 — Next-review invariant:** nothing can sit unseen forever. Every task and every "Ready Later" idea has a future moment that resurfaces it — snoozed tasks return (Wave 1), dated tasks surface by date, and now **ageing backlog tasks and due-for-review ideas resurface automatically** for a triage decision.
2. **A4 — Proposal digest:** the morning email becomes a picture of the whole planned day (and what needs a decision), not just a list of already-dated Today tasks.

Both are **rules-only**, reuse fields that already exist, and need **no new external data flow**. No LLM yet.

---

## F4 — Next-review invariant (nothing lost long-term)

**Problem:** an undated Backlog task that missed its one inbox moment, or a "Ready Later" idea with a `review_date`, is never resurfaced — the vault is a black hole. Wave 1 closed the *capture* hole; this closes the *long-term* hole.

**Design — the invariant:** a task is always in exactly one "will be seen again" state:
- `today` / `this_week` — active, seen in views.
- has a `due_date` — surfaces via the date buckets.
- `snoozed_until` set — returns on its date (Wave 1).
- `waiting` with `follow_up_date` — chased (existing staleness).
- **`backlog` — resurfaces once it has aged past a threshold** (this is the new guarantee).

Implementation (no schema change — uses existing `entered_state_at`):
- Add a **"Review backlog"** bucket to the daily `planning-candidates`: `state='backlog' AND inbox=false AND NOT snoozed AND entered_state_at < today − STALE_BACKLOG_DAYS` (default **14**). Ordered by the F1 comparator, **capped** (e.g. 10/night) with a logged "N more ageing in backlog" note so it never floods the modal. Acting on a row (assign/defer/snooze/complete) resets `entered_state_at` via the existing trigger, so it won't re-nag until it ages again.
- **Ideas due for review:** surface `idea_state='ready_later' AND review_date <= today` in two places — a **"Due for review"** section at the top of the Ideas vault (with a count badge), and a line in the A4 digest. Reviewing/rescheduling an idea updates or clears `review_date`. (Ideas remain separate from task candidates — they are not injected into the planning modal.)

**Schema:** none (constants only). **Touch points:** `planning-candidates/route.js` (+ new bucket + cap), `PlanningModal`/`PlanningTaskRow` (render the "Review backlog" group, styled as a gentle "still needed?" prompt), `ideaService`/`api/ideas` (due-for-review query), `IdeaVault`/`IdeaCard` (section + reschedule action), `constants.js` (STALE_BACKLOG_DAYS, cap).
**Risk:** resurfacing old backlog can feel naggy — mitigated by the cap, the ageing reset on any action, and snooze (F2) to push a specific item out further.

---

## A4 — Proposal-style morning digest

**Problem:** `buildDailyTaskEmail` only lists `state='today'` tasks that also have `due_date <= today`. It is blind to undated Today tasks, the inbox, snoozed-returning items, carried-forward work, and anything needing a decision — so it reports on a partial plan rather than presenting the day.

**Design:** rebuild the digest (server-side, `dailyTaskEmailService.buildDailyTaskEmail`) into a structured morning brief:
- **Your day** — Today's three sections (Must Do / Good to Do / Quick Wins) in full, each task with its project and any chip labels, ordered by F1.
- **Carried forward** — unfinished Must Do carried from yesterday (A1), and the count of items that demoted to This Week.
- **Needs a decision** — the exception block: inbox items awaiting triage (F3), tasks whose snooze returns today (F2), overdue tasks, over-cap sections, stale `waiting` follow-ups, 3×-snoozed items, and carried-3-days items.
- **Ideas to revisit** — ideas due for review today (F4).
- A single link to the app (no per-task action links this wave — see below).

**Explicitly deferred to a later wave:** signed one-tap "confirm plan / defer" **action links** in the email. They are a real security surface (must be single-use, task-scoped, expiring) and belong with the autopilot wave (A3/A5), not here. Wave 2's digest is **read-only** — it informs; the app still acts.

**Schema:** none. **Touch points:** `dailyTaskEmailService.js` (rebuild `buildDailyTaskEmail` + the data it fetches), reusing the same send pipeline and idempotency (`daily_task_email_runs`). The two existing cron schedules are unchanged.
**Risk:** a much richer email could get long — mitigated by collapsing empty sections and capping list lengths with "+N more". The email must degrade gracefully when a section is empty (no broken layout).

---

## What is NOT in Wave 2

Morning autopilot / auto-built day (A3), LLM draft (A5), signed email action links, trust-ramp settings + per-item "why is this here" + automation on/off levels (F5), project-altitude radar (P1), recurrence (P4), the waiting chase engine's outbound nudges (S1), capacity/calendar awareness (A7). These land in later waves.

## Rollout order within the wave

F4 backlog-ageing bucket (candidates) → F4 idea review surfacing (vault + service) → A4 digest rebuild (consumes all of the above). Each independently shippable and verifiable.

## Acceptance criteria

- **F4 tasks:** a backlog task untouched for > STALE_BACKLOG_DAYS appears in the "Review backlog" group in the planning modal (capped, with an overflow note); acting on it removes it and it does not immediately re-nag.
- **F4 ideas:** a "Ready Later" idea whose `review_date` has passed appears in the Ideas vault "Due for review" section and in the digest; rescheduling it removes it.
- **A4:** the digest shows all three Today sections (incl. undated tasks), the carried-forward summary, the "Needs a decision" exceptions, and ideas-to-revisit; empty sections are omitted cleanly; long lists truncate with "+N more".

## Verification

Workspace pipeline: `npm run lint` (zero warnings), `npm test` (existing 119 + new candidate/digest unit tests — mock Supabase/Graph, never send a real email), `npm run build`. No migration this wave.
