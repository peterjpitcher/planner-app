# Adversarial Review: Task Auto-Demote, Backlog Sort & Calendar View

**Date:** 2026-04-13
**Mode:** Spec Compliance (Mode C)
**Engines:** Claude (5 specialist agents) + Codex (Repo Reality Mapper — pending)
**Scope:** `docs/superpowers/specs/2026-04-13-task-automation-calendar-view-design.md`
**Features:** Auto-demote crons, backlog sort, calendar view

## Inspection Inventory

### Inspected
- Spec document (full read)
- `src/app/api/cron/daily-task-email/route.js` — existing cron auth and email pattern
- `src/services/dailyTaskEmailService.js` — email HTML building, claim pattern
- `src/lib/microsoftGraph.js` — sendMicrosoftEmail, OAuth2 client credentials flow
- `src/lib/timezone.js` — getTimeZoneParts, getLondonDateKey
- `src/lib/dateUtils.js` — date formatting utilities
- `src/lib/taskSort.js` — existing sort functions
- `src/lib/sortOrder.js` — gap-based sort order algorithm
- `src/components/plan/PlanBoard.jsx` — backlog column rendering and sort behaviour
- `src/components/plan/BoardColumn.jsx` — column rendering pattern
- `src/components/today/TodayView.jsx` — DnD context setup
- `src/components/shared/TaskCard.jsx` — draggable task pattern
- `src/components/layout/TabBar.jsx` — tab navigation
- `src/components/layout/Sidebar.jsx` — sidebar navigation (uses Lucide icons)
- `src/services/taskService.js` — updateTask side effects, TASK_SELECT_FIELDS
- `src/app/api/tasks/[id]/route.js` — PATCH handler
- `src/lib/supabaseServiceRole.js` — service-role client
- `src/lib/validators.js` — due_date validation
- `src/hooks/useApiClient.js` — API client with pagination
- `supabase/migrations/20260404000001_prioritisation_replacement.sql` — fn_task_state_cleanup trigger
- `vercel.json` — existing cron config
- `package.json` — dnd-kit versions

### Not Inspected
- `src/components/Projects/ProjectWorkspace.jsx` — DnD pattern (similar to TodayView, low risk)
- `src/app/api/cron/office365-sync/route.js` — simpler cron, different auth pattern noted
- Codex Repo Reality Mapper output — still running at time of compilation

### Limited Visibility Warnings
- Codex cross-engine correlation not yet available
- Could not verify actual Vercel cron delivery behaviour (GET vs POST)

---

## Executive Summary

The spec is well-structured with strong traceability to all four original requirements. However, five material issues were found: (1) cron bulk updates bypass taskService side effects, (2) DST dual-schedule needs a London-hour guard, (3) backlog column doesn't use client-side sorting today, (4) month strip hover-while-dragging requires custom dnd-kit implementation, and (5) the idempotency pattern must use atomic INSERT-or-conflict, not SELECT-then-INSERT.

---

## What Appears Solid

- **Email infrastructure:** `sendMicrosoftEmail()` uses OAuth2 client credentials — works perfectly from cron contexts without user sessions
- **Bulk state updates:** PostgreSQL per-row trigger `fn_task_state_cleanup` works correctly with bulk UPDATE statements — `entered_state_at` and `today_section` handled atomically
- **Calendar DndContext isolation:** Each page has its own DndContext — no conflicts between views
- **Calendar page pattern:** Follows existing thin-wrapper page → component architecture
- **Task ownership on PATCH:** `updateTask` verifies `user_id` — calendar drag-drop can't modify other users' tasks
- **cron_runs table RLS:** RLS enabled with no policies + service_role-only GRANT is correct — anon/authenticated are blocked by default
- **Spec coverage of requirements:** All four original requirements fully traced; no harmful scope creep

---

## Critical Risks

