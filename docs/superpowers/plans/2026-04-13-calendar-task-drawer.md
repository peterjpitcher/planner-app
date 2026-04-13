# Calendar Task Detail Drawer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing `TaskDetailDrawer` into the calendar view so clicking a task pill opens a slide-in drawer for editing task details.

**Architecture:** Add an `onClick` prop to `CalendarTaskPill`, thread it through `CalendarGrid` → `CalendarDayCell` and `CalendarSidebar`, add drawer state management to `CalendarView`, and render the shared `TaskDetailDrawer` component. Follows the same integration pattern as `PlanBoard.jsx`.

**Tech Stack:** React 19, Headless UI Dialog, @dnd-kit/core, Next.js App Router

---

### Task 1: Add `onClick` prop to CalendarTaskPill

**Files:**
- Modify: `src/components/calendar/CalendarTaskPill.jsx:92` (component signature)
- Modify: `src/components/calendar/CalendarTaskPill.jsx:110-155` (both pill variants)

- [ ] **Step 1: Add `onClick` to the component signature**

In `src/components/calendar/CalendarTaskPill.jsx`, change line 92 from:

```jsx
export default function CalendarTaskPill({ task, isDragOverlay = false, expanded = false, onMove, onComplete }) {
```

to:

```jsx
export default function CalendarTaskPill({ task, isDragOverlay = false, expanded = false, onMove, onComplete, onClick }) {
```

- [ ] **Step 2: Add click handler to the expanded pill variant**

In the expanded pill `<div>` (line ~110), add `onClick` and hover ring classes. Change:

```jsx
    <div
      ref={!isDragOverlay ? setNodeRef : undefined}
      {...(!isDragOverlay ? attributes : {})}
      {...(!isDragOverlay ? listeners : {})}
      onContextMenu={!isDragOverlay ? handleContextMenu : undefined}
      className={cn(
        'flex flex-col rounded border-l-[3px] bg-white px-2 py-1.5 text-xs shadow-sm cursor-grab active:cursor-grabbing',
        borderColor,
        isDragging && !isDragOverlay && 'opacity-30',
        isDragOverlay && 'shadow-lg ring-2 ring-indigo-300 rotate-2'
      )}
    >
```

to:

```jsx
    <div
      ref={!isDragOverlay ? setNodeRef : undefined}
      {...(!isDragOverlay ? attributes : {})}
      {...(!isDragOverlay ? listeners : {})}
      onContextMenu={!isDragOverlay ? handleContextMenu : undefined}
      onClick={!isDragOverlay && onClick ? () => onClick(task.id) : undefined}
      className={cn(
        'flex flex-col rounded border-l-[3px] bg-white px-2 py-1.5 text-xs shadow-sm cursor-grab active:cursor-grabbing',
        borderColor,
        isDragging && !isDragOverlay && 'opacity-30',
        isDragOverlay && 'shadow-lg ring-2 ring-indigo-300 rotate-2',
        !isDragOverlay && onClick && 'hover:ring-1 hover:ring-indigo-200'
      )}
    >
```

- [ ] **Step 3: Add click handler to the compact pill variant**

In the compact pill `<div>` (line ~133), apply the same changes. Change:

```jsx
    <div
      ref={!isDragOverlay ? setNodeRef : undefined}
      {...(!isDragOverlay ? attributes : {})}
      {...(!isDragOverlay ? listeners : {})}
      onContextMenu={!isDragOverlay ? handleContextMenu : undefined}
      title={`${task.name}${task.project_name ? ` — ${task.project_name}` : ''}`}
      className={cn(
        'flex items-center gap-1.5 rounded border-l-[3px] bg-white px-1.5 py-1 text-xs shadow-sm cursor-grab active:cursor-grabbing',
        borderColor,
        isDragging && !isDragOverlay && 'opacity-30',
        isDragOverlay && 'shadow-lg ring-2 ring-indigo-300 rotate-2'
      )}
    >
```

to:

