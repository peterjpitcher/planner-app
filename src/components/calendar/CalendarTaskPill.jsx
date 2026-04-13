'use client';

import { useDraggable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';

const STATE_BORDER_COLORS = {
  today: 'border-l-blue-500',
  this_week: 'border-l-indigo-500',
  backlog: 'border-l-gray-400',
  waiting: 'border-l-amber-500',
};

export default function CalendarTaskPill({ task, isDragOverlay = false }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });

  const borderColor = STATE_BORDER_COLORS[task.state] || 'border-l-gray-400';

  return (
    <div
      ref={!isDragOverlay ? setNodeRef : undefined}
      {...(!isDragOverlay ? attributes : {})}
      {...(!isDragOverlay ? listeners : {})}
      className={cn(
        'flex items-center gap-1 rounded border-l-[3px] bg-white px-1.5 py-1 text-xs shadow-sm cursor-grab active:cursor-grabbing',
        borderColor,
        isDragging && !isDragOverlay && 'opacity-30',
        isDragOverlay && 'shadow-lg ring-2 ring-indigo-300 rotate-2'
      )}
    >
      <span className="truncate font-medium text-gray-800 flex-1 min-w-0">
        {task.name || 'Untitled'}
      </span>
      {task.project_name && (
        <span className="truncate text-[10px] text-gray-400 max-w-[60px] shrink-0">
          {task.project_name}
        </span>
      )}
    </div>
  );
}
