# Planner 2.0 — Redesign Wave 1: Foundations (Design Spec)

**Date:** 2026-07-09
**Status:** DRAFT — awaiting your approval before implementation (per the "spec + build wave by wave, approve each wave" decision).
**Phase:** 2 (planner-automation redesign). Depends on Phase 1 (audit fixes) — merged to main.
**Source:** [2026-07-09-planning-automation-opportunities.md](../brainstorms/2026-07-09-planning-automation-opportunities.md)

## Goal of Wave 1

Remove the bulk of the nightly manual grind and close the "things get lost" black holes, **without** yet introducing autopilot, LLM planning, or new external data flows. After Wave 1 the evening ritual becomes *review-and-confirm* instead of *build-from-scratch*, captures can no longer vanish, and unwanted rows stop reappearing every night.

Four features, in dependency order:

1. **F1 — Chip-tier ranking** (the primitive everything else reads)
2. **F2 — First-class snooze** (ends groundhog-day planning)
3. **F3 — Capture inbox** (closes the biggest black hole)
4. **A1 — Stop wiping Today / carry-forward** (removes the nightly rebuild)

> **Design-intent note:** the app was deliberately built with "no auto-prioritisation, no scores." Wave 1 overrides that intent in spirit — F1 orders rows by a fixed rule and A1 pre-populates the day. It stays inspectable: **no numeric score is ever stored or shown**; ordering and placement are rule-based and explainable ("overdue 3d", "blocks others"). Flagging this explicitly because it is a real reversal of the prior direction.

---

## F1 — Chip-tier ranking (ranking without numbers)

**Problem:** chips (`high_impact`, `urgent`, `blocks_others`, `stress_relief`, `only_i_can`), `task_type`, project deadlines and `entered_state_at` are all recorded but nothing ranks with them; every list falls back to `sort_order + created_at`.

**Design:** a single deterministic comparator in `src/lib/taskSort.js`:
```
overdue (due_date < today)          →
due today / tomorrow                →
chip tier: blocks_others > urgent > high_impact > only_i_can > stress_relief →
parent-project deadline proximity (≤7 days) →
age in state (entered_state_at, older first) →
manual sort_order → created_at
```
- Pure function, unit-tested (this codebase already tests `taskSort`).
- Applied **server-side** in `GET /api/planning-candidates` so the planning modal rows arrive pre-ranked, and reused to order the Today view within each section on first load (manual drag still wins and persists).
- **No stored score, no visible number.** Output is only row order.

**Schema:** none. **Touch points:** `taskSort.js`, `planning-candidates/route.js`, `TodayView`/`PlanBoard` initial ordering.
**Risk:** a fixed chip hierarchy is opinionated; mitigated by keeping manual drag authoritative and never hiding rows.

---

## F2 — First-class snooze

**Problem:** the planning modal's Skip is not persisted (in-memory `skippedIds`), so the same rows reappear every session; there is no snooze anywhere.

**Design:**
- **Migration:** add `tasks.snoozed_until date` (nullable) and `tasks.snooze_count int not null default 0`.
- Replace modal **Skip** with **Snooze until…** (presets: tonight, 3 days, 1 week, pick date). Writes `snoozed_until` and increments `snooze_count`.
- Every candidate query gains `and (snoozed_until is null or snoozed_until <= :windowDate)` — snoozed rows disappear until their date, then are **guaranteed** to return.
- **Visibility invariant:** the Plan board shows a "Snoozed" badge and a filter, so snoozed tasks are never invisible — snooze is a *scheduled return*, not a hiding place.
- **Escalation:** once `snooze_count >= 3`, the row surfaces as a "keep / archive / schedule — you've snoozed this 3×" decision instead of another snooze.
- Expose the same snooze action on Today/Plan cards.

**Schema:** 1 additive migration. **Touch points:** `PlanningModal`, `PlanningTaskRow`, `planning-candidates/route.js`, `taskService`, `TaskCard`/board badge.
**Risk:** snooze is a procrastination lever; the count-based escalation and the Plan-board filter are the guards.

---

## F3 — Capture inbox

**Problem:** plain quick-capture and idea promotion create undated Backlog tasks nothing resurfaces; Outlook-inbound tasks (now importing to `backlog` after FF-001) also sink; the biggest black hole.

