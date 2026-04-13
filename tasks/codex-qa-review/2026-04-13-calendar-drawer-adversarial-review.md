# Adversarial Review: Calendar Task Detail Drawer

**Date:** 2026-04-13
**Mode:** Spec Compliance (Mode C)
**Engines:** Claude + Codex
**Scope:** `docs/superpowers/specs/2026-04-13-calendar-task-drawer-design.md` against 5 calendar components + shared `TaskDetailDrawer`
**Spec:** `docs/superpowers/specs/2026-04-13-calendar-task-drawer-design.md`

## Inspection Inventory

### Inspected
- Spec document (full)
- `CalendarTaskPill.jsx` — props, drag/click handlers, context menu
- `CalendarView.jsx` — state, DnD setup, mutation handlers, render tree
- `CalendarGrid.jsx` — prop interface, task grouping memo
- `CalendarDayCell.jsx` — visible pills, overflow popover, both render paths
- `CalendarSidebar.jsx` — prop interface, overdue/undated pill rendering
- `TaskDetailDrawer.jsx` — full interface, field save handlers, state badge (display-only)
- `PlanBoard.jsx` — reference integration pattern (selectedTask, handleClick, handleUpdate, drawer render)
- `TodayView.jsx` — reference integration pattern
- `apiClient.js` — updateTask/deleteTask signatures
- `@dnd-kit/core` source — PointerSensor activation, click suppression after drag
- CLAUDE.md — project conventions

### Not Inspected
- `ProjectsView.jsx` — referenced as third integration but not read in full (low risk, same pattern)
- Touch device behaviour — inferred from sensor config, not tested

### Limited Visibility Warnings
- Touch UX findings are inference-based (sensor config + dnd-kit source), not empirically tested

## Executive Summary

The spec is sound for 90% of the work — wiring `TaskDetailDrawer` into `CalendarView` via prop threading and state management. Three Codex reviewers identified one **critical spec contradiction** (state editing claimed but not possible), two **missing details** (overflow popover cleanup, dual sidebar renders), and one **incomplete rollback spec**. All have been resolved in the updated spec.

## What Appears Solid

- **Core approach:** Reusing `TaskDetailDrawer` with the PlanBoard integration pattern is correct
- **Click-vs-drag:** PointerSensor `distance: 5` allows click events to fire — confirmed in dnd-kit source
- **Prop threading:** `onTaskClick` follows the exact same path as existing `onMoveTask`/`onCompleteTask`
- **Optimistic updates:** CalendarGrid's `tasksByDate` memo re-derives from `tasks` automatically — no manual rebucketing needed
- **API compatibility:** `apiClient.updateTask`/`deleteTask` signatures match exactly

## Critical Risks

None remaining after spec revision.

## Spec Defects (Fixed)

| ID | Finding | Resolution |
|----|---------|------------|
| ST-1 | Spec claimed "all task fields are editable" — false, `state` is display-only in drawer | Revised to list specific editable fields |
| ST-2 | Spec included "state changed to done" edge case — impossible without drawer changes | Removed; state changes handled by context menu |
| ST-3 | Spec said "identical pattern" — each view has different error handling | Revised to "same integration pattern with view-specific error handling" |

## Implementation Defects

None — no code written yet.

## Architecture & Integration

| ID | Finding | Severity | Status |
|----|---------|----------|--------|
| AI-1 | Overflow popover stays mounted if pill clicked without clearing `showOverflow` | Medium | Fixed in spec — CalendarDayCell must clear `showOverflow` on pill click |
| AI-2 | Two CalendarSidebar render sites (desktop + mobile) both need `onTaskClick` | Low | Fixed in spec — both call sites explicitly mentioned |
| AI-3 | `selectedTask` must be reverted on API failure alongside `tasks` array | Medium | Fixed in spec — explicit rollback requirement added |

## Workflow & Failure-Path

| ID | Finding | Severity | Blocking? |
|----|---------|----------|-----------|
| WF-1 | Due date change to different month makes task disappear from current view | Low | Advisory — documented in edge cases, expected behaviour |
| WF-2 | Project reassignment leaves `project_name` stale on pill until refetch | Low | Advisory — pre-existing issue across all views |
| WF-3 | Touch: 5px threshold makes tap-vs-drag fiddly | Low | Advisory — pre-existing DnD behaviour |

## Unproven Assumptions

| Assumption | What would confirm it |
|------------|----------------------|
| `onClick` on draggable div fires reliably for sub-5px movements | Manual test: click pills rapidly on desktop and mobile |
| Headless UI Dialog (drawer) doesn't conflict with overflow popover z-index | Manual test: open drawer from overflow popover pill |

## Recommended Fix Order

All spec fixes have been applied. Implementation should proceed as specified.

## Follow-Up Review Required

- Manual QA of click-vs-drag on both desktop and touch after implementation
- Manual QA of drawer opening from overflow popover pills
