# Smart Planning Prompts — Design Spec

**Date:** 2026-04-14
**Status:** Approved (revised after adversarial review)
**Review:** `tasks/codex-qa-review/2026-04-14-smart-planning-prompts-adversarial-review.md`

## Overview

Automated planning prompts that surface tasks with upcoming due dates and ask the user to slot them into their day or week. The app checks the current time on page load and, if inside a configurable planning window, presents a modal to triage tasks. A fallback banner persists for revisiting.

## Planning Windows

Two time-based windows, configurable per-user via a settings page:

| Window | Default Start | Default End | When |
|--------|--------------|-------------|------|
| Daily | 20:05 today | 20:00 tomorrow | Every day except Sunday |
| Weekly | 20:05 Sunday | 20:00 next Sunday | Sundays only (prompt available through the week for revisiting, primary intent is Sunday evening planning) |

On Sunday evenings, the weekly and daily (Monday) flows combine into a single two-step session.

All time calculations use Europe/London timezone. A dedicated `getLondonPlanningWindow()` utility determines window membership — this must NOT reuse `getStartOfTodayLondon()` (which only gives midnight) or browser-local date-fns helpers (`isToday`, `isTomorrow`, `isThisWeek`) which use local time. Instead, use `date-fns-tz` with `Europe/London` to compute the current London time and compare against window boundaries.

### Cron Interaction

The existing demote crons (`demote-today-tasks` at London hour 20, `demote-week-tasks` on Sundays at London hour 20) must be shifted to run at **19:55 London time** (before the planning window opens at 20:05). This ensures:
- Today's tasks are demoted before the user starts planning tomorrow
- This week's tasks are demoted before the user starts planning next week
- No race condition between cron demotion and planning assignment

**Implementation:** Update the cron schedules in `vercel.json` to fire at 19:55 UTC / 18:55 UTC (covering both GMT and BST). The cron route logic itself does not change.

## Data Model

### New table: `planning_sessions`

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| `id` | uuid, PK | `DEFAULT gen_random_uuid()` | |
| `user_id` | uuid, FK → users | NOT NULL | Who planned |
| `window_type` | text | `CHECK (window_type IN ('daily', 'weekly'))` NOT NULL | Which planning window |
| `window_date` | date | NOT NULL | Target date — tomorrow for daily, Monday of target week for weekly |
| `completed_at` | timestamptz | NOT NULL, `DEFAULT now()` | When the session was recorded |
| `created_at` | timestamptz | NOT NULL, `DEFAULT now()` | Row creation time |

**Constraints:**
- `UNIQUE (user_id, window_type, window_date)` — one session per user per window. Use upsert (`ON CONFLICT (user_id, window_type, window_date) DO UPDATE SET completed_at = now()`) for idempotent writes.
- RLS policy: users can only read/write their own rows (scoped by `user_id = auth.uid()`). Note: since the app uses service-role client, RLS is a defence-in-depth layer — the API route must also scope queries to `session.user.id`.

### New table: `user_settings`

| Column | Type | Default | Constraints | Purpose |
|--------|------|---------|-------------|---------|
| `id` | uuid, PK | `gen_random_uuid()` | | |
| `user_id` | uuid, FK → users | | UNIQUE, NOT NULL | One row per user |
| `daily_plan_start` | time | '20:05' | NOT NULL | When daily prompt activates |
| `daily_plan_end` | time | '20:00' | NOT NULL | When daily prompt expires (next day) |
| `weekly_plan_start` | time | '20:05' | NOT NULL | When weekly prompt activates (Sunday) |
| `weekly_plan_end` | time | '20:00' | NOT NULL | When weekly prompt expires (next Sunday) |
| `created_at` | timestamptz | `now()` | NOT NULL | |
| `updated_at` | timestamptz | `now()` | NOT NULL | Auto-updated via trigger |

**Constraints:**
- `updated_at` trigger (same pattern as existing tables)
- RLS policy: users can only read/write their own row
- If no row exists for a user, the API returns defaults. No row is created until the user first saves custom settings.

No changes to the existing `tasks` table — the planning flow uses existing fields (`due_date`, `state`, `today_section`).

## Task Surfacing Logic

### New endpoint: `GET /api/planning-candidates`