### CR-1: Cron Bulk Update Bypasses taskService Side Effects
**Type:** Strongly suspected defect | **Severity:** High | **Blocking**
**Engines:** Integration & Architecture, Assumption Breaker
**File(s):** Spec Feature 1 & 2; `src/services/taskService.js:123-253`

The spec implies raw Supabase `.update()` calls from cron routes. But `taskService.updateTask()` contains critical side effects:
- **Office 365 sync** (`syncOffice365Task()` at line 244-249) — demoted tasks won't sync, creating drift
- **`entered_state_at`** — the DB trigger handles this, so it's actually safe
- The DB trigger also handles `today_section` cleanup — safe

**Net issue:** Office 365 sync is skipped. Either call `updateTask()` per-task from the cron, or explicitly document that cron-driven demotions intentionally skip O365 sync.

### CR-2: Month Strip & Edge Navigation Require Custom DnD Implementation
**Type:** Confirmed defect | **Severity:** High | **Blocking**
**Engines:** Assumption Breaker
**File(s):** Spec Feature 4 (MonthStrip, EdgeNavigator)

dnd-kit has NO native "hover-while-dragging triggers action after delay" pattern. Both MonthStrip and EdgeNavigator require custom implementation: either make month labels droppable with timer logic in `onDragOver`, or track pointer coordinates in `onDragMove` with `setTimeout`/`clearTimeout`. The spec must acknowledge this complexity and specify the approach.

---

## Spec Defects

### SD-1: Idempotency Pattern Described Incorrectly
**Type:** Spec ambiguity | **Severity:** Medium
**Engines:** Assumption Breaker

The spec says "Check idempotency — query... if already run, return early." This implies SELECT-then-INSERT which has a race window between the two dual-schedule invocations. The existing daily-email cron uses an atomic INSERT-first "claim" pattern (insert with `status: 'claimed'`, catch unique violation `23505`). The spec must mandate this pattern.

### SD-2: DST Dual-Schedule Needs London-Hour Guard
**Type:** Confirmed defect | **Severity:** Medium
**Engines:** Workflow & Failure Path

The dual-schedule (19:00 + 20:00 UTC) with idempotency means whichever fires first wins. During GMT, 19:00 UTC = 19:00 London — tasks get demoted an hour early. Fix: add a London-hour check — only execute when `Europe/London` hour is 20. The 19:00 UTC fire during GMT gets skipped; during BST it executes (19:00 UTC = 20:00 BST). The 20:00 UTC fire covers GMT.

### SD-3: Backlog Column Uses Server-Side Sort, Not Client-Side
**Type:** Confirmed defect | **Severity:** Medium
**Engines:** Assumption Breaker

The spec says "backlog column switches from `compareTasksBySortOrderAsc` to `compareBacklogTasks`." But `PlanBoard.jsx` never uses `compareTasksBySortOrderAsc` — it renders tasks in API return order. The implementation needs to add client-side sorting. Additionally, drag-reorder within backlog will visually snap tasks to their due-date group on re-render, which may confuse users.

### SD-4: Empty Sweep Should Skip Email
**Type:** Missing requirement | **Severity:** Medium
**Engines:** Workflow & Failure Path

The spec doesn't address zero-task sweeps. When no tasks need demoting, the cron should skip email, log `tasks_affected = 0`, and return early. The existing daily-email returns `{ sent: false, reason: 'no_outstanding_tasks' }` — follow that pattern.

### SD-5: Task Fetching Pagination Not Addressed
**Type:** Missing requirement | **Severity:** Medium
**Engines:** Assumption Breaker

The API has a 200-task limit with pagination. The spec says "fetch all non-done tasks" but doesn't mention pagination. Must use `getAllTasks()` (which handles pagination) not `getTasks()`, or results may be silently truncated.

### SD-6: Email Address Must Use Environment Variable
**Type:** Spec ambiguity | **Severity:** Medium
**Engines:** Security & Data Risk

The spec hardcodes `peter@orangejelly.co.uk`. The existing cron uses `DAILY_TASK_EMAIL_TO` env var. New crons must follow the same pattern for deployability.

