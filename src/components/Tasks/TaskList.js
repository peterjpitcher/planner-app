'use client';

import TaskItem from './TaskItem';

export default function TaskList({ tasks, notesByTask, onTaskUpdated, onTaskNoteAdded, showCompletedTasks, onTaskDragStateChange }) {
  if (!tasks) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-border bg-card py-3 text-xs text-muted-foreground shadow-sm">
        Loading tasks…
      </div>
    );
  }

  const filteredTasks = showCompletedTasks ? tasks : tasks.filter(task => !task.is_completed);

  if (filteredTasks.length === 0) {
    if (tasks.length > 0 && !showCompletedTasks) { // All tasks are completed and hidden
      return (
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Everything is completed. Toggle “Show completed” to review.
        </div>
      );
    }
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        No tasks to display.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {filteredTasks.map(task => (
        <TaskItem
          key={task.id}
          task={task}
          notes={notesByTask?.[task.id] || []}
          onTaskUpdated={onTaskUpdated}
          onTaskNoteAdded={onTaskNoteAdded}
          onTaskDragStateChange={onTaskDragStateChange}
        />
      ))}
    </ul>
  );
}
