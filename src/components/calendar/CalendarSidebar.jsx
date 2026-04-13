'use client';

import { useMemo } from 'react';
import { parseISO, format } from 'date-fns';
import CalendarTaskPill from './CalendarTaskPill';

export default function CalendarSidebar({ tasks, today }) {
  const { overdueTasks, undatedTasks } = useMemo(() => {
    const overdue = [];
    const undated = [];

    for (const task of tasks) {
      if (!task.due_date) {
        undated.push(task);
      } else {
        const dueKey = typeof task.due_date === 'string'
          ? task.due_date.slice(0, 10)
          : format(task.due_date, 'yyyy-MM-dd');
        if (dueKey < today) {
          overdue.push(task);
        }
      }
    }

    // Overdue: most overdue first (earliest due_date)
    overdue.sort((a, b) => {
      const aKey = typeof a.due_date === 'string' ? a.due_date.slice(0, 10) : '';
      const bKey = typeof b.due_date === 'string' ? b.due_date.slice(0, 10) : '';
      return aKey.localeCompare(bKey);
    });

    // Undated: newest first
    undated.sort((a, b) => {
      const aDate = a.created_at || '';
      const bDate = b.created_at || '';
      return bDate.localeCompare(aDate);
    });

    return { overdueTasks: overdue, undatedTasks: undated };
  }, [tasks, today]);

  if (overdueTasks.length === 0 && undatedTasks.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Overdue section */}
      {overdueTasks.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-2">
            Overdue ({overdueTasks.length})
          </h3>
          <div className="flex flex-col gap-1">
            {overdueTasks.map((task) => (
              <div key={task.id} className="flex flex-col">
                <CalendarTaskPill task={task} expanded />
                <span className="text-[10px] text-red-400 ml-2 mt-0.5">
                  was {format(parseISO(typeof task.due_date === 'string' ? task.due_date.slice(0, 10) : task.due_date), 'dd MMM')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Undated section */}
      {undatedTasks.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            No date ({undatedTasks.length})
          </h3>
          <div className="flex flex-col gap-1">
            {undatedTasks.map((task) => (
              <CalendarTaskPill key={task.id} task={task} expanded />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