---

## Implementation Defects

None — spec-only review, no code written yet.

---

## Architecture & Integration Defects

### AI-1: Cron Auth Should Be Extracted to Shared Utility
**Type:** Repo-convention conflict | **Severity:** Medium | **Advisory**
**Engines:** Integration & Architecture, Security

Two existing crons have slightly divergent auth patterns. Adding two more will make four. Extract a shared `verifyCronAuth(request)` helper. Also note: Vercel sends GET requests for crons by default — spec says POST. Verify and align.

### AI-2: Sidebar Needs Lucide Icon for Calendar
**Type:** Missing detail | **Severity:** Low | **Advisory**
**Engines:** Integration & Architecture

TabBar uses Heroicons; Sidebar uses Lucide. Spec specifies `CalendarDaysIcon` (Heroicons) for TabBar but doesn't mention Lucide equivalent for Sidebar.

### AI-3: Calendar Sidebar Sort Order Undefined
**Type:** Missing detail | **Severity:** Low | **Advisory**
**Engines:** Integration & Architecture

The sidebar lists overdue and undated tasks but doesn't define their sort order. Suggest: `sort_order ASC` or `due_date DESC` (most recently overdue first).

### AI-4: Calendar Collision Detection Strategy Unspecified
**Type:** Missing detail | **Severity:** Low | **Advisory**
**Engines:** Assumption Breaker

The calendar has 42+ small day cells. `closestCenter` may cause tasks to snap to wrong cells. Consider `pointerWithin` or `rectIntersection` for the dense grid.

---

## Workflow & Failure-Path Defects

### WF-1: Intra-Day Task Order Undefined
**Type:** Missing detail | **Severity:** Low | **Advisory**
**Engines:** Workflow & Failure Path

Multiple tasks on the same day cell have no defined order. Suggest: `sort_order ASC` or `created_at ASC`. No drag-reorder within a single day cell.

---

## Security & Data Risks

### SEC-1: Bulk Cron Updates Should Scope by user_id
**Type:** Plausible but unverified | **Severity:** Medium | **Advisory**
**Engines:** Security & Data Risk

The spec queries all tasks with `state = 'today'` without user_id filtering. Safe for single-user, but a latent risk. The existing daily-email cron resolves a user_id and filters — follow the same pattern.

### SEC-2: Vercel Cron Sends GET, Not POST
**Type:** Plausible but unverified | **Severity:** Low | **Advisory**
**Engines:** Security & Data Risk

Spec says POST endpoints, but Vercel cron delivers GET requests by default. The existing crons export GET handlers. Verify and align.

---

## Unproven Assumptions

1. **Office 365 sync skip is acceptable** — If O365 sync is critical, cron-demoted tasks will drift. Needs human confirmation.
2. **Drag-reorder within due-date groups is intuitive** — Users may expect full manual ordering. Needs UX validation.
3. **200-task limit won't be hit** — Depends on user's task volume. Use `getAllTasks()` to be safe.

---

## Recommended Fix Order

1. **SD-1** — Fix idempotency to use atomic claim pattern (foundational for both crons)
2. **SD-2** — Add London-hour guard (fixes DST timing for both crons)
3. **CR-1** — Decide on O365 sync handling (ask user)
4. **SD-3** — Add client-side sort in PlanBoard for backlog
5. **CR-2** — Specify custom DnD implementation approach for MonthStrip/EdgeNavigator
6. **SD-4, SD-5, SD-6** — Add missing spec details (empty sweep, pagination, env vars)
7. **AI-1** — Extract shared cron auth utility
8. Advisory items (AI-2, AI-3, AI-4, WF-1, SEC-1, SEC-2)

---

## Follow-Up Review Required

- Re-review cron routes after implementation to verify claim pattern and London-hour guard
- Re-review calendar DnD after implementation to verify month navigation UX works smoothly
- Verify Vercel cron HTTP method (GET vs POST) before deployment
