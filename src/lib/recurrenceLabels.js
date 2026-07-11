// Recurring tasks (Wave 6 / P4) — shared human-readable labels.
//
// Pattern values mirror RECURRENCE_VALUES in recurrence.js. Kept in one place
// so the drawer's "Repeats" selector and the card's "Repeats" badge never drift.

/**
 * Options for the "Repeats" selector, in display order.
 * A `null` value means the task does not recur.
 */
export const RECURRENCE_OPTIONS = [
  { value: null, label: 'Never' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
];

// Patterns that take an "every N" interval. `weekdays` always steps one weekday,
// so it has no interval; `null` (not recurring) has none either.
export const INTERVAL_RECURRENCES = ['daily', 'weekly', 'monthly'];

// Singular unit noun for the interval label, e.g. 'weekly' -> 'week'.
const INTERVAL_UNIT = { daily: 'day', weekly: 'week', monthly: 'month' };

/**
 * Short cadence label for a recurring task's card badge, e.g. 'weekly' -> 'Weekly'.
 */
export const RECURRENCE_BADGE_LABEL = {
  daily: 'Daily',
  weekdays: 'Weekdays',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

/**
 * True when the pattern uses an "every N …" interval number input.
 * @param {string|null} recurrence
 * @returns {boolean}
 */
export function hasInterval(recurrence) {
  return INTERVAL_RECURRENCES.includes(recurrence);
}

/**
 * Pluralised interval unit for the inline label,
 * e.g. (weekly, 1) -> 'week', (weekly, 2) -> 'weeks'.
 * @param {string|null} recurrence
 * @param {number} interval
 * @returns {string}
 */
export function intervalUnitLabel(recurrence, interval) {
  const unit = INTERVAL_UNIT[recurrence];
  if (!unit) return '';
  return interval === 1 ? unit : `${unit}s`;
}
