import { getTimeZoneParts, LONDON_TIME_ZONE } from './timezone';
import { PLANNING_DEFAULTS, WINDOW_TYPE } from './constants';

/**
 * Parse a "HH:MM" time string into { hour, minute }.
 */
function parseTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return { hour: h, minute: m };
}

/**
 * Convert London { hour, minute } into minutes-since-midnight for comparison.
 */
function toMinutes({ hour, minute }) {
  return hour * 60 + minute;
}

/**
 * Determine if a London time is inside a planning window.
 *
 * Daily windows span two calendar days: start (e.g. 20:05 today) to end (e.g. 20:00 tomorrow).
 * This means the window wraps past midnight: start > end in minute terms.
 *
 * @param {Object} londonParts - { hour, minute, day, month, year, dateKey } from getTimeZoneParts
 * @param {string} startTime - "HH:MM" start of window
 * @param {string} endTime - "HH:MM" end of window (next day for daily, next week for weekly)
 * @returns {boolean}
 */
function isInsideWindow(londonParts, startTime, endTime) {
  const now = toMinutes(londonParts);
  const start = toMinutes(parseTime(startTime));
  const end = toMinutes(parseTime(endTime));

  if (start > end) {
    // Window wraps past midnight: e.g. 20:05 to 20:00
    // Inside if now >= start OR now < end
    return now >= start || now < end;
  }
  // Non-wrapping window
  return now >= start && now < end;
}

/**
 * Get the day of week in London (0 = Sunday, 6 = Saturday).
 */
function getLondonDayOfWeek(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TIME_ZONE,
    weekday: 'short',
  });
  const weekday = formatter.format(date);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[weekday];
}

/**
 * Add days to an ISO date string.
 * @param {string} dateKey - "YYYY-MM-DD"
 * @param {number} days
 * @returns {string} "YYYY-MM-DD"
 */
function getDatePlusDays(dateKey, days) {
  const d = new Date(dateKey + 'T12:00:00Z'); // noon UTC to avoid DST edge
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Determine the active planning window and compute the target window_date.
 *
 * @param {Object} settings - User settings with daily_plan_start/end, weekly_plan_start/end
 * @param {Date} [now] - Current time (defaults to new Date())
 * @returns {{ isActive: boolean, windowType: string|null, windowDate: string|null }}
 *   windowDate is ISO date string (YYYY-MM-DD) — tomorrow for daily, Monday of target week for weekly.
 */
export function getActivePlanningWindow(settings = {}, now = new Date()) {
  const londonParts = getTimeZoneParts(now, LONDON_TIME_ZONE);
  const dayOfWeek = getLondonDayOfWeek(now);

  const dailyStart = settings.daily_plan_start || PLANNING_DEFAULTS.DAILY_START;
  const dailyEnd = settings.daily_plan_end || PLANNING_DEFAULTS.DAILY_END;
  const weeklyStart = settings.weekly_plan_start || PLANNING_DEFAULTS.WEEKLY_START;
  const weeklyEnd = settings.weekly_plan_end || PLANNING_DEFAULTS.WEEKLY_END;

  // Sunday check for weekly window
  const isSunday = dayOfWeek === 0;
  // After midnight but before end on Monday counts as Sunday's weekly window
  const isMondayBeforeEnd = dayOfWeek === 1 && toMinutes(londonParts) < toMinutes(parseTime(weeklyEnd));

  // Check weekly window first (Sunday evening or still inside on Monday morning)
  if (isSunday || isMondayBeforeEnd) {
    if (isSunday && isInsideWindow(londonParts, weeklyStart, weeklyEnd)) {
      // Window date = tomorrow (Monday) as the anchor for the week
      const tomorrow = getDatePlusDays(londonParts.dateKey, 1);
      return { isActive: true, windowType: WINDOW_TYPE.WEEKLY, windowDate: tomorrow };
    }
    if (isMondayBeforeEnd && toMinutes(londonParts) < toMinutes(parseTime(weeklyEnd))) {
      // Still in the weekly window that started Sunday evening
      // Window date = today (Monday)
      return { isActive: true, windowType: WINDOW_TYPE.WEEKLY, windowDate: londonParts.dateKey };
    }
  }

  // Check daily window (every day except Sunday before weekly start)
  if (isInsideWindow(londonParts, dailyStart, dailyEnd)) {
    // Compute tomorrow's date as the window_date
    const nowMinutes = toMinutes(londonParts);
    const startMinutes = toMinutes(parseTime(dailyStart));

    if (nowMinutes >= startMinutes) {
      // After start time: tomorrow = current London date + 1
      const tomorrow = getDatePlusDays(londonParts.dateKey, 1);
      return { isActive: true, windowType: WINDOW_TYPE.DAILY, windowDate: tomorrow };
    } else {
      // Before end time (after midnight): tomorrow = current London date (it IS tomorrow now)
      return { isActive: true, windowType: WINDOW_TYPE.DAILY, windowDate: londonParts.dateKey };
    }
  }

  return { isActive: false, windowType: null, windowDate: null };
}

/**
 * Get the Monday date for a given week (used for weekly window_date).
 * @param {string} dateKey - any date in ISO format
 * @returns {string} Monday's date in "YYYY-MM-DD"
 */
export function getMondayOfWeek(dateKey) {
  const d = new Date(dateKey + 'T12:00:00Z');
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}
