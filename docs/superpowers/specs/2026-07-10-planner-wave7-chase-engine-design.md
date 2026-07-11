# Planner 2.0 — Redesign Wave 7: Waiting Chase Engine (Design Spec)

**Date:** 2026-07-10
**Status:** Approved to build (user "continue to wave 7" + delegated). Wave-by-wave; merge at the end.
**Phase:** 2, Wave 7 (S1). Builds on Waves 1–6 (all merged to `main`).

## Goal of Wave 7

Things you're *waiting on* (blocked on someone else) quietly rot: a `waiting` task has a `follow_up_date`, but nothing proactively makes you chase when that date arrives, and once you do chase there's no easy way to re-arm the reminder. S1 makes waiting tasks **chase themselves**: due chases are surfaced in the evening plan, a one-tap "Chased — remind me again" re-arms the follow-up, and a task chased too many times is escalated to a real decision.

**Scope guard:** this is the *safe* chase engine — it surfaces and re-arms **your own reminders**. It does NOT send any outbound message to a third party (that would need per-send confirmation and is out of scope). No LLM, no new external data flow.

## Data model (one additive migration)

- `tasks.chase_count integer NOT NULL DEFAULT 0` — how many times a waiting task's follow-up has been re-armed (a "chase"). Server-managed (never client-writable), mirroring `snooze_count`.

## Backend

- **Chase-due candidates:** `planning-candidates` gains a daily **`chaseDue`** bucket — `state='waiting' AND follow_up_date IS NOT NULL AND follow_up_date <= windowDate`, snooze-aware, F1-ordered, deduped from the other buckets (waiting tasks aren't in them). So the evening plan prompts "chase these".
- **chase_count increment (taskService):** when an update moves a `waiting` task's `follow_up_date` to a **later** date than it currently has (a genuine re-chase), increment `chase_count` server-side (read-modify-write, like `snooze_count`). Setting an earlier/equal date, or clearing it, does not increment. `chase_count` is added to the select and is never in the update allowlist.
- Digest: the existing "Waiting — needs a chase" decision group is kept; annotate each with "chased N×" when `chase_count > 0` (small addition).

## Re-arm + escalation (UI)

- On waiting tasks — in the planning modal's new "Chase these" group (via `PlanningTaskRow`), on the Plan board's Waiting cards, and in the task drawer — a **"Chased — remind me in…"** control (presets: 3 days / 1 week / pick a date) that sets `follow_up_date` forward (incrementing `chase_count`), plus the existing move-out-of-waiting ("Unblock") path.
- **Escalation:** when `chase_count >= 3`, show a distinct "Chased 3× — escalate or drop?" prompt instead of offering another plain re-arm (the user must unblock / complete / reschedule; an explicit re-arm is still allowed but flagged), mirroring the Wave 1 snooze escalation.
- A "chased N×" indicator on the waiting card so the history is visible; not colour-only.

## What is NOT in Wave 7

Any outbound email/SMS/chat to the person you're waiting on (needs explicit per-send confirmation — out of scope), auto-completing a waiting task, a full contacts/CRM link, and anything LLM/capacity-related.

## Rollout order

migration → planning-candidates `chaseDue` bucket + taskService `chase_count` + select → planning modal "Chase these" group + re-arm/escalation in `PlanningTaskRow` → Plan-board Waiting-card chase action + drawer + the "chased N×" indicator → digest annotation.

## Acceptance criteria

- A `waiting` task whose `follow_up_date` is today or earlier appears in the evening planning modal's "Chase these" group and in the digest.
- "Chased — remind me in 3 days" moves the follow-up forward and increments `chase_count`; setting an earlier date or clearing it does not increment.
- At `chase_count >= 3` the re-arm is replaced by an escalate/drop prompt.
- `chase_count` is server-managed (a client can't set it); snoozed waiting tasks don't surface as chases until the snooze lapses.
- Non-waiting tasks and waiting tasks with no follow-up date are unaffected by the chase logic.

## Verification

Workspace pipeline: `npm run lint`, `npm test` (existing 236 + new chase-bucket / chase_count-increment unit tests, mocked IO), `npm run build`. Migration applied to the live DB. Adversarial interaction review of the whole Wave 7 diff before merge.
