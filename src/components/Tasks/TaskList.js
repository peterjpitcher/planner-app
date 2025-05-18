'use client';

import TaskItem from './TaskItem';

export default function TaskList({ tasks, onTaskUpdated }) {
  if (!tasks || tasks.length === 0) {
    return <p className="text-xs text-gray-500 py-1 italic">No tasks to display.</p>;
  }

  return (
    <ul className="space-y-1">
      {tasks.map(task => (
        <TaskItem key={task.id} task={task} onTaskUpdated={onTaskUpdated} />
      ))}
    </ul>
  );
} 