A dedicated endpoint that returns tasks matching the planning window criteria. This is necessary because the existing `/api/tasks` GET route only supports `state`/`states`/`completedSince` filtering — it has no due-date range, null due-date, or state-exclusion filters.

**Query parameters:**
- `windowType` — `'daily'` or `'weekly'`
- `windowDate` — ISO date string (e.g. `'2026-04-15'`)

**Server-side logic:**

For `windowType=daily`:
1. **Due tomorrow:** `due_date = windowDate AND state NOT IN ('today', 'done')`
2. **Overdue:** `due_date < windowDate AND state NOT IN ('today', 'done')`
3. **Undated THIS_WEEK:** `state = 'this_week' AND due_date IS NULL`

For `windowType=weekly`:
1. **Due this week:** `due_date BETWEEN windowDate AND windowDate + 6 days AND state NOT IN ('today', 'done')`
2. **Overdue:** `due_date < windowDate AND state NOT IN ('this_week', 'today', 'done')`

**Response shape:** `{ data: { dueTomorrow: [...], overdue: [...], undatedThisWeek: [...] } }` (daily) or `{ data: { dueThisWeek: [...], overdue: [...] } }` (weekly). Each task includes: `id`, `name`, `due_date`, `state`, `today_section`, `project_name`, `project_area`, `chips`, `task_type`, `area`.

**Important:** This endpoint does NOT trigger Office365 sync (unlike the general `/api/tasks` GET). It is a read-only query with no side effects.

### Daily planning — which tasks appear

1. **Due tomorrow** — `due_date` = tomorrow's date, state NOT in (`today`, `done`)
2. **Overdue** — `due_date` < tomorrow, state NOT in (`today`, `done`) — tasks that slipped past their date without being planned
3. **Undated THIS_WEEK** — `state` = 'this_week', `due_date` is null — already in the week but not pinned to a day

Displayed in that priority order with section headers: "Due Tomorrow", "Overdue", "Available This Week".

### Weekly planning — which tasks appear

1. **Due this coming week** — `due_date` between Monday and Sunday of the target week, state NOT in (`today`, `done`)
2. **Overdue** — `due_date` < Monday of target week, state NOT in (`this_week`, `today`, `done`)

Displayed as: "Due This Week", "Overdue".

### Actions per task

| Context | Actions |
|---------|---------|
| Weekly flow | Accept → moves to THIS_WEEK state / Skip → leaves as-is / Defer → pick a new date (+ state change, see below) |
| Daily flow | Assign to MUST_DO, GOOD_TO_DO, or QUICK_WINS → moves to TODAY with that section / Skip → leaves as-is / Defer → pick a new date (+ state change, see below) |

**Defer state transitions:** When deferring a task:
- If the new date falls within the current week → state remains unchanged
- If the new date falls outside the current week → state changes to `backlog`
- The defer action updates both `due_date` and `state` in a single PATCH call

**Skip behaviour for overdue tasks:** Skipped overdue tasks remain in their current state and will reappear in subsequent planning sessions until the user actively defers, completes, or moves them. This is intentional — overdue items should not silently disappear from planning prompts.

**Sort order on acceptance:** Tasks moved to TODAY during daily planning are appended to the end of their target section (`sort_order` = max existing in that section + 1). Tasks moved to THIS_WEEK during weekly planning are appended to the end of the THIS_WEEK list. This ensures planned tasks don't appear at unpredictable positions.

**Side effects preserved:** Acceptance calls the existing `updateTask` mutation path (`apiClient.updateTask()` → `PATCH /api/tasks` → `taskService.updateTask()`), which handles `entered_state_at`, `completed_at`, `today_section` defaults, and the DB trigger enforcing `state='today' ↔ today_section IS NOT NULL`. No special handling needed — the existing service layer covers these invariants.

### Soft cap warnings

When a TODAY section's count reaches its soft cap (MUST_DO: 5, GOOD_TO_DO: 5, QUICK_WINS: 8), a yellow inline warning appears: "You already have N Must Do tasks". Assigning is still allowed. Counts include tasks already in TODAY from before the session.

## UI Components

### PlanningModal

