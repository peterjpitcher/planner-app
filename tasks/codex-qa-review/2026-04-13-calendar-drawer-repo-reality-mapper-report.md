Repo reality map against [the spec](</Users/peterpitcher/Cursor/OJ-Planner2.0/docs/superpowers/specs/2026-04-13-calendar-task-drawer-design.md:1>).

**[Spec](</Users/peterpitcher/Cursor/OJ-Planner2.0/docs/superpowers/specs/2026-04-13-calendar-task-drawer-design.md:1>)**
- Current props/interface: Design doc says reuse `TaskDetailDrawer`, add task-pill click handling in calendar files, and make all task fields editable from calendar.
- Current click/interaction handlers: None; it is a doc.
- What would need to change per the spec: The code changes it lists are directionally right for calendar plumbing.
- Any constraints or gotchas discovered: The shared drawer does not currently edit `state` or `today_section`, so the spec’s `updates.state === 'done'` flow is not reachable via the existing drawer.
- Anything the spec assumes that isn’t true: “All task fields are editable” is false today; “identical pattern” is only true at the `selectedTask`/render-drawer level, not at the click/drag interaction level.

**[CalendarTaskPill.jsx](</Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/calendar/CalendarTaskPill.jsx:92>)**
- Current props/interface: `task`, `isDragOverlay = false`, `expanded = false`, `onMove`, `onComplete`.
- Current click/interaction handlers: Whole pill is the draggable surface via `useDraggable`; right-click opens a custom context menu; menu buttons call `onComplete?.(task.id)` and `onMove?.(task.id, state, section)`; no left-click handler.
- What would need to change per the spec: Add optional `onClick`, attach it to both rendered pill variants, and add the hover ring classes; keep it optional so drag overlay remains inert.
- Any constraints or gotchas discovered: Unlike the reference views, this component has no dedicated clickable child; the draggable shell itself would become clickable.
- Anything the spec assumes that isn’t true: The reference pattern is not literally the same here, because `TaskCard` opens the drawer from a button, not from the drag handle surface.

**[CalendarView.jsx](</Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/calendar/CalendarView.jsx:24>)**
- Current props/interface: Owns `currentMonth`, flat `tasks`, `isLoading`, `error`, `activeDragTask`; fetches all `today,this_week,backlog,waiting` tasks once and passes the same array into grid and sidebar.
- Current click/interaction handlers: Month nav; drag start/end/cancel; `handleMoveTask` for context-menu moves; `handleCompleteTask` for context-menu completion; no task-selection state.
- What would need to change per the spec: Import/render `TaskDetailDrawer`, add `selectedTask`, add `handleClick`, add drawer update/delete handlers, and pass `onTaskClick` into `CalendarGrid` and `CalendarSidebar`.
- Any constraints or gotchas discovered: Flat `tasks` state is sufficient for drawer rendering, but optimistic merges will leave derived display fields like `project_name` stale if `project_id` changes.
- Anything the spec assumes that isn’t true: “Due date changed in drawer moves task to new date cell” is only visibly true if the new date is in the currently rendered month grid; otherwise the task just disappears from the current view until month navigation.

**[CalendarGrid.jsx](</Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/calendar/CalendarGrid.jsx:18>)**
- Current props/interface: `currentMonth`, `tasks`, `onMoveTask`, `onCompleteTask`.
- Current click/interaction handlers: None locally; it groups tasks by `due_date`, sorts by `sort_order`, and renders `CalendarDayCell`.
- What would need to change per the spec: Accept `onTaskClick` and forward it to each `CalendarDayCell`.
- Any constraints or gotchas discovered: Only dated tasks enter the grid; undated tasks live entirely in the sidebar.
- Anything the spec assumes that isn’t true: Nothing material here.

**[CalendarDayCell.jsx](</Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/calendar/CalendarDayCell.jsx:10>)**
- Current props/interface: `date`, `dateKey`, `tasks`, `isCurrentMonth`, `isToday`, `onMoveTask`, `onCompleteTask`.
- Current click/interaction handlers: Cell is droppable; `+N more` toggles `showOverflow`; Escape closes overflow; drag start closes overflow; overflow backdrop closes overflow; pills only receive move/complete handlers.
- What would need to change per the spec: Accept `onTaskClick` and forward it to visible pills and overflow pills.
- Any constraints or gotchas discovered: Clicking a pill inside the overflow popover should also close `showOverflow`, otherwise the popover/backdrop stays mounted behind the drawer and reappears after close.
- Anything the spec assumes that isn’t true: Passing the prop through is not quite enough for overflow UX; there is extra local state to clear.

**[CalendarSidebar.jsx](</Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/calendar/CalendarSidebar.jsx:7>)**
- Current props/interface: `tasks`, `today`, `onMoveTask`, `onCompleteTask`; derives `overdueTasks` and `undatedTasks`.
- Current click/interaction handlers: None locally; each rendered `CalendarTaskPill` only has move/complete behavior from the child context menu.
- What would need to change per the spec: Accept `onTaskClick` and forward it to overdue and undated pills.
- Any constraints or gotchas discovered: Sidebar pills also show `project_name`, so project reassignment from the drawer has the same stale-label issue as the grid.
- Anything the spec assumes that isn’t true: Nothing major.

