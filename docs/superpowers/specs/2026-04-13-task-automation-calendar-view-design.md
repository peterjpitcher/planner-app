# Design Spec: Task Auto-Demote, Backlog Sort & Calendar View

**Date:** 2026-04-13
**Status:** Reviewed (adversarial review applied)
**Scope:** Four features — auto-demote crons, backlog sort, calendar view tab

---

## Feature 1: Auto-Demote Today Tasks (Daily 20:00 London)

### Endpoint

`GET /api/cron/demote-today-tasks`

*(Vercel cron sends GET requests. Export `async function GET(request)`.)*

### Schedule

Vercel cron at both `0 19 * * *` and `0 20 * * *` UTC. London-hour guard + idempotency ensures it executes exactly once per day at 20:00 London time regardless of GMT/BST.

### Logic

1. Verify cron auth using shared `verifyCronAuth(request)` helper — replicates existing multi-layer check: `x-vercel-cron` header, `CRON_SECRET` via `x-cron-secret`, optional `CRON_MANUAL_TOKEN` for manual testing. Extract from existing `daily-task-email/route.js` pattern into `src/lib/cronAuth.js`.
2. **London-hour guard** — Check `getTimeZoneParts().hour === 20` using `Europe/London` timezone via `src/lib/timezone.js`. If not 20:00 London, return early with `{ skipped: true, reason: 'not_london_20' }`. This ensures the 19:00 UTC fire only executes during BST and the 20:00 UTC fire only executes during GMT.
3. **Atomic idempotency claim** — INSERT `(operation='demote_today', run_date=getLondonDateKey(), status='claimed')` into `cron_runs`. If unique violation (PostgreSQL error code `23505`), return early — already executed today. Use `getLondonDateKey()` for the date, not UTC date.
4. Resolve user via `resolveDigestUserId()` pattern (env-var-driven, not hardcoded).
5. Query tasks where `state = 'today'` AND `user_id = userId` using service-role Supabase client.
6. **If zero tasks match:** Update `cron_runs` with `tasks_affected = 0, status = 'success'`, skip email, return `{ skipped: true, reason: 'no_tasks' }`.
7. **For each task:** Call `updateTask({ supabase, userId, taskId, updates: { state: 'this_week' }, options: { skipProjectTouch: true } })` from `src/services/taskService.js`. This ensures Office 365 sync, `entered_state_at`, and `today_section` cleanup all fire correctly. The DB trigger `fn_task_state_cleanup` handles `today_section = NULL` and `entered_state_at = now()`.
8. Send email via `sendMicrosoftEmail()` from `src/lib/microsoftGraph.js`:
   - **To:** `process.env.DEMOTE_EMAIL_TO || process.env.DAILY_TASK_EMAIL_TO`
   - **Subject:** "Daily Review: X tasks moved from Today to This Week"
   - **Body:** HTML list of task names with project name (if assigned) and due date (if set)
9. Update `cron_runs` with `tasks_affected = N, status = 'success'` (or `status = 'failed'` with error if email fails — task demotions still commit).
10. Return JSON response with summary.

### Email Template

```
Subject: Daily Review: 3 tasks moved from Today to This Week

Hi Peter,

The following tasks weren't completed today and have been moved back to This Week:

- Fix login bug (Project: Website Redesign, Due: 15 Apr)
- Update stakeholder list (No project)
- Review quarterly report (Project: Q2 Planning, Due: 18 Apr)

You can review and re-prioritise them in your planner.
```

### Idempotency

New table `cron_runs` with atomic INSERT-first claim pattern (not SELECT-then-INSERT):

```sql
CREATE TABLE public.cron_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation TEXT NOT NULL,
  run_date DATE NOT NULL,
  tasks_affected INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'claimed',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(operation, run_date)
);

ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;

-- Service-role only access. RLS with no policies blocks anon/authenticated by default.
GRANT ALL ON TABLE public.cron_runs TO service_role;
REVOKE ALL ON TABLE public.cron_runs FROM anon, authenticated;
```

---

## Feature 2: Auto-Demote This Week Tasks (Sunday 20:00 London)

### Endpoint

`GET /api/cron/demote-week-tasks`

*(Vercel cron sends GET requests. Export `async function GET(request)`.)*

### Schedule

Same dual-schedule pattern: `0 19 * * *` and `0 20 * * *` UTC with London-hour guard + idempotency.

### Logic