- Full-screen overlay with centred card
- Header shows context: "Plan Your Tomorrow — Tuesday 15th April" or "Plan Your Week — 14th–20th April"
- Task list: each row shows task name, project name, due date badge, chips badges, and task type icon
- Each task row has action buttons: section assignment pills (daily) or Accept/Skip/Defer (weekly)
- Defer opens an inline date picker reusing existing `quickPickOptions` from dateUtils
- Soft cap warning appears inline below the section pill when threshold is hit
- Footer: "Finish Planning" button → writes to `planning_sessions` (upsert), closes modal
- "Do This Later" button → dismisses without recording a session, modal returns next visit
- Clicking backdrop or pressing Escape behaves like "Do This Later"
- Error state: if the planning-candidates fetch fails, show an inline error with retry button

**Sunday combined flow:**
- Step indicator: "Step 1 of 2: Plan Your Week" → "Step 2 of 2: Plan Monday"
- Completing the weekly step auto-transitions to the daily step
- Both steps record separate `planning_sessions` rows (one `weekly`, one `daily`)
- Tasks accepted in the weekly step that have `due_date` = Monday are excluded from the daily step's "Due Tomorrow" bucket (already triaged)

**Mount point:** The PlanningModal renders as a fixed-position sibling in `AppShell`, with z-index above all navigation elements (Sidebar, Header, TabBar, QuickCapture). It does NOT mount inside individual views.

### PlanningBanner

- Slim bar at top of page (below TabBar, above `{children}` inside `<main>`)
- Variants:
  - **Daily, not yet planned:** "You have N tasks due tomorrow — Plan now" with CTA button
  - **Daily, already planned:** "Tomorrow's planned — Revisit" with muted styling, dismissible
  - **Weekly, not yet planned:** "You have N tasks due this week — Plan now" with CTA button
  - **Weekly, already planned:** "Week planned — Revisit" with muted styling, dismissible
  - **New tasks detected:** "1 new task due tomorrow — Plan now" (re-activates CTA)
- Appears on all main views (today, plan, calendar) during an active window
- Ensure `/calendar` is included in route gating (currently missing from `TAB_ROUTES` in AppShell)

**Mount point:** Renders inside `<main>` in `AppShell`, below TabBar and above `{children}`.

### Settings page addition

New section on the existing settings page with four time inputs for daily/weekly planning window start/end times. Simple form with Zod validation, saves to `user_settings` table via `PATCH /api/user-settings`.

## Hook & State Management

### `usePlanningPrompt` hook

Central orchestrator, mounted in `AppShell` (which is already a client component):

1. Get current London time using `date-fns-tz` with `Europe/London`
2. Fetch user's planning window settings (from `/api/user-settings`, cached in state)
3. Determine which window is active (daily, weekly, or none)
4. If active → check `/api/planning-sessions` for a matching row
5. If active and not planned → fetch candidates from `/api/planning-candidates`
6. Return: `{ isActive, isLoading, windowType, isPlanned, tasks, openModal }`

**`isLoading` behaviour:** The modal and banner must NOT render until `isLoading` is false. This prevents flash-of-modal on slow networks and avoids conflating "no tasks" with "tasks still loading".

**Re-evaluation:** The hook re-runs on:
- Initial mount
- Pathname changes (client navigation via `usePathname()`)
- `visibilitychange` event (tab regains focus — catches cross-device planning and time-based transitions)

Caches the settings fetch — only re-fetches on settings page save or tab focus. Both the modal and banner consume the hook's state.

### View invalidation

When the planning modal closes after task mutations, it emits a custom `planning-complete` event on `window`. Active views (TodayView, PlanBoard, CalendarView) listen for this event and refetch their task data. This avoids coupling the modal to specific views while ensuring stale data is refreshed.

### New API routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/planning-candidates` | GET | Fetch tasks matching planning window criteria |
| `/api/planning-sessions` | GET | Check if a session exists for a given window |
| `/api/planning-sessions` | POST | Record a completed planning session (upsert) |
| `/api/user-settings` | GET | Fetch planning window times (returns defaults if no row) |
| `/api/user-settings` | PATCH | Update planning window times |

Task mutations use the existing `updateTask` API — no new task mutation endpoints needed.

No new cron jobs. Existing demote crons are rescheduled to 19:55 (see Cron Interaction section).