**[TaskDetailDrawer.jsx](</Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/shared/TaskDetailDrawer.jsx:105>)**
- Current props/interface: `task`, `isOpen`, `onClose`, `onUpdate`, `onDelete`, optional `projects`; internally fetches notes and, if needed, projects.
- Current click/interaction handlers: Name toggles inline edit; most fields save on blur or select change via `onUpdate(task.id, updates)`; due-date quick picks save immediately; delete requires confirm; notes are created through `api.notes.create`.
- What would need to change per the spec: None if calendar only reuses the drawer as-is.
- Any constraints or gotchas discovered: There is no UI for editing `state` or `today_section`; the effect keyed on `task` resets notes/draft state on every prop-object change but only refetches notes when the task id changes, so syncing `selectedTask` after edits can blank notes for the same task.
- Anything the spec assumes that isn’t true: “All task fields are editable” is false; state is display-only.

**[PlanBoard.jsx](</Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/plan/PlanBoard.jsx:210>)**
- Current props/interface: Holds `selectedTask`; `handleClick` finds a task across columns; `handleDrawerUpdate` delegates to `handleUpdate`; `handleDeleteTask` removes from columns and clears `selectedTask`; renders `TaskDetailDrawer`.
- Current click/interaction handlers: Passes `onClick={handleClick}` through `BoardColumn`; the actual open action comes from `TaskCard`, not the draggable card shell.
- What would need to change per the spec: Nothing here; it is a valid high-level reference pattern.
- Any constraints or gotchas discovered: `handleUpdate` only merges updates in place and reloads on failure; it does not special-case `state: 'done'`, and it inherits the drawer note-reset issue.
- Anything the spec assumes that isn’t true: The reference pattern does not prove that click-on-drag-handle pills is already solved elsewhere.

**[TodayView.jsx](</Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/today/TodayView.jsx:85>)**
- Current props/interface: Holds `selectedTask`; `handleTaskClick` searches active sections plus `completedToday`; `handleDrawerUpdate` delegates to `handleUpdate`; `handleDeleteTask` removes and clears selection; renders `TaskDetailDrawer`.
- Current click/interaction handlers: Passes `onClick` into `TodaySection` and completed `TaskCard`s; again, the click target is the `TaskCard` name button.
- What would need to change per the spec: Nothing here; it is another real reference for top-level wiring.
- Any constraints or gotchas discovered: `handleUpdate` only alerts on failure and does not revert; it also does not special-case state transitions from the drawer.
- Anything the spec assumes that isn’t true: The drawer integration exists, but not the spec’s “done from drawer removes/closes” behavior.

**[apiClient.js](</Users/peterpitcher/Cursor/OJ-Planner2.0/src/lib/apiClient.js:169>)**
- Current props/interface: `updateTask(taskId, updates)` strips deprecated fields and `PATCH`es `/api/tasks` with body `{ id: taskId, ...updates }`; `deleteTask(taskId)` `DELETE`s `/api/tasks/${taskId}`.
- Current click/interaction handlers: None.
- What would need to change per the spec: Nothing for signatures; the calendar can call these exactly as the spec suggests.
- Any constraints or gotchas discovered: The client returns API data, but current views mostly ignore the response and rely on optimistic local merges.
- Anything the spec assumes that isn’t true: Update and delete are not symmetric REST shapes in the client, but their call signatures do match the spec.

**[CLAUDE.md](</Users/peterpitcher/Cursor/OJ-Planner2.0/CLAUDE.md:1>)**
- Current props/interface: Project conventions say Next.js App Router, heavy client components, direct API calls, optimistic UI, no server actions, and no configured test suite.
- Current click/interaction handlers: None; it is a conventions doc.
- What would need to change per the spec: Nothing.
- Any constraints or gotchas discovered: Any calendar-drawer implementation will live in client state and will need manual QA because there is no test harness.
- Anything the spec assumes that isn’t true: Nothing explicit, but there is no automated safety net.

**CONSTRAINTS AND RISKS**
- The biggest spec mismatch is functional: the shared drawer cannot edit `state` or `today_section`, so “mark done from drawer and close/remove” is not implementable without changing [TaskDetailDrawer.jsx](</Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/shared/TaskDetailDrawer.jsx:384>).
- The shared drawer has a real same-task reset bug: its `[task]` effect clears notes and note draft on every prop-object change, but only refetches notes on task-id change. Because Plan/Today/Projects all sync `selectedTask` after edits, this already breaks notes there and would carry into calendar.
- Project reassignment is not fully optimistic-safe. `GET /api/tasks` flattens `project_name`/`project_area` into tasks in [route.js](</Users/peterpitcher/Cursor/OJ-Planner2.0/src/app/api/tasks/route.js:104>), but task updates in [taskService.js](</Users/peterpitcher/Cursor/OJ-Planner2.0/src/services/taskService.js:224>) return base task fields without joined project data, so updating `project_id` will leave the calendar pill/sidebar label stale unless you refetch or augment locally.
- Overflow popover clicks need extra handling in `CalendarDayCell`; forwarding `onTaskClick` alone leaves the popover/backdrop mounted.
- The reference integrations are only high-level precedents. The actual click target in those views is a `TaskCard` button, not the draggable container surface in [TaskCard.jsx](</Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/shared/TaskCard.jsx:209>).
- If a due date is changed to a different month, the task will not visibly “move to a new date cell” in the current calendar viewport.
- There is no configured test runner per [CLAUDE.md](</Users/peterpitcher/Cursor/OJ-Planner2.0/CLAUDE.md:1>), so drag-vs-click, overflow, drawer state sync, and sidebar/grid movement all need manual verification.