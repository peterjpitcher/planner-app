'use client';

import { useMemo } from 'react';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isToday,
} from 'date-fns';
import CalendarDayCell from './CalendarDayCell';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function CalendarGrid({ currentMonth, tasks, onMoveTask, onCompleteTask }) {
  // Build lookup: 'YYYY-MM-DD' -> task[]
  const tasksByDate = useMemo(() => {
    const map = {};
    for (const task of tasks) {
      if (!task.due_date) continue;
      const key = typeof task.due_date === 'string'
        ? task.due_date.slice(0, 10)
        : format(task.due_date, 'yyyy-MM-dd');
      if (!map[key]) map[key] = [];
      map[key].push(task);
    }
    // Sort each day's tasks by sort_order ASC
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => {
        if (a.sort_order == null && b.sort_order == null) return 0;
        if (a.sort_order == null) return 1;
        if (b.sort_order == null) return -1;
        return a.sort_order - b.sort_order;
      });
    }
    return map;
  }, [tasks]);

  // Build grid days (Monday start)
  const days = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [currentMonth]);

  return (
    <div className="flex-1 overflow-auto">
      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-gray-200">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="py-2 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide"
          >
            {label}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const dateKey = format(day, 'yyyy-MM-dd');
          return (
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
          );
        })}
      </div>
    </div>
  );
}
