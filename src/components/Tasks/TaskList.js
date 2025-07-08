'use client';

import TaskItem from './TaskItem';

export default function TaskList({ tasks, notesByTask, onTaskUpdated, showCompletedTasks }) {
  if (!tasks) {
    return <p className="text-xs text-gray-500 py-1 italic">Loading tasks...</p>; // Or handle null state differently
  }

  const filteredTasks = showCompletedTasks ? tasks : tasks.filter(task => !task.is_completed);

  if (filteredTasks.length === 0) {
    if (tasks.length > 0 && !showCompletedTasks) { // All tasks are completed and hidden
      return <p className="text-xs text-gray-500 py-1 italic">All tasks are complete. Show completed to view them.</p>;
    }
    return <p className="text-xs text-gray-500 py-1 italic">No tasks to display.</p>;
  }

  return (
    <ul className="space-y-1">
      {filteredTasks.map(task => (
        <TaskItem key={task.id} task={task} notes={notesByTask?.[task.id] || []} onTaskUpdated={onTaskUpdated} />
      ))}
    </ul>
  );
} 