**Design (recommended — explicit flag):**
- **Migration:** add `tasks.inbox boolean not null default false`.
- Quick-capture (plain Enter), idea promotion, and Office365 inbound creation set `inbox = true` (state stays `backlog`).
- Add an **"Inbox"** group to the daily `planning-candidates` response — every captured item is *guaranteed* to appear in that evening's modal.
- Acting on an inbox row (assign to a section / defer / snooze / complete) clears `inbox`.
- Plan board shows an **inbox count badge** for daytime triage; the morning digest gets a "captured yesterday" line as a backstop even if the evening ritual is skipped.

**Alternative (lighter):** default plain captures to *undated `this_week`* (already a candidate source) + a `b␣` prefix for genuine backlog. Less code, but the Sunday demote-week cron sweeps undated `this_week` to backlog, so it narrows the black hole to a week rather than closing it. **Recommendation: the explicit `inbox` flag** — it's the durable fix and composes with the later next-review invariant (Wave 3).

**Schema:** 1 additive migration. **Touch points:** `QuickCapture`, `ideaService`/promote, `office365SyncService` (inbound create), `planning-candidates/route.js`, Plan board badge, daily-task-email.
**Risk:** heavy capture days lengthen the modal — mitigated by snooze (F2) and a per-night inbox cap with overflow rolling to the next night.

---

## A1 — Stop wiping Today / carry-forward

**Problem:** the 19:55 demote cron moves **every** Today task to This Week, so the day is rebuilt from scratch each evening. (This also subsumes the deferred FF-054 "morning rollover".)

**Design:** change `demote-today-tasks` cron from blanket demotion to **selective carry-forward**:
- Unfinished **Must Do** tasks stay in Today (same section, `sort_order` preserved), incrementing a new `tasks.carried_count`.
- Good to Do / Quick Wins demote to This Week but **preserve `today_section`** so the planning modal can offer a one-tap **"Keep yesterday's plan"** (re-promote them to their prior sections).
- Tasks carried **≥3** times surface as a "carried 3 days — still today?" exception rather than silently persisting (prevents Today silting up with zombies).
- The evening modal opens with a "Carried from today" group already placed; the ritual becomes confirm-and-adjust.

**Schema:** add `tasks.carried_count int not null default 0` (fold into F2's migration). **Touch points:** `demote-today-tasks/route.js`, `planning-candidates` (carried group), `PlanningModal`.
**Risk:** the strongest departure from "Today is wiped nightly"; the carry cap + exception surfacing keep it honest. Interacts with the FF-002 demote-timing fix already shipped — build on that gate.

---

## What is NOT in Wave 1 (deferred to later waves)

Morning autopilot (A3), the rebuilt proposal digest (A4), LLM draft (A5), next-review invariant / escalation / auto-archive (F4), trust ramp settings (F5), project radar (P1), recurrence (P4), chase engine (S1), capacity/calendar (A7). Wave 1 is deliberately rules-only and adds no new external data flow.

## Migrations (all additive, non-destructive)

One migration adds: `tasks.snoozed_until date`, `tasks.snooze_count int default 0`, `tasks.inbox boolean default false`, `tasks.carried_count int default 0`. Backfill: none required (defaults suffice). No triggers needed.

## Rollout order within the wave

F1 (comparator, no schema) → migration → F2 (snooze) → F3 (inbox) → A1 (carry-forward). Each is independently shippable and verifiable; F1 lands first because F2/F3/A1 ordering all consume it.

## Acceptance criteria (per feature)

- **F1:** planning-modal candidate order matches the comparator in a unit test; no numeric score rendered anywhere.
- **F2:** a snoozed task disappears from candidates until its date then reappears; the Plan board shows/filters it; 3rd snooze forces a decision.
- **F3:** a plain quick-capture and a promoted idea both appear in that evening's planning modal without a manual search; acting clears the inbox flag; Plan board shows the count.
- **A1:** after the evening cron, unfinished Must Do tasks remain in Today with order intact; others carry their section; one tap restores yesterday's plan; a 3×-carried task is flagged.

## Verification

Per the workspace pipeline: `npm run lint` (zero warnings), `npm test` (existing 78 + new comparator/candidate tests), `npm run build`. The migration is written as a file and applied to the live DB after your review (as in Phase 1).
