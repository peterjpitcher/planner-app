# Adversarial Review: Smart Planning Prompts

**Date:** 2026-04-14
**Mode:** Spec Compliance (Mode C) — pre-implementation
**Engines:** Codex (all 6 reviewers)
**Scope:** `docs/superpowers/specs/2026-04-14-smart-planning-prompts-design.md` vs existing codebase
**Spec:** `docs/superpowers/specs/2026-04-14-smart-planning-prompts-design.md`

## Inspection Inventory

### Inspected
- Task schema, migrations (`20260404000001_prioritisation_replacement.sql`, `20250707_initial_schema.sql`)
- Task API (`src/app/api/tasks/route.js`), taskService (`src/services/taskService.js`), apiClient (`src/lib/apiClient.js`)
- TodayView, PlanBoard, CalendarView and their child components
- AppShell, Sidebar, TabBar, Header, QuickCapture layout components
- Cron routes: demote-today-tasks, demote-week-tasks, daily-task-email
- Auth: NextAuth config, authServer, middleware, cronAuth
- Date utilities: dateUtils.js, timezone.js
- Supabase clients: supabaseClient.js, supabaseServer.js, supabaseServiceRole.js
- Settings: integrations page, Office365 connection
- Existing validators (`src/lib/validators.js`)

### Not Inspected
- Office365 sync implementation detail
- Full styling system / Tailwind config
- Journal, Ideas, Notes features (not relevant)
- E2E browser testing (no implementation exists yet)

### Limited Visibility Warnings
- All findings are based on spec-vs-codebase analysis, not runtime testing

## Executive Summary

The spec is a strong conceptual design — the planning windows, task surfacing logic, and UI model are sound. However, **three critical gaps** make it unimplementable as-is: (1) the `/api/tasks` endpoint lacks the filtering needed for planning queries, (2) writing "plan tomorrow" tasks directly into `state='today'` conflicts with the 20:00 demote cron, and (3) the spec omits auth/validation requirements for new API routes. There are also several medium-severity gaps around session tracking, sort order, and a removed `priority` field.

## What Appears Solid