```jsx
    <div
      ref={!isDragOverlay ? setNodeRef : undefined}
      {...(!isDragOverlay ? attributes : {})}
      {...(!isDragOverlay ? listeners : {})}
      onContextMenu={!isDragOverlay ? handleContextMenu : undefined}
      onClick={!isDragOverlay && onClick ? () => onClick(task.id) : undefined}
      title={`${task.name}${task.project_name ? ` — ${task.project_name}` : ''}`}
      className={cn(
        'flex items-center gap-1.5 rounded border-l-[3px] bg-white px-1.5 py-1 text-xs shadow-sm cursor-grab active:cursor-grabbing',
        borderColor,
        isDragging && !isDragOverlay && 'opacity-30',
        isDragOverlay && 'shadow-lg ring-2 ring-indigo-300 rotate-2',
        !isDragOverlay && onClick && 'hover:ring-1 hover:ring-indigo-200'
      )}
    >
```

- [ ] **Step 4: Verify the dev server shows no errors**

Run: `npm run dev`

Open the calendar page at `http://localhost:3000/calendar`. Verify pills render without errors. Hover over a pill — you should NOT see the ring yet because no `onClick` is being passed from parent components.

- [ ] **Step 5: Commit**

```bash
git add src/components/calendar/CalendarTaskPill.jsx
git commit -m "feat(calendar): add onClick prop to CalendarTaskPill with hover affordance"
```

---

### Task 2: Thread `onTaskClick` through CalendarGrid and CalendarDayCell

**Files:**
- Modify: `src/components/calendar/CalendarGrid.jsx:18` (signature) and `:70` (child render)
- Modify: `src/components/calendar/CalendarDayCell.jsx:10` (signature), `:54` (visible pills), `:83` (overflow pills)

- [ ] **Step 1: Add `onTaskClick` prop to CalendarGrid and forward it**

In `src/components/calendar/CalendarGrid.jsx`, change line 18 from:

```jsx
export default function CalendarGrid({ currentMonth, tasks, onMoveTask, onCompleteTask }) {
```

to:

```jsx
export default function CalendarGrid({ currentMonth, tasks, onMoveTask, onCompleteTask, onTaskClick }) {
```

Then add `onTaskClick` to the `CalendarDayCell` render at line ~70. Change:

```jsx
            <CalendarDayCell
              key={dateKey}
              date={day}
              dateKey={dateKey}
              tasks={tasksByDate[dateKey] || []}
              isCurrentMonth={isSameMonth(day, currentMonth)}
              isToday={isToday(day)}
              onMoveTask={onMoveTask}
              onCompleteTask={onCompleteTask}
            />
```

to:

```jsx
            <CalendarDayCell
              key={dateKey}
              date={day}
              dateKey={dateKey}
              tasks={tasksByDate[dateKey] || []}
              isCurrentMonth={isSameMonth(day, currentMonth)}
              isToday={isToday(day)}
              onMoveTask={onMoveTask}
              onCompleteTask={onCompleteTask}
              onTaskClick={onTaskClick}
            />
```

- [ ] **Step 2: Add `onTaskClick` prop to CalendarDayCell and forward to visible pills**

In `src/components/calendar/CalendarDayCell.jsx`, change line 10 from:

```jsx
export default function CalendarDayCell({ date, dateKey, tasks, isCurrentMonth, isToday, onMoveTask, onCompleteTask }) {
```

to:

```jsx
export default function CalendarDayCell({ date, dateKey, tasks, isCurrentMonth, isToday, onMoveTask, onCompleteTask, onTaskClick }) {
```

Then update the visible pills render at line ~53-55. Change:

```jsx
        {visibleTasks.map((task) => (
          <CalendarTaskPill key={task.id} task={task} expanded onMove={onMoveTask} onComplete={onCompleteTask} />
        ))}
```

to:

```jsx
        {visibleTasks.map((task) => (
          <CalendarTaskPill key={task.id} task={task} expanded onMove={onMoveTask} onComplete={onCompleteTask} onClick={onTaskClick} />
        ))}
```

- [ ] **Step 3: Forward `onTaskClick` to overflow pills with popover cleanup**

Update the overflow popover pills render at line ~82-84. Change:

```jsx
                {tasks.map((task) => (
                    <CalendarTaskPill key={task.id} task={task} expanded onMove={onMoveTask} onComplete={onCompleteTask} />
                  ))}
```

to:

```jsx
                  {tasks.map((task) => (
                    <CalendarTaskPill
                      key={task.id}
                      task={task}
                      expanded
                      onMove={onMoveTask}
                      onComplete={onCompleteTask}
                      onClick={onTaskClick ? (taskId) => { setShowOverflow(false); onTaskClick(taskId); } : undefined}
                    />
                  ))}
```

