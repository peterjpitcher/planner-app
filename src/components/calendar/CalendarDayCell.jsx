'use client';

import { useState, useEffect, useCallback } from 'react';
import { useDroppable, useDndMonitor } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import CalendarTaskPill from './CalendarTaskPill';

const MAX_VISIBLE = 2;

export default function CalendarDayCell({ date, dateKey, tasks, isCurrentMonth, isToday, onMoveTask, onCompleteTask, onTaskClick }) {
  const [showOverflow, setShowOverflow] = useState(false);
  const { setNodeRef, isOver } = useDroppable({ id: `day-${dateKey}` });

  // Close popover when a drag starts
  useDndMonitor({ onDragStart: useCallback(() => setShowOverflow(false), []) });

  // Close popover on Escape key
  useEffect(() => {
    if (!showOverflow) return;
    const handleKey = (e) => { if (e.key === 'Escape') setShowOverflow(false); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [showOverflow]);

  const dayNumber = date.getDate();
  const visibleTasks = tasks.slice(0, MAX_VISIBLE);
  const overflowCount = tasks.length - MAX_VISIBLE;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'relative flex flex-col gap-0.5 border border-gray-100 p-1.5 min-h-[110px] lg:min-h-[130px] transition-colors',
        !isCurrentMonth && 'bg-gray-50/50',
        isOver && 'bg-indigo-50 ring-1 ring-indigo-300',
        isToday && 'ring-2 ring-blue-400'
      )}
    >
      {/* Day number */}
      <span
        className={cn(
          'text-xs font-medium self-end w-6 h-6 flex items-center justify-center rounded-full',
          isToday && 'bg-blue-500 text-white',
          !isToday && isCurrentMonth && 'text-gray-700',
          !isToday && !isCurrentMonth && 'text-gray-400'
        )}
      >
        {dayNumber}
      </span>

      {/* Task pills */}
      <div className="flex flex-col gap-1 flex-1 overflow-hidden">
        {visibleTasks.map((task) => (
          <CalendarTaskPill key={task.id} task={task} expanded onMove={onMoveTask} onComplete={onCompleteTask} onClick={onTaskClick} />
        ))}
      </div>

      {/* Overflow button */}
      {overflowCount > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowOverflow(!showOverflow)}
            className="text-[10px] font-medium text-indigo-600 hover:text-indigo-800 px-1"
          >
            +{overflowCount} more
          </button>

          {/* Overflow popover */}
          {showOverflow && (
            <>
              {/* Backdrop to close popover */}
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowOverflow(false)}
              />
              <div className="absolute left-0 top-full z-50 mt-1 w-64 max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2.5 shadow-lg">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  All tasks ({tasks.length})
                </p>
                <div className="flex flex-col gap-1.5">
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
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
