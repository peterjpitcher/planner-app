# Calendar Task Detail Drawer — Design Spec

**Date:** 2026-04-13
**Status:** Approved

## Summary

Add click-to-edit functionality to calendar task pills by wiring the existing `TaskDetailDrawer` shared component into `CalendarView`. Single click on any task pill opens the drawer; drawer-supported fields (name, description, area, type, chips, due date, waiting fields, project, notes) are editable. Follows the same integration pattern used by PlanBoard, TodayView, and ProjectsView (with view-specific error handling).

## Motivation

The calendar page is the only view that lacks a way to view or edit task details inline. Users must navigate to another view (Plan, Today) to edit a task they see on the calendar. Adding the drawer here completes the editing experience across all views.

## Approach

Reuse the existing `TaskDetailDrawer` component and follow the established integration pattern from `PlanBoard.jsx`.

## Changes by File

### 1. `src/components/calendar/CalendarTaskPill.jsx`

- Add `onClick` prop to the component signature
- Attach an `onClick` handler to both the expanded and compact pill `<div>` elements
- The handler calls `onClick(task.id)`
- Add `hover:ring-1 hover:ring-indigo-200` to both pill variants for click affordance
- Click-vs-drag: `PointerSensor` has `distance: 5` activation — clicks under 5px movement fire `onClick`, not drag. No additional logic needed.

### 2. `src/components/calendar/CalendarView.jsx`

- Import `TaskDetailDrawer` from `@/components/shared/TaskDetailDrawer`
- Add state: `const [selectedTask, setSelectedTask] = useState(null)`
- Add `handleClick(taskId)`: find task in `tasks` array, call `setSelectedTask(found)`
- Add `handleDrawerUpdate(taskId, updates)`:
  - Optimistic update to `tasks` array (map over, merge updates)
  - Keep `selectedTask` in sync with the same merged updates
  - Call `apiClient.updateTask(taskId, updates)`
  - On failure: revert both `tasks` array and `selectedTask` to pre-update snapshot (follow PlanBoard's refetch-on-failure pattern as fallback)
  - Note: state changes (e.g. marking done) are not possible from the drawer — state is display-only in `TaskDetailDrawer`. State transitions are handled via the context menu.
- Add `handleDeleteTask(taskId)`:
  - Optimistic remove from `tasks`
  - Close drawer (`setSelectedTask(null)`)
  - Call `apiClient.deleteTask(taskId)`
  - On failure: revert `tasks` array to pre-delete snapshot
- Pass `onTaskClick={handleClick}` to `CalendarGrid` and both `CalendarSidebar` render sites (desktop at line ~258 and mobile at line ~264)
- Render `<TaskDetailDrawer>` with props:
  - `task={selectedTask}`
  - `isOpen={!!selectedTask}`
  - `onClose={() => setSelectedTask(null)}`
  - `onUpdate={handleDrawerUpdate}`
  - `onDelete={handleDeleteTask}`

### 3. `src/components/calendar/CalendarGrid.jsx`

- Accept `onTaskClick` prop
- Forward to `CalendarDayCell`

### 4. `src/components/calendar/CalendarDayCell.jsx`

- Accept `onTaskClick` prop
- Forward to each `CalendarTaskPill` as `onClick={onTaskClick}` (both visible pills at ~line 54 and overflow popover pills at ~line 83)
- When a pill inside the overflow popover is clicked: clear `showOverflow` state before opening drawer, so the popover/backdrop doesn't remain mounted behind the drawer

### 5. `src/components/calendar/CalendarSidebar.jsx`

- Accept `onTaskClick` prop
- Forward to each `CalendarTaskPill` as `onClick={onTaskClick}`

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| Due date changed in drawer | Optimistic update moves task to new date cell (if new date is in current month; otherwise task disappears from current view until month navigation) |
| Task deleted | Task removed from calendar, drawer closes |
| Click in overflow popover | Clears popover, then opens drawer |
| Click during drag (> 5px) | Drag fires, not click — handled by DnD sensor |
| Right-click | Context menu opens as before — no conflict with `onClick` |
| Project reassignment in drawer | `project_name` display on pill may be stale until next full fetch (pre-existing limitation, not addressed here) |
| Touch devices | 5px drag threshold is tighter on touch — tap-vs-drag may feel fiddly (pre-existing DnD behaviour, not addressed here) |

## Out of Scope

- No changes to the drawer component itself
- No new components
- No layout-level drawer provider / context
- No changes to API routes or database schema