1. Verify cron auth using shared `verifyCronAuth(request)` from `src/lib/cronAuth.js`.
2. **London-hour guard** — Check `getTimeZoneParts().hour === 20` in Europe/London. If not, return early.
3. **Sunday check** — Determine day-of-week from `getLondonDateKey()` parsed date (not `new Date().getDay()` in UTC). If not Sunday, return early with `{ skipped: true, reason: 'not_sunday' }`.
4. **Atomic idempotency claim** — INSERT `(operation='demote_week', run_date=getLondonDateKey(), status='claimed')` into `cron_runs`. Catch `23505` for duplicate.
5. Resolve user via env-var-driven pattern.
6. Query tasks where `state = 'this_week'` AND `user_id = userId`.
7. **If zero tasks match:** Update `cron_runs` with `tasks_affected = 0`, skip email, return early.
8. **For each task:** Call `updateTask({ supabase, userId, taskId, updates: { state: 'backlog' }, options: { skipProjectTouch: true } })` to preserve Office 365 sync and state-tracking side effects.
9. Send email via `sendMicrosoftEmail()`:
   - **To:** `process.env.DEMOTE_EMAIL_TO || process.env.DAILY_TASK_EMAIL_TO`
   - **Subject:** "Weekly Review: X tasks moved from This Week to Backlog"
   - **Body:** HTML list of task names with project and due date
10. Update `cron_runs` with final status and count.
11. Return JSON response.

### Email Template

```
Subject: Weekly Review: 5 tasks moved from This Week to Backlog

Hi Peter,

The following tasks weren't completed this week and have been moved to the Backlog:

- Design new dashboard (Project: Planner 2.0, Due: 20 Apr)
- Chase invoice from supplier (No project, No due date)
- ...

You can review and re-prioritise them in your planner.
```

---

## Feature 3: Backlog Prioritisation

### Sort Function

New function `compareBacklogTasks(a, b)` in `src/lib/taskSort.js`:

**Two-tier sort:**
1. **Due date ascending** — tasks with dates come first (earliest first). Tasks without a due date sort to the bottom.
2. **Sort order ascending** — manual drag ordering as tiebreaker within the same due-date group (or both no-date).

*Note: The original request mentioned "priority" but the priority field was removed in the state-based migration (20260404). The agreed design uses sort_order as the secondary tier, giving full manual control within date groups.*

### Application

- `PlanBoard.jsx` — **add client-side `.sort(compareBacklogTasks)`** to the backlog tasks array before rendering. Currently, the backlog column uses server-side order (`sort_order ASC, created_at ASC` from the API) with no client-side sort function. The new sort must be applied after fetching and before passing to `BoardColumn`.
- Other columns (today, this_week, waiting) keep their existing sort behaviour unchanged.
- Manual drag reordering within backlog still updates `sort_order` as normal. Due to the due-date-first sort, drag-reorder only affects position within the same due-date group — tasks snap to their date tier on re-render. This is the intended behaviour.

### No Database or API Changes Required

Pure client-side sort function addition.

---

## Feature 4: Calendar View

### Route & Navigation

**Route:** `/calendar` — `src/app/calendar/page.js` (thin wrapper rendering `CalendarView`)

**Tab position:** Between "Plan" and "Projects" in TabBar and Sidebar:
`Today | Plan | Calendar | Projects | Ideas`

**Icons:**
- TabBar: `CalendarDaysIcon` from `@heroicons/react/24/outline`
- Sidebar: `Calendar` from `lucide-react`

### Layout

```
Desktop:
┌──────────────────────────────────────────────────────────┐
│  < April 2026 >                                          │
│  [Apr] [May] [Jun] [Jul] [Aug] [Sep] [Oct] ... [Mar 27]  │
├──────────────────────────────────┬───────────────────────┤
│                                  │  Overdue & Undated    │
│   Mon  Tue  Wed  Thu  Fri  S  S  │                       │
│  ┌───┬───┬───┬───┬───┬───┬───┐  │  - Fix login bug      │
│  │   │   │ 1 │ 2 │ 3 │ 4 │ 5 │  │    (was 3 Apr)       │
│  ├───┼───┼───┼───┼───┼───┼───┤  │  - Update docs        │
│  │ 6 │ 7 │ 8 │ 9 │10 │11 │12 │  │    (no date)          │
│  ├───┼───┼───┼───┼───┼───┼───┤  │  - Send invoice       │
│  │13 │14 │15 │16 │17 │18 │19 │  │    (was 1 Apr)        │
│  ├───┼───┼───┼───┼───┼───┼───┤  │                       │
│  │20 │21 │22 │23 │24 │25 │26 │  │                       │
│  ├───┼───┼───┼───┼───┼───┼───┤  │                       │
│  │27 │28 │29 │30 │   │   │   │  │                       │
│  └───┴───┴───┴───┴───┴───┴───┘  │                       │
└──────────────────────────────────┴───────────────────────┘
```

