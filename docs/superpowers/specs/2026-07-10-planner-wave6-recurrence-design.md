# Planner 2.0 — Redesign Wave 6: Recurring Tasks (Design Spec)

**Date:** 2026-07-10
**Status:** Approved to build (user "continue to wave 6" + delegated). Wave-by-wave; merge at the end.
**Phase:** 2, Wave 6 (P4). Builds on Waves 1–5 (all merged to `main`).

## Goal of Wave 6

Repeating work — standups, weekly reviews, monthly reports, watering the plants — currently has to be re-created by hand every time. P4 lets a task **repeat on a schedule**: when you complete a recurring task, the next occurrence is created automatically, dated, so it can never be forgotten.

Rules-only, no LLM, no new external data flow.

## Data model (one additive migration)

- `tasks.recurrence text` — one of `daily` | `weekdays` | `weekly` | `monthly`, or NULL (not recurring). CHECK-constrained.
- `tasks.recurrence_interval integer NOT NULL DEFAULT 1` — "every N days/weeks/months" (ignored for `weekdays`).

Both are client-settable (a user chooses them on a task). They are added to the task create/update allowlists. The next-occurrence creation itself is **server-triggered**, never client-driven.

## Next-occurrence rule

`src/lib/recurrence.js` — a pure, tested `nextRecurrenceDate(fromDateKey, recurrence, interval)` returning a `YYYY-MM-DD` key (all in Europe/London calendar terms, via the existing date helpers):
- `daily` → `fromDate + interval` days.
- `weekdays` → the next Mon–Fri day after `fromDate` (interval ignored).
- `weekly` → `fromDate + interval * 7` days (same weekday).
- `monthly` → `fromDate + interval` months, clamped to the month's last day when the day-of-month doesn't exist (e.g. Jan 31 → Feb 28).
Returns null for an unknown pattern.

## Behaviour (server, in `taskService.updateTask`)

When a task with a non-null `recurrence` transitions **into** `state='done'` (a real completion), the service creates the **next occurrence** as a fresh task:
- `due_date` = `nextRecurrenceDate(base, recurrence, interval)` where `base` = the completing task's `due_date` if set, else today's London date. (So a dated recurring task advances from its due date; an undated one advances from today.)
- Carried over: `name`, `description`, `project_id`, `area`, `task_type`, `chips`, `recurrence`, `recurrence_interval`.
- Fresh: `state='backlog'` with the computed `due_date` (so it surfaces in the planning candidates / calendar and can't be lost), new timestamps; NOT carried: `completed_at`, `today_section`, `sort_order`, snooze/carry/autopilot/inbox markers.
- The completed task stays `done` (the history). Idempotency: only spawn on the transition into done (guard on `oldState !== 'done'`), so re-saving a done task never spawns duplicates. Creation failure is logged and never blocks the completion.

## UI

- **Recurrence selector** in `TaskDetailDrawer`: a "Repeats" control — Never / Every day / Weekdays / Every week / Every month (+ an interval number where it makes sense) — bound to `recurrence`/`recurrence_interval`, saved via the existing task update path.
- A small **"Repeats"** badge on `TaskCard` for recurring tasks (non-colour-only), so it's clear a task will regenerate.
- No change to how completion is triggered — the next instance simply appears (a `tasks-changed` refresh shows it).

## What is NOT in Wave 6

Full RRULE/iCal support, "every 2nd Tuesday"-style rules, end dates / occurrence counts, editing a whole series (each instance is independent), sk-ip/pause of a series, and anything LLM/capacity-related.

## Rollout order

migration → `recurrence.js` pure lib + tests → taskService next-occurrence spawn + allowlists + select → TaskDetailDrawer selector + TaskCard badge.

## Acceptance criteria

- Completing a `daily` task creates one new `backlog` task due the next day (from its due date, or today if undated); completing it again does not double-spawn.
- `weekdays` skips weekends; `weekly`/`monthly` advance correctly, monthly clamping Jan 31 → Feb 28.
- Setting/clearing recurrence in the drawer persists; a recurring task shows the "Repeats" badge.
- A non-recurring task behaves exactly as before (no new task on completion).
- recurrence/recurrence_interval are server-validated; the spawn is server-only and idempotent on the done transition.

## Verification

Workspace pipeline: `npm run lint`, `npm test` (existing 190 + new recurrence-date + spawn unit tests, mocked IO), `npm run build`. Migration applied to the live DB. Adversarial interaction review of the whole Wave 6 diff before merge.
