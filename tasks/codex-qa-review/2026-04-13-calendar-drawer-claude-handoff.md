# Claude Hand-Off Brief: Calendar Task Detail Drawer

**Generated:** 2026-04-13
**Review mode:** Spec Compliance (Mode C)
**Overall risk assessment:** Low

## DO NOT REWRITE

- `TaskDetailDrawer.jsx` — no changes needed, works as-is
- `CalendarGrid.jsx` task grouping logic — `tasksByDate` memo already handles re-bucketing
- `CalendarView.jsx` existing handlers — `handleMoveTask`, `handleCompleteTask`, `handleDragEnd` are correct and unrelated
- `CalendarTaskPill.jsx` context menu — `onContextMenu` handler stays unchanged
- API client — `apiClient.updateTask`/`deleteTask` signatures are correct

## SPEC REVISION REQUIRED

All revisions have been applied to `docs/superpowers/specs/2026-04-13-calendar-task-drawer-design.md`:

- [x] Removed "all task fields are editable" — replaced with specific field list
- [x] Removed "state changed to done" edge case — drawer cannot edit state
- [x] Changed "identical pattern" to "same integration pattern with view-specific error handling"
- [x] Added overflow popover cleanup requirement to CalendarDayCell section
- [x] Added explicit mention of both CalendarSidebar render sites
- [x] Added selectedTask rollback requirement to handleDrawerUpdate
- [x] Added advisory edge cases for project_name staleness and touch UX

## IMPLEMENTATION CHANGES REQUIRED

- [ ] `CalendarTaskPill.jsx`: Add `onClick` prop, attach to both pill variants, add hover ring classes
- [ ] `CalendarView.jsx`: Import drawer, add selectedTask state, add handleClick/handleDrawerUpdate/handleDeleteTask, pass onTaskClick to grid + both sidebars, render TaskDetailDrawer
- [ ] `CalendarGrid.jsx`: Accept and forward `onTaskClick` prop to CalendarDayCell
- [ ] `CalendarDayCell.jsx`: Accept `onTaskClick`, forward to visible + overflow pills, clear `showOverflow` when overflow pill clicked
- [ ] `CalendarSidebar.jsx`: Accept `onTaskClick`, forward to all pill renders

## ASSUMPTIONS TO RESOLVE

- [ ] Click on draggable div fires for sub-5px movements → Verify with manual QA after implementation
- [ ] Headless UI Dialog z-index doesn't conflict with overflow popover → Verify with manual QA

## REPO CONVENTIONS TO PRESERVE

- Optimistic UI updates with revert on failure (existing pattern in all views)
- `useCallback` wrapping for all handlers (existing pattern)
- Props named `onTaskClick` (matches `onMoveTask`/`onCompleteTask` naming convention)
- No TypeScript — all files are `.jsx`/`.js`

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] Manual QA: click-vs-drag on desktop
- [ ] Manual QA: click-vs-drag on touch device
- [ ] Manual QA: open drawer from overflow popover pill
- [ ] Manual QA: edit due date in drawer, verify task moves to correct cell

## REVISION PROMPT

Already applied — spec is updated and ready for implementation planning.
