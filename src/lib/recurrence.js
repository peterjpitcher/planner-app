// Recurring tasks (Wave 6 / P4) — pure next-occurrence date maths.
//
// All arithmetic is on a YYYY-MM-DD date key in Europe/London calendar terms.
// Callers pass a London date key (from getLondonDateKey or a task's due_date);
// there is no display `new Date()` here. We anchor at UTC noon (mirroring the
// codebase's addDaysToDateKey / planningWindow noon pattern) so day-of-month
// and month/year rollover are exact and never shifted by an offset.

// The four supported patterns. NULL (not recurring) is also valid input.
export const RECURRENCE_VALUES = ['daily', 'weekdays', 'weekly', 'monthly'];

/**
 * True when `value` is null or one of the four supported recurrence patterns.
 * @param {string|null} value
 * @returns {boolean}
 */
export function isValidRecurrence(value) {
  return value === null || RECURRENCE_VALUES.includes(value);
}

// Coerce a client-supplied interval to a sane positive integer (>= 1),
// defaulting to 1 for anything missing, fractional, zero, negative or garbage.
function sanitizeInterval(interval) {
  const n = Math.floor(Number(interval));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

// Parse a YYYY-MM-DD key to a UTC-noon Date, rejecting non-strings, malformed
// keys and impossible dates (e.g. 2026-02-31, which JS would silently roll).
function parseDateKey(dateKey) {
  if (typeof dateKey !== 'string') return null;
  const key = dateKey.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [year, month, day] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (Number.isNaN(dt.getTime())) return null;
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null; // e.g. 2026-02-31 rolled into March
  }
  return dt;
}

function toKey(dt) {
  return dt.toISOString().slice(0, 10);
}

/**
 * Compute the next occurrence date key for a recurring task.
 *
 * @param {string} fromDateKey  Base date key (YYYY-MM-DD, London calendar).
 * @param {string} recurrence   'daily' | 'weekdays' | 'weekly' | 'monthly'.
 * @param {number} [interval=1] "every N" — guarded to a positive integer;
 *                              ignored for 'weekdays'.
 * @returns {string|null} The next date key, or null for an unknown/empty
 *                        pattern or an unparseable base date.
 */
export function nextRecurrenceDate(fromDateKey, recurrence, interval = 1) {
  const from = parseDateKey(fromDateKey);
  if (!from) return null;

  if (recurrence === 'weekdays') {
    // The next Monday–Friday strictly after the base date; interval ignored.
    const next = new Date(from.getTime());
    do {
      next.setUTCDate(next.getUTCDate() + 1);
    } while (next.getUTCDay() === 0 || next.getUTCDay() === 6);
    return toKey(next);
  }

  const n = sanitizeInterval(interval);

  if (recurrence === 'daily') {
    const next = new Date(from.getTime());
    next.setUTCDate(next.getUTCDate() + n);
    return toKey(next);
  }

  if (recurrence === 'weekly') {
    const next = new Date(from.getTime());
    next.setUTCDate(next.getUTCDate() + n * 7);
    return toKey(next);
  }

  if (recurrence === 'monthly') {
    const year = from.getUTCFullYear();
    const month = from.getUTCMonth(); // 0-based
    const day = from.getUTCDate();
    const targetIndex = month + n;
    const targetYear = year + Math.floor(targetIndex / 12);
    const targetMonth = ((targetIndex % 12) + 12) % 12;
    // Last day of the target month (day 0 of the following month).
    const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0, 12, 0, 0)).getUTCDate();
    const clampedDay = Math.min(day, lastDay); // e.g. Jan 31 -> Feb 28
    const next = new Date(Date.UTC(targetYear, targetMonth, clampedDay, 12, 0, 0));
    return toKey(next);
  }

  return null; // unknown / empty / null pattern
}
