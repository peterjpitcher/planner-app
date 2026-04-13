'use client';

import { useMemo, useRef, useCallback, useEffect } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { addMonths, format, isSameMonth } from 'date-fns';
import { cn } from '@/lib/utils';

function MonthLabel({ month, isActive, onClick, onDragHover }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `month-${format(month, 'yyyy-MM')}`,
  });
  const timerRef = useRef(null);

  useEffect(() => {
    if (isOver) {
      timerRef.current = setTimeout(() => {
        onDragHover?.(month);
      }, 400);
    } else {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isOver, month, onDragHover]);

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => onClick(month)}
      className={cn(
        'shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap',
        isActive
          ? 'bg-indigo-600 text-white'
          : 'text-gray-600 hover:bg-gray-100',
        isOver && !isActive && 'bg-indigo-100 text-indigo-700'
      )}
    >
      {format(month, 'MMM yyyy')}
    </button>
  );
}

export default function MonthStrip({ currentMonth, onNavigate, onDragHover }) {
  const months = useMemo(() => {
    const result = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      result.push(addMonths(now, i));
    }
    return result;
  }, []);

  return (
    <div className="flex items-center gap-1 overflow-x-auto px-2 py-2 border-b border-gray-200 scrollbar-thin">
      {months.map((month) => (
        <MonthLabel
          key={format(month, 'yyyy-MM')}
          month={month}
          isActive={isSameMonth(month, currentMonth)}
          onClick={onNavigate}
          onDragHover={onDragHover || onNavigate}
        />
      ))}
    </div>
  );
}
