# Design Spec: Task Auto-Demote, Backlog Sort & Calendar View

**Date:** 2026-04-13
**Status:** Draft
**Scope:** Four features — auto-demote crons, backlog sort, calendar view tab

---

## Feature 1: Auto-Demote Today Tasks (Daily 20:00 London)

### Endpoint

`POST /api/cron/demote-today-tasks`

### Schedule

Vercel cron at both `0 19 * * *` and `0 20 * * *` UTC. Idempotency check ensures it only executes once per day — covers both GMT and BST so it always fires at 20:00 London time.

### Logic

1. Verify cron auth (`x-vercel-cron` header or `CRON_SECRET`)
2. Check idempotency — query a tracking mechanism (reuse `daily_task_email_runs` pattern with a new table or operation_type) for today's date. If already run, return early.
3. Query all tasks where `state = 'today'` using service-role Supabase client
4. Bulk update: set `state = 'this_week'`. The `fn_task_state_cleanup` trigger automatically clears `today_section` to NULL.
5. Group demoted tasks by `user_id`
6. For each user with demoted tasks, send email via `sendMicrosoftEmail()` from `src/lib/microsoftGraph.js`:
   - **To:** peter@orangejelly.co.uk (single-user system)
   - **Subject:** "Daily Review: X tasks moved from Today to This Week"
   - **Body:** HTML list of task names with project name (if assigned) and due date (if set)
7. Log the run (date, count, status)
8. Return JSON response with summary

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

New table `cron_runs` or reuse `daily_task_email_runs` with an `operation_type` column. Check `(operation_type = 'demote_today', run_date = today)` before executing. Insert on completion.

**Decision: New table `cron_runs`** to keep concerns separate from email tracking.

```sql
CREATE TABLE public.cron_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation TEXT NOT NULL,
  run_date DATE NOT NULL,
  tasks_affected INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(operation, run_date)
);
```

RLS enabled, no user-scoped policies (service-role only access).

---

## Feature 2: Auto-Demote This Week Tasks (Sunday 20:00 London)

### Endpoint

`POST /api/cron/demote-week-tasks`

### Schedule

Same dual-schedule pattern: `0 19 * * *` and `0 20 * * *` UTC with idempotency.

### Logic

1. Verify cron auth
2. Check if today is Sunday in `Europe/London` timezone. If not, return early with `{ skipped: true, reason: 'not Sunday' }`.
3. Check idempotency via `cron_runs` table for `(operation = 'demote_week', run_date = today)`
4. Query all tasks where `state = 'this_week'`
5. Bulk update: set `state = 'backlog'`
6. Group by user, send email via `sendMicrosoftEmail()` from `src/lib/microsoftGraph.js`:
   - **To:** peter@orangejelly.co.uk
   - **Subject:** "Weekly Review: X tasks moved from This Week to Backlog"
   - **Body:** HTML list of task names with project and due date
7. Log the run
8. Return JSON response

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

### Application

- `PlanBoard.jsx` — backlog column switches from `compareTasksBySortOrderAsc` to `compareBacklogTasks`
- Other columns (today, this_week, waiting) keep their existing sort functions unchanged
- Manual drag reordering within backlog still updates `sort_order` as normal, but only affects ordering among tasks with the same due date

### No Changes Required

- No database migration
- No API changes
- No new dependencies

---

## Feature 4: Calendar View

### Route & Navigation

**Route:** `/calendar` — `src/app/calendar/page.js`

**Tab position:** Between "Plan" and "Projects" in TabBar and Sidebar:
`Today | Plan | Calendar | Projects | Ideas`

**Icon:** `CalendarDaysIcon` from `@heroicons/react/24/outline`

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
| CalendarTaskPill | `src/components/calendar/CalendarTaskPill.jsx` | Compact draggable task pill — truncated name, colour hint from task state |
| CalendarSidebar | `src/components/calendar/CalendarSidebar.jsx` | Right panel — lists overdue and undated tasks as draggable items |
| MonthStrip | `src/components/calendar/MonthStrip.jsx` | Horizontal row of 12 month buttons — drag-hover switches month, click navigates |
| EdgeNavigator | `src/components/calendar/EdgeNavigator.jsx` | Left/right edge zones (~40px) — auto-advance month on 500ms drag hover |

### Drag-and-Drop Behaviour

**Library:** dnd-kit (already installed — `@dnd-kit/core` v6.3.1, `@dnd-kit/sortable` v10.0.0)

**Task onto day cell:**
- Updates `due_date` via existing `PATCH /api/tasks/[id]`
- Optimistic UI — task moves immediately, reverts on API failure
- Toast: "Task moved to 15 Apr"

**From sidebar to calendar:**
- Sidebar items are draggable with same mechanism
- Task gains/updates its `due_date`

**Edge navigation (adjacent months):**
- Left/right zones (~40px) at calendar edges
- Hovering while dragging for 500ms advances/retreats month by one
- Visual indicator: subtle arrow highlight on the active zone
- Bounded: cannot go before current month, cannot go beyond 12 months from today

**Month strip navigation (jumping ahead):**
- Hovering over a month label while dragging switches calendar to that month after 400ms delay
- Drop on the specific day cell in the new month
- Non-dragging clicks also navigate (standard month navigation)

### Day Cell Overflow

- Show up to 3 task pills per day cell
- More than 3: show 2 pills + "+N more" clickable badge
- Clicking "+N more" opens a popover listing all tasks for that day (tasks remain draggable from the popover)

### Mobile Behaviour

- Calendar collapses to a week-at-a-time horizontal strip view
- Sidebar moves below the calendar
- Drag-and-drop disabled — tap a task to open a date picker instead
- Month strip collapses to prev/next arrows only

### Data Fetching

- Fetch all non-done tasks for the user on mount (same `useApiClient` pattern as other views)
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
- `GET /api/tasks` — fetch all tasks (existing)

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
  status TEXT NOT NULL DEFAULT 'success',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(operation, run_date)
);

-- RLS enabled but no user-scoped policies (service-role only)
ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;

-- Grant access to service_role only
GRANT ALL ON TABLE public.cron_runs TO service_role;
```

---

## Vercel Configuration Changes

Add to `vercel.json` crons array:

```json
{ "path": "/api/cron/demote-today-tasks", "schedule": "0 19 * * *" },
{ "path": "/api/cron/demote-today-tasks", "schedule": "0 20 * * *" },
{ "path": "/api/cron/demote-week-tasks", "schedule": "0 19 * * *" },
{ "path": "/api/cron/demote-week-tasks", "schedule": "0 20 * * *" }
```

Both endpoints use idempotency checks so double-firing is safe.

---

## Files to Create

| File | Type |
|------|------|
| `supabase/migrations/YYYYMMDD_add_cron_runs_table.sql` | Migration |
| `src/app/api/cron/demote-today-tasks/route.js` | API route |
| `src/app/api/cron/demote-week-tasks/route.js` | API route |
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
| `src/components/plan/PlanBoard.jsx` | Use `compareBacklogTasks` for backlog column |
| `src/components/layout/TabBar.jsx` | Add Calendar tab |
| `src/components/layout/Sidebar.jsx` | Add Calendar nav item |
| `vercel.json` | Add 4 new cron entries |

---

## Out of Scope

- Multi-user support for email notifications (hardcoded to peter@orangejelly.co.uk)
- Re-adding a priority field to tasks
- Calendar recurring events
- Week or day calendar views (month only)
- Task creation from calendar (use existing capture/quick-add flows)
