# Planner 2.0 — Redesign Wave 5: Project-Altitude Radar (Design Spec)

**Date:** 2026-07-10
**Status:** Approved to build (user "continue to wave 5" + delegated). Wave-by-wave; merge at the end.
**Phase:** 2, Wave 5 (P1). Builds on Waves 1–4 (all merged to `main`).

## Goal of Wave 5

Tasks can no longer get lost (Waves 1–2), but a whole **project** can still silently stall — every one of its tasks sits undated in Backlog, or it has no tasks at all, so nothing will ever pull it forward. P1 raises the altitude from tasks to projects: **every open project should always have a scheduled next action, and the app surfaces the ones that don't.**

Rules-only, no migration, no new external data flow, no LLM.

## Definitions

- **Open project:** `status = 'Open'`. `On Hold` is a deliberate pause (excluded from alarms but shown as paused); `Completed`/`Cancelled` are excluded entirely.
- **Has a next action:** the project has ≥1 incomplete task (`state != 'done'`) that is *scheduled* — `state IN ('today','this_week')`, OR a non-null `due_date`, OR (`state='waiting'` with a non-null `follow_up_date`). An open project whose only tasks are undated Backlog (or which has no tasks) has **no next action**.
- **Stalled:** an Open project with no next action. This is the thing to surface.
- **lastActivityAt:** most recent of the project's `updated_at` and its tasks' `updated_at` — "when did anything happen here".

## Backend

**NEW `src/services/projectRadarService.js`:**
- `buildProjectRadar({ projects, tasksByProject, nowMs })` (pure): returns one row per non-terminal project — `{ projectId, name, status, area, dueDate, hasNextAction, openTaskCount, nextDueDate, lastActivityAt, stalled }`. `stalled = status==='Open' && !hasNextAction`. `On Hold` projects get `stalled=false` but are flagged `paused`. Sort stalled first, then by `lastActivityAt` ascending (most-neglected first).
- `fetchProjectRadar({ supabase, userId, nowMs })` (IO): loads the user's non-terminal projects and their incomplete tasks (one query each, scoped by `user_id`), aggregates per project, calls the pure builder. Resilient — a failed sub-query returns an empty radar rather than throwing.

**NEW GET `/api/projects/radar`** (session-auth, user-scoped): returns `{ projects: [...radar rows...], stalledCount }`. No secrets.

**Digest integration (A4):** add a **"Projects needing a next action"** section to the morning digest — the stalled open projects (name + area + "last touched …"), truncated with "+N more". Reuses `fetchProjectRadar` for the digest user; omitted cleanly when there are none. This is the daily nudge to un-stall a project.

## Frontend

A **"Needs a next action"** section at the top of the Projects view (`ProjectsView`):
- Fetches `/api/projects/radar` on mount and on `tasks-changed`/`visibilitychange` (silent refresh, latest-wins guard — same pattern as the rest of the app).
- Lists stalled open projects: name, area, "last touched …" (London relative time), and a one-tap affordance to **open the project** (where the existing add-task input lets the user give it a next action). Acting on a project (adding a scheduled task) drops it from the list on the next refresh.
- A subtle count badge; the section renders nothing when no project is stalled (the healthy state). Handles loading/empty/error without a blank flash.
- Not colour-only; accessible; British English; existing design tokens.

## What is NOT in Wave 5

Auto-creating a next action (the user decides what it is), project health scoring/trends, `On Hold` auto-wake, capacity/calendar (A7), LLM suggestions (A5), recurrence (P4), chase engine (S1).

## Rollout order

projectRadarService (pure + fetch) + `/api/projects/radar` → digest section → Projects-view radar UI.

## Acceptance criteria

- An Open project whose only tasks are undated Backlog (or which has no tasks) appears in "Needs a next action"; giving it a Today/This-Week/dated task removes it on refresh.
- `On Hold`, `Completed`, `Cancelled` projects never appear as stalled.
- The morning digest lists stalled projects (truncated), and omits the section when none.
- The radar API returns no secrets and only the caller's projects.
- Healthy state (no stalled projects) shows nothing intrusive.

## Verification

Workspace pipeline: `npm run lint`, `npm test` (existing 165 + new radar classification unit tests, mocked IO), `npm run build`. No migration. Adversarial interaction review of the whole Wave 5 diff before merge.