### Components

| Component | File | Purpose |
|-----------|------|---------|
| CalendarView | `src/components/calendar/CalendarView.jsx` | Page wrapper — fetches tasks, manages DnD context and selected month state |
| CalendarGrid | `src/components/calendar/CalendarGrid.jsx` | Month grid with day cells, week rows, prev/next header |
| CalendarDayCell | `src/components/calendar/CalendarDayCell.jsx` | Individual day — droppable zone, renders up to 3 task pills with "+N more" overflow |
| CalendarTaskPill | `src/components/calendar/CalendarTaskPill.jsx` | Compact draggable task pill — truncated name, colour hint from task state. Uses `useDraggable` (not `useSortable` — no intra-cell reordering). |
| CalendarSidebar | `src/components/calendar/CalendarSidebar.jsx` | Right panel — lists overdue and undated tasks as draggable items |
| MonthStrip | `src/components/calendar/MonthStrip.jsx` | Horizontal row of 12 month buttons — drag-hover switches month, click navigates |
| EdgeNavigator | `src/components/calendar/EdgeNavigator.jsx` | Left/right edge zones (~40px) — auto-advance month on 500ms drag hover |

### Drag-and-Drop Behaviour

**Library:** dnd-kit (already installed — `@dnd-kit/core` v6.3.1, `@dnd-kit/sortable` v10.0.0)

**DndContext setup:** CalendarView owns its own `DndContext` (same isolation pattern as TodayView and PlanBoard). Uses `PointerSensor` with `distance: 5`. **Collision detection: `pointerWithin`** — better suited for the dense grid of small day cells than `closestCenter`.

**Task onto day cell:**
- Each `CalendarDayCell` is a droppable (`useDroppable({ id: 'day-2026-04-15' })`)
- On drop, updates `due_date` via existing `PATCH /api/tasks/[id]`
- Optimistic UI — task moves immediately, reverts on API failure
- Toast: "Task moved to 15 Apr"

**From sidebar to calendar:**
- Sidebar items use `useDraggable` with same mechanism
- Task gains/updates its `due_date`

**Edge navigation (adjacent months) — custom implementation:**
- Left/right zones (~40px) at calendar edges are droppable (`useDroppable({ id: 'edge-prev' / 'edge-next' })`)
- Track `onDragOver` events: when drag enters an edge zone, start a `setTimeout(500ms)`. When drag leaves, `clearTimeout`.
- After 500ms hover delay, call `setCurrentMonth(prev/next)` to advance the calendar
- Visual indicator: subtle arrow highlight on the active zone
- Bounded: cannot go before current month, cannot go beyond 12 months from today
- The actual drop still targets a `CalendarDayCell`, not the edge zone

**Month strip navigation (jumping ahead) — custom implementation:**
- Each month label is a droppable (`useDroppable({ id: 'month-2026-05' })`)
- Track `onDragOver` events with `setTimeout(400ms)` / `clearTimeout` pattern
- After 400ms hover delay, call `setCurrentMonth(targetMonth)` to switch the calendar view
- Then drop on the specific day cell in the new month
- Non-dragging clicks on month labels also navigate (standard month navigation)
- dnd-kit does NOT have native hover-delay-while-dragging — this is custom logic using `onDragOver`/`onDragLeave` events with timers

### Day Cell Overflow

- Show up to 3 task pills per day cell
- More than 3: show 2 pills + "+N more" clickable badge
- Clicking "+N more" opens a popover listing all tasks for that day (tasks remain draggable from the popover)

### Day Cell Task Order

Tasks within a single day cell are ordered by `sort_order ASC`. No drag-reorder within a day cell — reordering is only for moving between days.

### Sidebar Sort Order

- **Overdue tasks:** sorted by `due_date ASC` (most overdue first)
- **Undated tasks:** sorted by `created_at DESC` (newest first)
- Overdue section appears above undated section

### Mobile Behaviour

- Calendar collapses to a week-at-a-time horizontal strip view
- Sidebar moves below the calendar
- Drag-and-drop disabled — tap a task to open a date picker instead
- Month strip collapses to prev/next arrows only

### Data Fetching

