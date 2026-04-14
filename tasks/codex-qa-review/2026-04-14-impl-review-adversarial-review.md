# Adversarial Review: Smart Planning Prompts (Post-Implementation)

**Date:** 2026-04-14
**Mode:** Spec Compliance (Mode C) — post-implementation
**Engines:** Codex (6 reviewers)
**Scope:** All new/modified files from smart planning prompts implementation

## Executive Summary

The feature is architecturally sound — auth patterns, view invalidation, API contracts, and component structure are all correct. However, **the migration SQL diverges from what the code expects**, which means the feature won't work on a fresh database. There are also 3 high-severity logic bugs (weekly window detection, Sunday combined flow, cron timing) and several medium issues (optimistic UI, banner gating, defer logic, sort_order filtering).

## What Appears Solid

- Auth consistent across all 3 new API routes (getAuthContext, session scoping, no cross-user paths)
- API client methods match route contracts (HTTP verbs, paths, response unwrapping)
- View invalidation via planning-complete event works correctly in all 3 views
- planning-candidates endpoint correctly avoids Office365 sync
- UNIQUE constraint on planning_sessions with upsert is correct
- Component prop interfaces match between AppShell, hook, modal, and banner
- No SQL injection, no broken imports, build passes clean

## Critical Issues (Must Fix)

### CRIT-001: Migration schema doesn't match code
**Flagged by:** ALL 6 reviewers
The migration creates `daily_planning_enabled`, `weekly_planning_enabled`, `planning_snooze_until` but the code reads `daily_plan_start`, `daily_plan_end`, `weekly_plan_start`, `weekly_plan_end`. Also `planning_sessions` has extra unused columns (`started_at`, `dismissed_at`, `tasks_promoted`, `tasks_added`). **The entire feature is dead on arrival with the current migration.**

### CRIT-002: Sunday combined flow has no daily candidates
**Flagged by:** AB-004, ARCH-002, WF-006, SPEC-012, SEC-005
The hook fetches one candidate payload for the active window type. On Sunday it fetches weekly only. Step 2 (daily) expects `dueTomorrow`/`undatedThisWeek` which were never fetched. The modal needs to fetch daily candidates when transitioning to step 2.

### CRIT-003: Weekly window detection is wrong
**Flagged by:** AB-002, SPEC-005
`isInsideWindow()` with `20:05→20:00` treats it as an overnight wrap, so Sunday morning before 20:05 incorrectly resolves as active weekly. Also weekly only checked on Sun/Mon — Tue-Sat revisiting is not supported.

### CRIT-004: Cron timing wrong in GMT
**Flagged by:** AB-005, SPEC-004
`18:55 UTC` in winter is `18:55 London` — one hour too early. The `claimCronRun` dedup means the early run claims the day and the correct `19:55` run is skipped.

## High Issues

### HIGH-001: Optimistic UI with no rollback
**Flagged by:** AB-009, WF-004, SEC-002
PlanningTaskRow marks tasks actioned immediately without awaiting the mutation. Failed PATCHes show as successful. User can Finish Planning with failed mutations, recording a session that suppresses future prompts.

### HIGH-002: sort_order not persisted
**Flagged by:** SPEC-016
Modal computes max sort_order and sends it in updateTask, but `taskService.js` filters it out via `filterTaskUpdates`. Planned tasks get unpredictable positions.

## Medium Issues

- **Banner disappears when planned:** AppShell only renders banner when `totalCandidates > 0`, hiding the planned/revisit state (AB-008, ARCH-003)
- **Banner copy misleading:** "tasks due tomorrow" includes overdue + undated (WF-005)
- **New tasks detection wrong:** `hasNewTasks` = any candidates exist, including skipped items (AB-007)
- **Defer backlog logic wrong for daily:** Uses `windowDate + 6` but daily windowDate is tomorrow, not Monday (AB-010, SPEC-015)
- **O365 sync triggered by modal:** getTasks() for section counts hits /api/tasks which triggers sync (AB-006, ARCH-005, SEC-003)
- **Settings not invalidated:** refreshSettings() exposed but never called from settings page (AB-011, ARCH-004)
- **windowDate not semantically validated:** `2026-02-31` passes regex (SEC-004)
