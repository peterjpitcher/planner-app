'use client';

import TaskItem from './TaskItem';

export default function TaskList({ tasks, notesByTask, onTaskUpdated, showCompletedTasks, onTaskDragStateChange }) {
  if (!tasks) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-[#0496c7]/20 bg-white/85 py-3 text-xs text-[#036586] shadow-inner shadow-[#0496c7]/10">
        Loading tasks…
      </div>
    );
  }

  const filteredTasks = showCompletedTasks ? tasks : tasks.filter(task => !task.is_completed);

  if (filteredTasks.length === 0) {
    if (tasks.length > 0 && !showCompletedTasks) { // All tasks are completed and hidden
      return (
        <div className="rounded-2xl border border-dashed border-[#0496c7]/25 bg-[#0496c7]/5 px-3 py-2 text-xs text-[#036586]/80">
          Everything is completed. Toggle “Show completed” to review.
        </div>
      );
    }
    return (
      <div className="rounded-2xl border border-dashed border-[#0496c7]/25 bg-[#0496c7]/5 px-3 py-2 text-xs text-[#036586]/80">
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
          onTaskDragStateChange={onTaskDragStateChange}
        />
      ))}
    </ul>
  );
}