- **Two-window model** (daily + weekly) with configurable times is well-designed
- **Sunday combined flow** (weekly then daily) is the right UX
- **Task surfacing categories** (due tomorrow, overdue, undated this_week) cover the right buckets
- **Section assignment during daily planning** (MUST_DO/GOOD_TO_DO/QUICK_WINS) leverages existing today_section
- **Soft cap warnings** (nudge, don't block) matches existing app philosophy
- **Reusing `updateTask` for mutations** — the PATCH path is already atomic for state+today_section
- **planning_sessions as a separate table** — clean decoupling from task data
- **Client-driven approach** — appropriate for a single-user app, no unnecessary infrastructure

## Critical Risks

### CRIT-001: No server-side due-date filtering in /api/tasks
- **Flagged by:** AB-001, ARCH-001, SPEC-028 (all engines)
- **Severity:** Critical | **Confidence:** High
- **Evidence:** `/api/tasks` GET route (route.js:53) only supports `state`, `states`, `completedSince`, `limit`, `offset`. The apiClient sends `range`/`days`/`includeOverdue` params but the server ignores them (apiClient.js:87). Default limit is 100, max 200.
- **Impact:** The planning hook cannot fetch "tasks due tomorrow" or "overdue tasks not in today/done" without either: (a) extending the API with date filters, or (b) fetching ALL non-done tasks and filtering client-side (unreliable with pagination, triggers Office365 sync side effects).
- **Action:** Add server-side due-date filtering to `/api/tasks` or create a dedicated `/api/planning-candidates` endpoint.
- **Blocking**

### CRIT-002: Demote crons conflict with planning window
- **Flagged by:** AB-002, AB-004, WF-002, WF-003, SPEC-017, SPEC-032 (all engines)
- **Severity:** Critical | **Confidence:** High
- **Evidence:** `demote-today-tasks` runs at London hour 20 (route.js:26) and moves ALL `today` tasks to `this_week`. `demote-week-tasks` runs Sundays at London hour 20 (route.js:33) and moves ALL `this_week` tasks to `backlog`. Planning window opens at 20:05.
- **Impact:** If user plans at 20:10 (assigns tasks to `today`), and a late cron run or scheduled retry hits at 20:15, those just-planned tasks get demoted. Sunday is worse — weekly accepts to `this_week` can be swept to `backlog` by the weekly demoter.
- **Action:** The spec must define the interaction: either (a) crons check for a planning_sessions row and skip recently-planned tasks, (b) planning writes to a staging state rather than directly to `today`/`this_week`, or (c) crons are restructured to run before the planning window opens.
- **Blocking**

### CRIT-003: Auth and validation omitted from new API routes
- **Flagged by:** SEC-001, SEC-002, SEC-003, SEC-004 (all Codex)
- **Severity:** Critical | **Confidence:** High
- **Evidence:** The spec defines 4 new API routes but never mentions auth checks, user_id derivation from session, input validation, or Zod schemas. The app uses service-role Supabase (bypasses RLS), so security relies entirely on manual user_id scoping in code.
- **Impact:** Without spec-level requirements, implementation could miss auth checks, allowing cross-user data access or session forging.
- **Action:** Spec must explicitly require: `getAuthContext()` on all routes, `user_id` derived from session (never client-supplied), Zod validation on POST/PUT bodies, 401/400 responses.
- **Blocking**

## Spec Defects

### SPEC-D1: "Priority indicator" references removed field
- **Flagged by:** ARCH-007, SPEC-020
- **Severity:** Medium | **Confidence:** High
- **Description:** Spec says task rows show a "priority indicator", but the `priority` column was removed in the prioritisation migration (20260404000001:137). Current task UI shows chips, task_type, and area instead.
- **Suggested revision:** Replace "priority indicator" with "chips badges and task type icon" to match current task model.

### SPEC-D2: Weekly window definition is contradictory
- **Flagged by:** SPEC-003
- **Severity:** Medium | **Confidence:** High
- **Description:** The spec says "20:05 Sunday → 20:00 next Sunday" but also "Sundays only". A week-long window contradicts being Sunday-only. The intent seems to be that the weekly prompt is available from Sunday 20:05 until the next Sunday 20:00, but this is ambiguous.
- **Suggested revision:** Clarify: "Weekly planning is triggered on Sunday evenings. The planning prompt is available from Sunday 20:05 through to the following Sunday 20:00, but the primary intent is Sunday evening planning."

### SPEC-D3: Defer semantics are incomplete
- **Flagged by:** WF-005, SPEC-016
- **Severity:** Medium | **Confidence:** High
- **Description:** Spec says Defer = "pick a new date" but doesn't specify whether state should change. Currently, date changes don't trigger state changes (TaskCard.jsx:258). Deferring a `this_week` task to next month leaves it in `this_week` forever until the Sunday demoter runs.
- **Suggested revision:** Defer should update `due_date` AND move state to `backlog` if the new date falls outside the current week.

### SPEC-D4: Skip semantics are undefined for overdue tasks
- **Flagged by:** SPEC-010, AB-007
- **Severity:** Medium | **Confidence:** Medium
- **Description:** Skipping an overdue task leaves it in its current state. It will reappear in every planning session until the user actively defers or completes it. The spec doesn't say whether this is intentional.
- **Suggested revision:** Either document this as intentional ("overdue tasks reappear until actioned") or add a "snooze" option that hides them for N days.

### SPEC-D5: Missing loading state in hook contract
- **Flagged by:** WF-007
- **Severity:** Medium | **Confidence:** High
- **Description:** The `usePlanningPrompt` hook returns `{ isActive, windowType, isPlanned, tasks, openModal }` but has no `isLoading` state. Current data patterns initialize empty and fetch after mount. Without `isLoading`, "no tasks" and "tasks loading" are conflated, risking modal flash or premature no-tasks skip.
- **Suggested revision:** Add `isLoading` to the hook return value. Don't render modal or banner until loading is complete.

### SPEC-D6: Banner copy only covers daily, not weekly
- **Flagged by:** SPEC-023
- **Severity:** Low | **Confidence:** High
- **Description:** Banner variants only mention "tasks due tomorrow". No copy defined for weekly planning or combined Sunday flow.
- **Suggested revision:** Add weekly variants: "You have N tasks due this week — Plan now" and "Week planned — Revisit".

## Implementation Defects

N/A — pre-implementation review. No code exists yet.

## Architecture & Integration Defects

### ARCH-D1: No global modal/banner mount point exists
- **Flagged by:** AB-006, ARCH-004
- **Severity:** Medium | **Confidence:** High
- **Evidence:** AppShell (AppShell.jsx:53) renders Sidebar, Header, TabBar, and children. No global modal host exists. Each view owns its own TaskDetailDrawer.
- **Impact:** The spec says "used in the app layout" but doesn't specify exact mount point. Additionally, `TAB_ROUTES` in AppShell omits `/calendar`.
- **Action:** Spec should specify: modal mounts as fixed sibling in AppShell (z-index above nav), banner mounts inside `<main>` below TabBar. Calendar route should be added to TAB_ROUTES if not already.

### ARCH-D2: Cross-view task invalidation not addressed
- **Flagged by:** ARCH-002
- **Severity:** Medium | **Confidence:** High
- **Evidence:** TodayView, PlanBoard, CalendarView each manage their own task state. No shared task store, cache, or event bus exists.
- **Impact:** When the planning modal (mounted in AppShell) mutates tasks, the active view's data becomes stale. The user finishes planning and sees outdated lists.
- **Action:** Spec should define invalidation: either (a) force page reload on modal close, (b) add a simple event/callback system, or (c) views refetch on focus/visibility change.

### ARCH-D3: Sort order not set during planning moves
- **Flagged by:** ARCH-003, SPEC-008
- **Severity:** Medium | **Confidence:** High
- **Evidence:** `taskService.updateTask()` doesn't assign `sort_order` on state transitions (taskService.js:181). TodayView sorts by `sort_order` (TodayView.jsx:59). Tasks moved via planning will have their previous sort_order, placing them unpredictably.
- **Action:** Spec should define: planned tasks get appended to the end of their target section (max sort_order + 1), or a batch planning endpoint handles ordering.

### ARCH-D4: planning_sessions needs uniqueness constraint and created_at semantics
- **Flagged by:** ARCH-006, SEC-005
- **Severity:** Medium | **Confidence:** High
- **Evidence:** No unique constraint on `(user_id, window_type, window_date)`. `created_at` defined as "when session was started" but only written on "Finish Planning".
- **Action:** Add UNIQUE constraint. Either use upsert (ON CONFLICT UPDATE) or check-before-insert. Clarify `created_at` = session completion time, or add a separate `started_at`.

## Workflow & Failure-Path Defects

### WF-D1: "New tasks mid-window" detection is unreliable
- **Flagged by:** AB-005, SPEC-035
- **Severity:** Medium | **Confidence:** High
- **Evidence:** planning_sessions stores no per-task outcomes. Count-based detection breaks on: net-zero changes (skip one, add one), deferred tasks still in window, weekly accepts (this_week not today), completed tasks.
- **Action:** Either (a) store task IDs surfaced during the session, (b) use `entered_state_at` to detect post-session arrivals, or (c) simplify to "always re-check query; if new results exist that weren't in the original set, show banner".

### WF-D2: Partial completion can't distinguish skipped from unhandled
- **Flagged by:** AB-007, SPEC-034
- **Severity:** Medium | **Confidence:** Medium
- **Evidence:** No per-task decision tracking. On reopen, the query re-runs and returns tasks matching the criteria. Skipped tasks match the same criteria and reappear identically to never-seen tasks.
- **Action:** Accept this limitation (skipped tasks reappear, which is arguably fine for planning), or add a `planning_session_items` table tracking per-task decisions.

### WF-D3: Cross-device staleness on already-open tabs
- **Flagged by:** WF-006
- **Severity:** Low | **Confidence:** High
- **Evidence:** Views fetch on mount only, no polling or focus-refetch. Planning on phone won't update an already-open laptop tab.
- **Action:** Add a `visibilitychange` listener to refetch planning state when tab regains focus. Low priority but worth noting in spec.

## Security & Data Risks

See CRIT-003 above for the primary security findings. Additional:

### SEC-D1: user_settings needs input validation
- **Flagged by:** SEC-004
- **Severity:** Medium | **Confidence:** High
- **Description:** Time inputs could receive non-time strings, start=end (zero-width window), or unexpected keys. Need Zod schema with time format validation and start < end constraint.

### SEC-D2: planning_sessions needs idempotent write
- **Flagged by:** SEC-005
- **Severity:** Medium | **Confidence:** High
- **Description:** Without a UNIQUE constraint, double-clicks or retries create duplicate rows. Use upsert with `ON CONFLICT (user_id, window_type, window_date) DO UPDATE SET completed_at = now()`.

## Unproven Assumptions

1. **"Existing demote crons continue independently"** — CONTRADICTED. They directly conflict with the planning window timing. (AB-004, WF-002, WF-003)
2. **"Fetches candidates via existing /api/tasks with appropriate filters"** — CONTRADICTED. The API lacks due-date filtering. (AB-001, ARCH-001)
3. **"Client-side London time check is robust"** — UNVERIFIED. Most date helpers use local browser time, not London time. The hook would need a dedicated London time evaluator, not reuse of existing helpers. (AB-003, WF-008)
4. **"Task mutations reuse existing updateTask"** — VERIFIED but INCOMPLETE. The mutation path works but doesn't handle sort_order, and triggers N side effects per task (entered_state_at, O365 sync). (ARCH-003, WF-004)

## Recommended Fix Order

1. **Resolve cron/planning conflict** (CRIT-002) — this is an architectural decision that affects everything else
2. **Design planning query** (CRIT-001) — either extend `/api/tasks` or add `/api/planning-candidates`
3. **Add auth/validation requirements to spec** (CRIT-003) — straightforward additions
4. **Fix spec defects** (SPEC-D1 through D6) — clarifications and corrections
5. **Address architecture gaps** (ARCH-D1 through D4) — mount points, invalidation, sort order, constraints
6. **Decide on session tracking granularity** (WF-D1, WF-D2) — per-task vs session-level

## Follow-Up Review Required

- After cron/planning conflict is resolved, re-review the timing model
- After planning query is designed, verify it handles all surfacing rules
- After auth requirements are added, verify they match existing route patterns
