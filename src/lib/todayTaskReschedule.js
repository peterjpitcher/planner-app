import { STATE } from './constants';

function parseDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day, 12));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

/**
 * Pick the destination when a Today task is given a future due date.
 * Dates later in the current Monday-Sunday week go to This Week; later dates
 * go to Backlog. Today, overdue, cleared and invalid dates do not move it.
 */
export function getRescheduledTodayState(dueDate, todayDateKey) {
  const dueDateKey = typeof dueDate === 'string' ? dueDate.slice(0, 10) : '';
  const today = parseDateKey(todayDateKey);
  const due = parseDateKey(dueDateKey);

  if (!today || !due || dueDateKey <= todayDateKey) return null;

  const isoWeekday = today.getUTCDay() || 7;
  const weekEnd = new Date(today);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + (7 - isoWeekday));

  return dueDateKey <= weekEnd.toISOString().slice(0, 10)
    ? STATE.THIS_WEEK
    : STATE.BACKLOG;
}
