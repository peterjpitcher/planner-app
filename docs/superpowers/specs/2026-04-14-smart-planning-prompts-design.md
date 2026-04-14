# Smart Planning Prompts — Design Spec

**Date:** 2026-04-14
**Status:** Approved

## Overview

Automated planning prompts that surface tasks with upcoming due dates and ask the user to slot them into their day or week. The app checks the current time on page load and, if inside a configurable planning window, presents a modal to triage tasks. A fallback banner persists for revisiting.

## Planning Windows

Two time-based windows, configurable per-user via a settings page:

| Window | Default Start | Default End | When |
|--------|--------------|-------------|------|
| Daily | 20:05 today | 20:00 tomorrow | Every day except Sunday |
| Weekly | 20:05 Sunday | 20:00 next Sunday | Sundays only |

On Sunday evenings, the weekly and daily (Monday) flows combine into a single two-step session.

All time calculations use Europe/London timezone, following the existing `getStartOfTodayLondon()` pattern.

## Data Model

### New table: `planning_sessions`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid, PK | |
| `user_id` | uuid, FK → users | Who planned |
| `window_type` | text ('daily' \| 'weekly') | Which planning window |
| `window_date` | date | Target date — tomorrow for daily, Monday of target week for weekly |
| `completed_at` | timestamptz | When the session was finished |
| `created_at` | timestamptz | When the session was started |

### New table: `user_settings`

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `id` | uuid, PK | | |
| `user_id` | uuid, FK → users, unique | | One row per user |
| `daily_plan_start` | time | '20:05' | When daily prompt activates |
| `daily_plan_end` | time | '20:00' | When daily prompt expires (next day) |
| `weekly_plan_start` | time | '20:05' | When weekly prompt activates (Sunday) |
| `weekly_plan_end` | time | '20:00' | When weekly prompt expires (next Sunday) |
| `created_at` | timestamptz | | |
| `updated_at` | timestamptz | | |

No changes to the existing `tasks` table — the planning flow uses existing fields (`due_date`, `state`, `today_section`).

## Task Surfacing Logic

### Daily planning — which tasks appear

1. **Due tomorrow** — `due_date` = tomorrow's date, state NOT `done`
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
| Weekly flow | Accept → moves to THIS_WEEK state / Skip → leaves as-is / Defer → pick a new date |
| Daily flow | Assign to MUST_DO, GOOD_TO_DO, or QUICK_WINS → moves to TODAY with that section / Skip → leaves as-is / Defer → pick a new date |

### Soft cap warnings

When a TODAY section's count reaches its soft cap (MUST_DO: 5, GOOD_TO_DO: 5, QUICK_WINS: 8), a yellow inline warning appears: "You already have N Must Do tasks". Assigning is still allowed. Counts include tasks already in TODAY from before the session.

## UI Components

### PlanningModal

- Full-screen overlay with centred card
- Header shows context: "Plan Your Tomorrow — Tuesday 15th April" or "Plan Your Week — 14th–20th April"
- Task list: each row shows task name, project name, due date badge, priority indicator
- Each task row has action buttons: section assignment pills (daily) or Accept/Skip/Defer (weekly)
- Defer opens an inline date picker reusing existing `quickPickOptions` from dateUtils
- Soft cap warning appears inline below the section pill when threshold is hit
- Footer: "Finish Planning" button → writes to `planning_sessions`, closes modal
- "Do This Later" button → dismisses without recording a session, modal returns next visit

**Sunday combined flow:**
- Step indicator: "Step 1 of 2: Plan Your Week" → "Step 2 of 2: Plan Monday"
- Completing the weekly step auto-transitions to the daily step
- Both steps record separate `planning_sessions` rows (one `weekly`, one `daily`)

### PlanningBanner

- Slim bar at top of page (below nav, above content)
- Two variants:
  - **Not yet planned:** "You have N tasks due tomorrow — Plan now" with CTA button that opens the modal
  - **Already planned:** "Tomorrow's planned — Revisit" with muted styling, dismissible
- Appears on all main views (today, plan, calendar) during an active window

### Settings page addition

New section with four time inputs for daily/weekly planning window start/end times. Simple form, saves to `user_settings` table.

## Hook & State Management

### `usePlanningPrompt` hook

Central orchestrator, used in the app layout:

1. Get current London time
2. Fetch user's planning window settings (from `user_settings`, cached)
3. Determine which window is active (daily, weekly, or none)
4. If active → check `planning_sessions` for a matching row
5. Return: `{ isActive, windowType, isPlanned, tasks, openModal }`

Fetches candidate tasks via the existing `/api/tasks` endpoint with appropriate filters. Caches the settings fetch — only re-fetches on settings page save. Both the modal and banner consume the hook's state.

### New API routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/planning-sessions` | GET | Check if a session exists for a given window |
| `/api/planning-sessions` | POST | Record a completed planning session |
| `/api/user-settings` | GET | Fetch planning window times |
| `/api/user-settings` | PUT | Update planning window times |

Task mutations use the existing `updateTask` API — no new task endpoints needed.

No new cron jobs. This is entirely client-driven. Existing demote crons continue independently.

## Edge Cases

### Timing
- **Midnight crossover** — the daily window spans two calendar days (20:05 today → 20:00 tomorrow). The hook uses `window_date` (tomorrow's date) as the anchor, not the current date, so it works correctly regardless of which side of midnight you open the app.
- **DST transitions** — all time checks use London time via the existing `getStartOfTodayLondon()` pattern, so BST shifts don't break window calculations.
- **No tasks to plan** — if the query returns zero tasks, skip the modal entirely. No banner either.

### Planning sessions
- **Partial completion** — if you assign some tasks then close the browser, no session is recorded. Next visit re-shows the modal with only the remaining unactioned tasks (already-assigned tasks no longer match the query since their state changed).
- **New tasks added mid-window** — if a task due tomorrow is added after planning, the hook re-runs the surfacing query on next page load. If new unplanned tasks are found that weren't present when the session was recorded, the banner switches back to the "not yet planned" variant: "1 new task due tomorrow — Plan now". The existing `planning_sessions` row is not deleted; instead, the hook compares the surfaced task count against tasks already in TODAY to detect new arrivals.
- **Multiple devices** — `planning_sessions` is server-side, so planning on one device is reflected on another.

### Soft caps
- Counts include tasks already in TODAY from before the planning session, not just tasks assigned during this session. The warning reflects the true total.

## Architecture Decisions

- **Client-side time check, no push notifications** — simplest approach; the user is a regular app user so the modal catches them naturally on evening visits. Push notifications or email can be bolted on later via the existing cron infrastructure if needed.
- **Existing task API reused** — no new mutation endpoints; the modal calls `updateTask` with `{ state, today_section }` exactly as the Plan Board and Today View do.
- **Separate planning_sessions table** — decoupled from tasks so planning state doesn't pollute task data. Easy to query and reason about.
- **User-configurable times from day one** — stored in `user_settings` with sensible defaults, avoids hardcoded magic numbers.
