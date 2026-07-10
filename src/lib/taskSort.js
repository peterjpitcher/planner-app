import { CHIP_VALUES } from './constants';
import { getLondonDateKey } from './timezone';

function toTimestamp(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

// Normalise any date/timestamp value to a lexically-comparable YYYY-MM-DD key.
function toDateKey(value) {
  if (!value) return null;
  const key = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

// Add whole days to a YYYY-MM-DD key using UTC arithmetic (handles month/year rollover).
function addDaysToDateKey(dateKey, days) {
  const key = toDateKey(dateKey);
  if (!key) return null;
  const [year, month, day] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(dt.getTime())) return null;
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// Date band: 0 = overdue, 1 = due today/tomorrow, 2 = later-dated or undated.
function dateBand(dueKey, todayKey, tomorrowKey) {
  if (dueKey && todayKey && dueKey < todayKey) return 0;
  if (dueKey && (dueKey === todayKey || dueKey === tomorrowKey)) return 1;
  return 2;
}

// Chip hierarchy, most important first. Values sourced from CHIP_VALUES so a
// renamed constant cannot silently break the ranking.
const CHIP_RANK_ORDER = [
  CHIP_VALUES.BLOCKS_OTHERS,
  CHIP_VALUES.URGENT,
  CHIP_VALUES.HIGH_IMPACT,
  CHIP_VALUES.ONLY_I_CAN,
  CHIP_VALUES.STRESS_RELIEF,
];
const NO_CHIP_RANK = CHIP_RANK_ORDER.length;

/**
 * Rank a task by its highest-priority chip. Lower number = more important.
 * Tasks with no recognised chip rank last (NO_CHIP_RANK).
 * @param {string[]|null|undefined} chips
 * @returns {number}
 */
export function chipRank(chips) {
  if (!Array.isArray(chips) || chips.length === 0) return NO_CHIP_RANK;
  let best = NO_CHIP_RANK;
  for (const chip of chips) {
    const idx = CHIP_RANK_ORDER.indexOf(chip);
    if (idx !== -1 && idx < best) best = idx;
  }
  return best;
}

/**
 * Deterministic, score-free priority comparator (ascending = most important first).
 *
 * Tiers, in order:
 *   a. Overdue (due_date < today) first; among overdue, earlier due_date first.
 *   b. Due today or tomorrow, before later-dated or undated.
 *   c. Chip tier (highest-ranked chip wins): blocks_others > urgent >
 *      high_impact > only_i_can > stress_relief > no chip.
 *   d. Age in state: older entered_state_at first (longer-waiting surfaces).
 *   e. Existing tiebreakers: sort_order asc, then created_at asc, then name/id.
 *
 * Parent-project deadline proximity (from the spec) is intentionally omitted:
 * candidate rows do not carry the parent project's due_date, and no join is
 * added purely for ranking.
 *
 * Pure function. Dates compared as lexical YYYY-MM-DD strings.
 * @param {object} a
 * @param {object} b
 * @param {{ todayKey?: string }} [options]
 * @returns {number}
 */
export function compareTasksByPriority(a, b, { todayKey } = {}) {
  const today = todayKey || getLondonDateKey();
  const tomorrow = addDaysToDateKey(today, 1);

  const dueA = toDateKey(a?.due_date);
  const dueB = toDateKey(b?.due_date);

  // Tier a/b: date band.
  const bandA = dateBand(dueA, today, tomorrow);
  const bandB = dateBand(dueB, today, tomorrow);
  if (bandA !== bandB) return bandA - bandB;

  // Tier a: among overdue, earlier due_date first.
  if (bandA === 0 && dueA !== dueB) {
    return dueA < dueB ? -1 : 1;
  }

  // Tier c: chip tier (lower rank = more important).
  const chipA = chipRank(a?.chips);
  const chipB = chipRank(b?.chips);
  if (chipA !== chipB) return chipA - chipB;

  // Tier d: age in state, older entered_state_at first (nulls last).
  const enteredA = toTimestamp(a?.entered_state_at);
  const enteredB = toTimestamp(b?.entered_state_at);
  if (enteredA === null && enteredB !== null) return 1;
  if (enteredA !== null && enteredB === null) return -1;
  if (enteredA !== null && enteredB !== null && enteredA !== enteredB) {
    return enteredA - enteredB;
  }

  // Tier e: existing tiebreakers — sort_order asc, then created_at asc.
  const sortA = a?.sort_order ?? Infinity;
  const sortB = b?.sort_order ?? Infinity;
  if (sortA !== sortB) return sortA - sortB;

  const createdA = toTimestamp(a?.created_at);
  const createdB = toTimestamp(b?.created_at);
  if (createdA === null && createdB !== null) return 1;
  if (createdA !== null && createdB === null) return -1;
  if (createdA !== null && createdB !== null && createdA !== createdB) {
    return createdA - createdB;
  }

  const nameDiff = (a?.name || '').localeCompare(b?.name || '');
  if (nameDiff !== 0) return nameDiff;

  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

/**
 * Sort a list of tasks by priority without mutating the input.
 * @param {object[]} tasks
 * @param {{ todayKey?: string }} [options]
 * @returns {object[]}
 */
export function sortTasksByPriority(tasks = [], { todayKey } = {}) {
  return [...tasks].sort((a, b) => compareTasksByPriority(a, b, { todayKey }));
}

export function compareTasksByDueDateAsc(a, b) {
  const dueA = toTimestamp(a?.due_date);
  const dueB = toTimestamp(b?.due_date);

  if (dueA === null && dueB !== null) return 1;
  if (dueA !== null && dueB === null) return -1;
  if (dueA !== null && dueB !== null && dueA !== dueB) {
    return dueA - dueB;
  }

  const createdA = toTimestamp(a?.created_at);
  const createdB = toTimestamp(b?.created_at);

  if (createdA === null && createdB !== null) return 1;
  if (createdA !== null && createdB === null) return -1;
  if (createdA !== null && createdB !== null && createdA !== createdB) {
    return createdA - createdB;
  }

  const nameDiff = (a?.name || '').localeCompare(b?.name || '');
  if (nameDiff !== 0) return nameDiff;

  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

export function compareTasksBySortOrderAsc(a, b) {
  // Primary sort: sort_order ascending
  const sortA = a?.sort_order ?? Infinity;
  const sortB = b?.sort_order ?? Infinity;

  if (sortA !== sortB) {
    return sortA - sortB;
  }

  // Tiebreaker: created_at ascending
  const createdA = toTimestamp(a?.created_at);
  const createdB = toTimestamp(b?.created_at);

  if (createdA === null && createdB !== null) return 1;
  if (createdA !== null && createdB === null) return -1;
  if (createdA !== null && createdB !== null && createdA !== createdB) {
    return createdA - createdB;
  }

  const nameDiff = (a?.name || '').localeCompare(b?.name || '');
  if (nameDiff !== 0) return nameDiff;

  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

export function sortTasksByDueDateAsc(tasks = []) {
  return [...tasks].sort(compareTasksByDueDateAsc);
}

export function sortTasksBySortOrderAsc(tasks = []) {
  return [...tasks].sort(compareTasksBySortOrderAsc);
}

export function compareBacklogTasks(a, b) {
  // Tier 1: due date ascending (dated before undated)
  const dueA = toTimestamp(a?.due_date);
  const dueB = toTimestamp(b?.due_date);

  if (dueA === null && dueB !== null) return 1;
  if (dueA !== null && dueB === null) return -1;
  if (dueA !== null && dueB !== null && dueA !== dueB) {
    return dueA - dueB;
  }

  // Tier 2: sort_order ascending
  const sortA = a?.sort_order ?? Infinity;
  const sortB = b?.sort_order ?? Infinity;
  if (sortA !== sortB) return sortA - sortB;

  // Tiebreaker: created_at ascending
  const createdA = toTimestamp(a?.created_at);
  const createdB = toTimestamp(b?.created_at);

  if (createdA === null && createdB !== null) return 1;
  if (createdA !== null && createdB === null) return -1;
  if (createdA !== null && createdB !== null && createdA !== createdB) {
    return createdA - createdB;
  }

  const nameDiff = (a?.name || '').localeCompare(b?.name || '');
  if (nameDiff !== 0) return nameDiff;

  return String(a?.id || '').localeCompare(String(b?.id || ''));
}
