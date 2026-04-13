'use client';

import { useRef, useEffect } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { addMonths, isBefore, isAfter, startOfMonth } from 'date-fns';
import { cn } from '@/lib/utils';

function EdgeZone({ direction, currentMonth, minMonth, maxMonth, onNavigate }) {
  const id = direction === 'prev' ? 'edge-prev' : 'edge-next';
  const { setNodeRef, isOver } = useDroppable({ id });
  const timerRef = useRef(null);

  const canNavigate = direction === 'prev'
    ? isAfter(startOfMonth(currentMonth), startOfMonth(minMonth))
    : isBefore(startOfMonth(currentMonth), startOfMonth(maxMonth));

  useEffect(() => {
    if (isOver && canNavigate) {
      timerRef.current = setTimeout(() => {
        const target = addMonths(currentMonth, direction === 'prev' ? -1 : 1);
        onNavigate(target);
      }, 500);
    } else {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isOver, canNavigate, currentMonth, direction, onNavigate]);

  const Icon = direction === 'prev' ? ChevronLeftIcon : ChevronRightIcon;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'absolute top-0 bottom-0 w-10 z-30 flex items-center justify-center transition-opacity',
        direction === 'prev' ? 'left-0' : 'right-0',
        isOver && canNavigate ? 'opacity-100 bg-indigo-50/80' : 'opacity-0'
      )}
    >
      <Icon className="h-6 w-6 text-indigo-500" />
    </div>
  );
}

export default function EdgeNavigator({ currentMonth, minMonth, maxMonth, onNavigate }) {
  return (
    <>
      <EdgeZone
        direction="prev"
        currentMonth={currentMonth}
        minMonth={minMonth}
        maxMonth={maxMonth}
        onNavigate={onNavigate}
      />
      <EdgeZone
        direction="next"
        currentMonth={currentMonth}
        minMonth={minMonth}
        maxMonth={maxMonth}
        onNavigate={onNavigate}
      />
    </>
  );
}
