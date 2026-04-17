# Adversarial Review: Plan Modal "Today vs Tomorrow" Fix

**Date:** 2026-04-17
**Mode:** Mode B — Code Review (Adversarial)
**Engines:** Codex (Repo Reality Mapper, Assumption Breaker, Workflow/Failure-Path, Integration/Architecture)
**Scope:** `src/components/planning/PlanningModal.jsx` (single-file diff applied in working tree)
**Spec:** N/A (bug fix)

## Inspection Inventory

### Inspected
- Claude's applied diff (`git diff src/components/planning/PlanningModal.jsx`)
- `src/components/planning/PlanningModal.jsx`, `PlanningTaskRow.jsx`
- `src/hooks/usePlanningPrompt.js`
- `src/lib/planningWindow.js`, `timezone.js`, `constants.js`, `dateUtils.js`, `apiClient.js`
- `src/components/layout/AppShell.jsx`, `Header.jsx`
- `src/app/api/planning-sessions/route.js`, `planning-candidates/route.js`, `tasks/route.js`
- `src/services/taskService.js`
- `src/components/today/TodayView.jsx`, `PlanBoard.jsx`, `calendar/CalendarView.jsx`, `Projects/ProjectsView.jsx`
- `supabase/migrations/20260414000001_add_planning_tables.sql`, `20260404000001_prioritisation_replacement.sql`

### Not Inspected
- `src/lib/__tests__/` test bodies — targeted grep showed no coverage of `planningWindow` / `timezone`
- `PlanningBanner.jsx` internals — not on the fix path
- Archived `.claude/worktrees/` copies

### Limited-Visibility Conclusions
- Race-condition severity for concurrent `sort_order` assignment is confirmed present but its real-world impact depends on multi-device usage patterns we can't observe.

## Executive Summary

Claude's label fix (`targetIsToday` from `windowDate === getLondonDateKey()`) solves the user's visible complaint and the daily section heading regression. The zero-assignment guard + hint partially addresses "Finish Planning adds nothing" but **leaks in three common user flows** (Defer-only, Skip-only, reopen-after-partial), and a **pre-existing getDueDateStatus bug** renders every due-today task with an "Overdue" chip — now far more visible because the parent section header reads "Due Today". There is also a **real cross-context bug** in `handleDefer` that uses `getLondonDateKey()` instead of `windowDate` to compute the week boundary, causing deferred tasks to be wrongly demoted to backlog during Sunday weekly planning. Recommendation: ship the label + hint + guard (keep), apply four targeted follow-up fixes before closing the ticket.

## What Appears Solid

- Label computation: `targetIsToday = step !== 'weekly' && windowDate === getLondonDateKey()` correctly handles manual Plan Today, auto morning wrap, auto evening, and weekly modes.
- Section heading change from "Due Tomorrow" → "Due Today" tracks the title correctly.
- `handleFinish` dep array is correct for the values it reads (`assignedCount`, `currentTasks.length`).
- `createPlanningSession` is idempotent (DB unique constraint + upsert).
- `window.confirm` is accessible (native) and the hint `<p>` doesn't break a11y inside Headless UI Dialog.
- DST boundary (2026-10-25 BST→GMT): `getLondonDateKey` stable across the repeated 01:30 hour.
- Counter doesn't increment on failed `updateTask` — correct.
- Unicode escapes (`\u2019`) are build-safe — project already uses them elsewhere.

## Critical Risks

### FINDING-01 — "Overdue" chip renders on every due-today task (pre-existing, now highly visible)
- **Severity:** High · **Confidence:** High · **Evidence:** Direct observation
- **Source:** Assumption Breaker #7
- **File:** [src/lib/dateUtils.js:82](src/lib/dateUtils.js:82)
- `getDueDateStatus` checks `daysDiff === 0 && isPast(date)` before the `isToday` branch. For date-only strings, `parseISO('2026-04-17')` returns local midnight; any time after midnight on that day is "past" → chip reads "Overdue". With Claude's fix, every task in the "Due Today" section now carries a contradictory "Overdue" chip.
- **Fix:** In `getDueDateStatus`, treat `daysDiff === 0` as "TODAY" unconditionally; only `daysDiff < 0` is OVERDUE.
- **Blocking:** Yes. Shipping the label fix without this is a visible regression in perceived correctness.