- Fetch all non-done tasks using `getAllTasks()` from `useApiClient` with `states=today,this_week,backlog,waiting`. **Must use `getAllTasks()`** which handles pagination — `getTasks()` has a 200-task limit that would silently truncate results.
- No per-month API calls — filter by visible month client-side
- Re-fetch on task mutation (due_date update) for consistency

### Task Pill Design

- Compact: single line, truncated task name
- Left border colour based on task state:
  - today = blue
  - this_week = indigo
  - backlog = grey
  - waiting = amber
- Shows project name as subtle secondary text if space allows
- Due date not shown (it's implicit from the cell position)

### No New API Endpoints

- `PATCH /api/tasks/[id]` — update `due_date` on drop (existing)
- `GET /api/tasks` — fetch all tasks with pagination (existing)

---

## Database Migration

One new table for cron idempotency:

```sql
-- Migration: Add cron_runs table for idempotent cron execution tracking

CREATE TABLE public.cron_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation TEXT NOT NULL,
  run_date DATE NOT NULL,
  tasks_affected INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'claimed',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(operation, run_date)
);

-- RLS enabled but no user-scoped policies (service-role only)
ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;

-- Service-role only. Explicit REVOKE for defence-in-depth.
GRANT ALL ON TABLE public.cron_runs TO service_role;
REVOKE ALL ON TABLE public.cron_runs FROM anon, authenticated;
```

---

## Shared Utility: Cron Auth

Extract cron auth logic into `src/lib/cronAuth.js` to prevent drift across 4 cron endpoints:

```javascript
// verifyCronAuth(request) — multi-layer cron auth check
// Supports: x-vercel-cron header, CRON_SECRET via x-cron-secret,
// optional CRON_MANUAL_TOKEN for manual testing
// Returns: { authorized: boolean, dryRun: boolean, force: boolean }
```

Refactor existing `daily-task-email/route.js` to use this shared utility.

---

## Vercel Configuration Changes

Add to `vercel.json` crons array:

```json
{ "path": "/api/cron/demote-today-tasks", "schedule": "0 19 * * *" },
{ "path": "/api/cron/demote-today-tasks", "schedule": "0 20 * * *" },
{ "path": "/api/cron/demote-week-tasks", "schedule": "0 19 * * *" },
{ "path": "/api/cron/demote-week-tasks", "schedule": "0 20 * * *" }
```

Both endpoints use London-hour guard + idempotency so double-firing is safe.

---

## Environment Variables

New env var (optional — falls back to existing):

```
DEMOTE_EMAIL_TO=peter@orangejelly.co.uk   # Falls back to DAILY_TASK_EMAIL_TO
```

---

## Files to Create

| File | Type |
|------|------|
| `supabase/migrations/YYYYMMDD_add_cron_runs_table.sql` | Migration |
| `src/lib/cronAuth.js` | Shared utility |
| `src/app/api/cron/demote-today-tasks/route.js` | API route (GET) |
| `src/app/api/cron/demote-week-tasks/route.js` | API route (GET) |
| `src/app/calendar/page.js` | Page route |
| `src/components/calendar/CalendarView.jsx` | Component |
| `src/components/calendar/CalendarGrid.jsx` | Component |
| `src/components/calendar/CalendarDayCell.jsx` | Component |
| `src/components/calendar/CalendarTaskPill.jsx` | Component |
| `src/components/calendar/CalendarSidebar.jsx` | Component |
| `src/components/calendar/MonthStrip.jsx` | Component |
| `src/components/calendar/EdgeNavigator.jsx` | Component |

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/taskSort.js` | Add `compareBacklogTasks` function |
| `src/components/plan/PlanBoard.jsx` | Add client-side `.sort(compareBacklogTasks)` for backlog tasks |
| `src/components/layout/TabBar.jsx` | Add Calendar tab with CalendarDaysIcon |
| `src/components/layout/Sidebar.jsx` | Add Calendar nav item with Calendar (Lucide) icon |
| `src/app/api/cron/daily-task-email/route.js` | Refactor to use shared `verifyCronAuth()` |
| `vercel.json` | Add 4 new cron entries |

---

## Out of Scope

- Multi-user support for email notifications (env-var-driven, single-user)
- Re-adding a priority field to tasks
- Calendar recurring events
- Week or day calendar views (month only)
- Task creation from calendar (use existing capture/quick-add flows)
- Drag-reorder within a single day cell
- Undo for drag-drop (use toast notification as awareness mechanism)