## Security

All new API routes must:

1. **Authenticate:** Call `getAuthContext(request)` and return `401` if no session
2. **Scope to user:** Derive `user_id` from `session.user.id` — never accept `user_id` from the client request body or query params
3. **Validate input:** Use Zod schemas for all request bodies and query params:
   - `POST /api/planning-sessions`: validate `window_type` is `'daily'|'weekly'`, `window_date` is a valid ISO date
   - `PATCH /api/user-settings`: validate all four time fields are valid `HH:MM` format, start times are not equal to end times
   - `GET /api/planning-candidates`: validate `windowType` and `windowDate`
4. **Return proper errors:** `400` for validation failures with descriptive messages, `401` for missing auth, `500` with generic message for server errors (no stack traces)
5. **Follow existing patterns:** Use `getSupabaseServiceRole()` for database access, manual `user_id` scoping on all queries, `NextResponse.json()` for responses

## Edge Cases

### Timing
- **Midnight crossover** — the daily window spans two calendar days (20:05 today → 20:00 tomorrow). The hook uses `window_date` (tomorrow's date) as the anchor, not the current date, so it works correctly regardless of which side of midnight you open the app.
- **DST transitions** — all time checks use London time via `date-fns-tz` with explicit `Europe/London` zone, so BST shifts don't break window calculations. The `getLondonPlanningWindow()` utility handles both GMT and BST correctly.
- **No tasks to plan** — if the planning-candidates query returns zero tasks, skip the modal entirely. No banner either.
- **Cron timing** — demote crons run at 19:55, completing before the 20:05 planning window opens. A 10-minute buffer accommodates slow cron execution or Vercel scheduling jitter.

### Planning sessions
- **Partial completion** — if you assign some tasks then close the browser, no session is recorded. Next visit re-shows the modal with only the remaining unactioned tasks (already-assigned tasks no longer match the query since their state changed to `today` or `this_week`). Skipped tasks will reappear since they still match the query — this is acceptable and even desirable for overdue items.
- **New tasks added mid-window** — if a task due tomorrow is added after planning, the hook re-runs the surfacing query on next page load or tab focus. The planning-candidates endpoint returns tasks matching the criteria; if results exist but a session row already exists, the banner switches to "N new task(s) due tomorrow — Plan now". Detection works by re-running the query (not count comparison) — any task in the result set that isn't already in `state='today'` is new.
- **Multiple devices** — `planning_sessions` is server-side, so planning on one device is reflected on another. The `visibilitychange` listener ensures the other device picks up the session state on tab focus.

### Soft caps
- Counts include tasks already in TODAY from before the planning session, not just tasks assigned during this session. The warning reflects the true total.

### "Plan tomorrow" appears in Today view immediately
When tasks are assigned to `state='today'` during evening planning, they appear in the Today view immediately. This is intentional — the user can review and reorder their lineup before bed. The demote cron has already run (at 19:55), so there is no risk of freshly-planned tasks being demoted.

## Architecture Decisions

- **Client-side time check, no push notifications** — simplest approach; the user is a regular app user so the modal catches them naturally on evening visits. Push notifications or email can be bolted on later via the existing cron infrastructure if needed.
- **Dedicated planning-candidates endpoint** — the existing `/api/tasks` lacks date-range filtering and triggers Office365 sync side effects. A dedicated read-only endpoint keeps the planning query clean, avoids pagination issues, and is easier to test.
- **Existing task mutation API reused** — no new mutation endpoints; the modal calls `updateTask` with `{ state, today_section, sort_order }` exactly as the Plan Board and Today View do. The existing service layer handles all side effects (entered_state_at, today_section defaults, DB trigger).
- **Separate planning_sessions table** — decoupled from tasks so planning state doesn't pollute task data. Session-level tracking only (no per-task decision log) — keeps the model simple. Per-task tracking can be added later if needed.
- **User-configurable times from day one** — stored in `user_settings` with sensible defaults, avoids hardcoded magic numbers.
- **Window event for view invalidation** — lightweight coupling between the modal and views via a custom DOM event, avoiding a shared state store or context provider.
- **Crons shifted to 19:55** — simplest resolution to the cron/planning conflict. No logic changes to cron routes, just a schedule adjustment.