This wraps `onTaskClick` so that clicking a pill inside the overflow popover first closes the popover (clearing `showOverflow`), then opens the drawer. This prevents the popover backdrop from remaining mounted behind the drawer.

- [ ] **Step 4: Verify no errors on dev server**

Run: `npm run dev`

Open `http://localhost:3000/calendar`. Verify day cells render correctly. No click behaviour yet (parent still doesn't pass `onTaskClick`).

- [ ] **Step 5: Commit**

```bash
git add src/components/calendar/CalendarGrid.jsx src/components/calendar/CalendarDayCell.jsx
git commit -m "feat(calendar): thread onTaskClick through CalendarGrid and CalendarDayCell"
```

---

### Task 3: Thread `onTaskClick` through CalendarSidebar

**Files:**
- Modify: `src/components/calendar/CalendarSidebar.jsx:7` (signature), `:57` (overdue pills), `:75` (undated pills)

- [ ] **Step 1: Add `onTaskClick` prop and forward to all pill renders**

In `src/components/calendar/CalendarSidebar.jsx`, change line 7 from:

```jsx
export default function CalendarSidebar({ tasks, today, onMoveTask, onCompleteTask }) {
```

to:

```jsx
export default function CalendarSidebar({ tasks, today, onMoveTask, onCompleteTask, onTaskClick }) {
```

Then update the overdue pills at line ~57. Change:

```jsx
                <CalendarTaskPill task={task} expanded onMove={onMoveTask} onComplete={onCompleteTask} />
```

to:

```jsx
                <CalendarTaskPill task={task} expanded onMove={onMoveTask} onComplete={onCompleteTask} onClick={onTaskClick} />
```

Then update the undated pills at line ~75. Change:

```jsx
              <CalendarTaskPill key={task.id} task={task} expanded onMove={onMoveTask} onComplete={onCompleteTask} />
```

to:

```jsx
              <CalendarTaskPill key={task.id} task={task} expanded onMove={onMoveTask} onComplete={onCompleteTask} onClick={onTaskClick} />
```

- [ ] **Step 2: Commit**

```bash
git add src/components/calendar/CalendarSidebar.jsx
git commit -m "feat(calendar): thread onTaskClick through CalendarSidebar pills"
```

---

### Task 4: Wire TaskDetailDrawer into CalendarView

**Files:**
- Modify: `src/components/calendar/CalendarView.jsx` (import, state, handlers, render)

This is the main integration task. Follow the pattern from `PlanBoard.jsx:210,386-432,686-693`.

- [ ] **Step 1: Add import for TaskDetailDrawer**

In `src/components/calendar/CalendarView.jsx`, add after the existing imports (after line ~21):

```jsx
import TaskDetailDrawer from '@/components/shared/TaskDetailDrawer';
```

- [ ] **Step 2: Add `selectedTask` state**

After the `activeDragTask` state declaration (line ~34), add:

```jsx
  const [selectedTask, setSelectedTask] = useState(null);
```

- [ ] **Step 3: Add `handleClick` callback**

After the `handleDragCancel` callback (line ~119), add:

```jsx
  // Task click: open detail drawer
  const handleClick = useCallback((taskId) => {
    const found = tasks.find((t) => t.id === taskId);
    if (found) setSelectedTask(found);
  }, [tasks]);
```

- [ ] **Step 4: Add `handleDrawerUpdate` callback**

After `handleClick`, add:

```jsx
  // Drawer: update task field(s)
  const handleDrawerUpdate = useCallback(async (taskId, updates) => {
    const previousTasks = tasks;
    // Optimistic update
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, ...updates } : t))
    );
    setSelectedTask((prev) =>
      prev && prev.id === taskId ? { ...prev, ...updates } : prev
    );

    try {
      await apiClient.updateTask(taskId, updates);
    } catch (err) {
      console.error('Failed to update task:', err);
      setTasks(previousTasks);
      setSelectedTask((prev) =>
        prev && prev.id === taskId
          ? previousTasks.find((t) => t.id === taskId) ?? prev
          : prev
      );
    }
  }, [tasks]);
```

- [ ] **Step 5: Add `handleDeleteTask` callback**

After `handleDrawerUpdate`, add:

```jsx
  // Drawer: delete task
  const handleDeleteTask = useCallback(async (taskId) => {
    const previousTasks = tasks;
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setSelectedTask(null);

    try {
      await apiClient.deleteTask(taskId);
    } catch (err) {
      console.error('Failed to delete task:', err);
      setTasks(previousTasks);
    }
  }, [tasks]);
```

- [ ] **Step 6: Pass `onTaskClick` to CalendarGrid**

In the CalendarGrid render (line ~253), add `onTaskClick`. Change:

```jsx
            <CalendarGrid currentMonth={currentMonth} tasks={tasks} onMoveTask={handleMoveTask} onCompleteTask={handleCompleteTask} />
```

to:

```jsx
            <CalendarGrid currentMonth={currentMonth} tasks={tasks} onMoveTask={handleMoveTask} onCompleteTask={handleCompleteTask} onTaskClick={handleClick} />
```

- [ ] **Step 7: Pass `onTaskClick` to both CalendarSidebar renders**

Update the desktop sidebar (line ~258). Change:

```jsx
            <CalendarSidebar tasks={tasks} today={todayStr} onMoveTask={handleMoveTask} onCompleteTask={handleCompleteTask} />
```

to:

```jsx
            <CalendarSidebar tasks={tasks} today={todayStr} onMoveTask={handleMoveTask} onCompleteTask={handleCompleteTask} onTaskClick={handleClick} />
```

Update the mobile sidebar (line ~264). Change:

```jsx
          <CalendarSidebar tasks={tasks} today={todayStr} onMoveTask={handleMoveTask} onCompleteTask={handleCompleteTask} />
```

to:

```jsx
          <CalendarSidebar tasks={tasks} today={todayStr} onMoveTask={handleMoveTask} onCompleteTask={handleCompleteTask} onTaskClick={handleClick} />
```

- [ ] **Step 8: Render TaskDetailDrawer**

After the `DragOverlay` closing tag (line ~273, before `</DndContext>`), add:

```jsx
      {/* Task detail drawer */}
      <TaskDetailDrawer
        task={selectedTask}
        isOpen={!!selectedTask}
        onClose={() => setSelectedTask(null)}
        onUpdate={handleDrawerUpdate}
        onDelete={handleDeleteTask}
      />
```

- [ ] **Step 9: Verify full integration on dev server**

Run: `npm run dev`

Open `http://localhost:3000/calendar`. Test the following:

1. **Click a pill in a day cell** — drawer should slide in from the right with task details
2. **Edit the task name** — click the name, type a new name, blur. Pill should update.
3. **Change due date** — use quick-pick or date input. Task should move to new date cell.
4. **Close drawer** — click X or click backdrop. Drawer should close.
5. **Right-click a pill** — context menu should still open (not the drawer).
6. **Drag a pill** — should drag normally, no drawer opens.
7. **Click a pill in the overflow popover** — popover should close, drawer should open.
8. **Click a pill in the sidebar** — drawer should open for overdue/undated tasks.
9. **Delete a task from drawer** — task should disappear from calendar.

- [ ] **Step 10: Run lint**

Run: `npm run lint`

Fix any lint errors before committing.

- [ ] **Step 11: Commit**

```bash
git add src/components/calendar/CalendarView.jsx
git commit -m "feat(calendar): wire TaskDetailDrawer for click-to-edit task details"
```

---

### Task 5: Final verification

- [ ] **Step 1: Run the full verification pipeline**

```bash
npm run lint && npm run build
```

Both must pass with zero errors.

- [ ] **Step 2: Manual QA checklist**

Verify each edge case from the spec:

| Test | Expected |
|------|----------|
| Click pill in day cell | Drawer opens |
| Edit due date to different day (same month) | Task moves to new cell |
| Edit due date to different month | Task disappears from current view (expected) |
| Delete task from drawer | Task removed, drawer closes |
| Click pill in overflow popover (+N more) | Popover closes, drawer opens |
| Drag pill to different day | Drag works, no drawer |
| Right-click pill | Context menu opens, no drawer |
| Click sidebar pill (overdue) | Drawer opens |
| Click sidebar pill (undated) | Drawer opens |
| Close drawer with X | Drawer closes |
| Close drawer with backdrop click | Drawer closes |
| Close drawer with Escape | Drawer closes |
