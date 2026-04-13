'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import { STATE, TODAY_SECTION } from '@/lib/constants';

const STATE_BORDER_COLORS = {
  today: 'border-l-blue-500',
  this_week: 'border-l-indigo-500',
  backlog: 'border-l-gray-400',
  waiting: 'border-l-amber-500',
};

const MOVE_TARGETS = [
  { label: 'Today — Must Do', state: STATE.TODAY, section: TODAY_SECTION.MUST_DO },
  { label: 'Today — Good to Do', state: STATE.TODAY, section: TODAY_SECTION.GOOD_TO_DO },
  { label: 'Today — Quick Wins', state: STATE.TODAY, section: TODAY_SECTION.QUICK_WINS },
  { label: 'This Week', state: STATE.THIS_WEEK },
  { label: 'Backlog', state: STATE.BACKLOG },
  { label: 'Waiting', state: STATE.WAITING },
];

function ContextMenu({ x, y, task, onClose, onMove, onComplete }) {
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    const handleEscape = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Adjust position to keep menu on screen
  const style = {
    position: 'fixed',
    left: x,
    top: y,
    zIndex: 9999,
  };

  const isCompleted = task.state === STATE.DONE || task.state === 'done';

  return (
    <div ref={menuRef} style={style} onMouseDown={(e) => e.stopPropagation()} className="w-52 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
      {/* Complete */}
      <button
        type="button"
        onClick={() => { onComplete?.(task.id); onClose(); }}
        className="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
      >
        {isCompleted ? 'Un-complete' : 'Mark complete'}
      </button>

      <div className="my-1 border-t border-gray-100" />

      {/* Move to */}
      <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
        Move to
      </p>
      {MOVE_TARGETS.map((target) => {
        const isCurrent = task.state === target.state &&
          (!target.section || task.today_section === target.section);
        return (
          <button
            key={`${target.state}-${target.section ?? ''}`}
            type="button"
            disabled={isCurrent}
            onClick={() => { onMove?.(task.id, target.state, target.section); onClose(); }}
            className={cn(
              'w-full px-3 py-1.5 text-left text-sm',
              isCurrent
                ? 'text-gray-300 cursor-default'
                : 'text-gray-700 hover:bg-gray-50'
            )}
          >
            {target.label}
            {isCurrent && ' ✓'}
          </button>
        );
      })}
    </div>
  );
}

export default function CalendarTaskPill({ task, isDragOverlay = false, expanded = false, onMove, onComplete, onClick }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });

  const [contextMenu, setContextMenu] = useState(null);

  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const borderColor = STATE_BORDER_COLORS[task.state] || 'border-l-gray-400';

  const pill = expanded ? (
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
      <span className="font-medium text-gray-800 leading-tight line-clamp-2">
        {task.name || 'Untitled'}
      </span>
      {task.project_name && (
        <span className="text-[10px] text-gray-400 truncate mt-0.5">
          {task.project_name}
        </span>
      )}
    </div>
  ) : (
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
      <span className="truncate font-medium text-gray-800 flex-1 min-w-0">
        {task.name || 'Untitled'}
      </span>
      {task.project_name && (
        <span className="truncate text-[10px] text-gray-400 max-w-[80px] shrink-0 hidden xl:inline">
          {task.project_name}
        </span>
      )}
    </div>
  );

  return (
    <>
      {pill}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          task={task}
          onClose={closeContextMenu}
          onMove={onMove}
          onComplete={onComplete}
        />
      )}
    </>
  );
}