### FINDING-02 — `handleDefer` week boundary uses wrong date reference
- **Severity:** High · **Confidence:** High · **Evidence:** Direct observation
- **Source:** Assumption Breaker (additional)
- **File:** [src/components/planning/PlanningModal.jsx:112](src/components/planning/PlanningModal.jsx:112)
- `handleDefer` computes the "this week" boundary from `getMondayOfWeek(getLondonDateKey())` (today's week), not `getMondayOfWeek(windowDate)` (planning target week). During Sunday evening weekly planning, `windowDate` is next Monday, but the defer comparison uses the current week ending on today (Sunday) — so deferring a task to next Thursday can wrongly demote it to `state='backlog'`.
- **Fix:** Derive the week base from `windowDate` (or from `step==='weekly' ? windowDate : getLondonDateKey()`). Add `windowDate`/`step` to callback deps.
- **Blocking:** Yes for Sunday flow. Advisory otherwise.

## Implementation Defects

### FINDING-03 — `assignedCount` doesn't reset between modal opens
- **Severity:** Medium · **Confidence:** High · **Evidence:** Direct observation
- **Source:** Workflow F3-01 + Integration #1
- **File:** [src/components/planning/PlanningModal.jsx:39](src/components/planning/PlanningModal.jsx:39)
- Modal stays mounted in AppShell (`planning.isActive || planning.showModal`). Close → reopen keeps `assignedCount` at its last value. Also `step`, `skippedIds`, `dailyTasks` all persist across opens. Two failure modes:
  - User assigns 3 tasks → closes → reopens → can hit Finish without confirm dialog even if they don't assign anything in the new session.
  - Manual trigger causes brief unmount (via `isLoading=true`) — counter silently resets, user then hits false "no assignments" guard.
- **Fix:** Add `useEffect` keyed on `[isOpen, windowType, windowDate]` that resets `step`, `skippedIds`, `dailyTasks`, `assignedCount`.

### FINDING-04 — Defer + Skip don't count as actions; guard fires falsely
- **Severity:** Medium · **Confidence:** High · **Evidence:** Direct observation
- **Source:** Workflow F6-01, F7-01 + Assumption Breaker #4
- **File:** [src/components/planning/PlanningModal.jsx:99](src/components/planning/PlanningModal.jsx:99), [:106](src/components/planning/PlanningModal.jsx:106), [:110](src/components/planning/PlanningModal.jsx:110)
- A user who defers or skips every task has done a legitimate planning action, but the guard still tells them they haven't. `assignedCount` only increments on `today_section` or `state==='this_week'` paths.
- **Fix:** Rename to `actionedCount`, increment in `handleSkip` and `handleDefer` too.

### FINDING-05 — Hint text overstates what Skip does
- **Severity:** Medium · **Confidence:** High · **Evidence:** Direct observation
- **Source:** Assumption Breaker #6
- **File:** [src/components/planning/PlanningModal.jsx:252](src/components/planning/PlanningModal.jsx:252)
- Hint says "Use Skip to hide". `handleSkip` only adds to local `skippedIds` Set and flips the row to actioned-locally. Skipped tasks reappear on next prompt. Copy overpromises persistence.
- **Fix:** Change wording to "Skip sets it aside for this session" (or actually filter persisted skip state, but that's scope creep).

## Architecture & Integration Defects

### FINDING-06 — `isManual` prop is now dead inside PlanningModal
- **Severity:** Low · **Confidence:** High · **Evidence:** Direct observation
- **Source:** Integration #4
- `isManual` still flows from AppShell → PlanningModal but is no longer read. Leave it as the discriminator for the Sunday-combined question (FINDING-07), or remove the plumbing.

### FINDING-07 — "Sunday combined" flow triggers for *any* weekly window, not just Sunday
- **Severity:** High · **Confidence:** High · **Evidence:** Strong inference
- **Source:** Assumption Breaker #10
- **File:** [src/components/planning/PlanningModal.jsx:27](src/components/planning/PlanningModal.jsx:27)
- `isSundayCombined = windowType === WINDOW_TYPE.WEEKLY` — so Monday AM weekly window (or manual Plan This Week) is treated as "Sunday combined", forcing a mandatory second daily step against `windowDate=Monday`. Claude's label fix makes this less obviously wrong (on Monday it now says "Plan Your Day — Monday"), but the semantic is that any weekly session forces a daily follow-on, which is likely not intended.
- **Fix:** Use `!isManual && windowType === WEEKLY && windowDate !== getLondonDateKey()` — or, better, compute `isCombinedFlow` in `usePlanningPrompt` when the weekly window is actually opened on Sunday evening and pass it in.
- **Blocking:** Advisory — not the user's current complaint, but directly in the same code path.

## Workflow & Failure-Path Defects

### FINDING-08 — Partial assignments persist without a session record
- **Severity:** Medium · **Confidence:** Medium · **Evidence:** Direct observation
- **Source:** Workflow F3-02
- User assigns tasks via pills → closes via X/ESC → tasks are already `state='today'` in DB, but no `planning_sessions` row is written and `planning-complete` event never fires. Banner still shows "plan now" until next check; mounted TodayView doesn't refresh.
- **Fix:** On close when `actionedCount > 0`, either warn OR fire a lightweight refresh event. Advisory.

### FINDING-09 — Concurrent sort_order race (pre-existing)
- **Severity:** Medium (semantically) · **Confidence:** High · **Evidence:** Direct observation
- **Source:** Workflow F9-01 + Integration #7
- Two rapid assignment clicks can read the same max and both write `max+1` → duplicate `sort_order`. Not data loss; Today view resolves ties by `created_at`. Pre-existing before Claude's diff. Advisory.

### FINDING-10 — `todayLondon` computed at render; doesn't tick over midnight
- **Severity:** Low/Medium · **Confidence:** High · **Evidence:** Direct observation
- **Source:** Assumption Breaker #3
- If modal is open across London midnight and no state change forces a re-render, the title stays stale. Rare but real.
- **Fix:** Advisory — add a minute-ticker or recheck on visibility change. Not blocking.

## Security & Data Risks
None identified for this diff.

## Unproven Assumptions
None material — all flagged claims have direct code evidence.

## Recommended Fix Order

1. **FINDING-01** (Overdue chip) — one-line fix in `dateUtils.js:82`; unblocks user perception.
2. **FINDING-04** (Defer/Skip count) — rename + two increments; prevents false-guard UX.
3. **FINDING-03** (Reset on open) — single `useEffect`; prevents cross-session counter staleness.
4. **FINDING-02** (Defer week base) — small correction; prevents Sunday-flow backlog demotion.
5. **FINDING-05** (Hint copy) — one-line wording tweak; included with above.
6. **FINDING-06** (dead `isManual`) — defer until FINDING-07 is resolved, then remove or keep as discriminator.
7. **FINDING-07** (Sunday combined) — needs product decision; not blocking.
8. Remaining findings (08, 09, 10) — advisory follow-ups.

## Follow-Up Review Required
- After FINDING-01 applied: verify "Due Today" section no longer shows Overdue chips on date-only same-day tasks.
- After FINDING-04 applied: verify Defer-all and Skip-all paths don't fire the confirm dialog.
- After FINDING-03 applied: close modal mid-session and reopen; counter should be zero.
