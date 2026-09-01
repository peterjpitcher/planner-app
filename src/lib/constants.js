// Application Constants

// Project Status Values
export const PROJECT_STATUS = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  ON_HOLD: 'On Hold',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled'
};

// Customer lifecycle.
//
// Deliberately not PROJECT_STATUS. A customer is not a project and should not
// borrow its vocabulary: "On Hold" and "In Progress" mean nothing about a
// relationship, and "Completed" is not the same thing as "Former".
export const CUSTOMER_STATUS = {
  ACTIVE: 'Active',
  PROSPECT: 'Prospect',
  DORMANT: 'Dormant',
  FORMER: 'Former'
};

// Statuses that can still take new projects and tasks without a confirmation.
// Former can too, but is flagged in the UI first. Archived cannot at all,
// regardless of status: archive means "this is finished".
export const CUSTOMER_ACTIVE_STATUSES = [
  CUSTOMER_STATUS.ACTIVE,
  CUSTOMER_STATUS.PROSPECT,
  CUSTOMER_STATUS.DORMANT
];

// Task States
export const STATE = {
  TODAY: 'today',
  THIS_WEEK: 'this_week',
  BACKLOG: 'backlog',
  WAITING: 'waiting',
  DONE: 'done',
  CANCELLED: 'cancelled'
};

// Terminal states. A task in a CLOSED state is finished with, one way or the
// other, and must never surface in Today, the Plan board, planning candidates,
// the autopilot pool or the daily digest.
//
// Every query that excludes finished work must filter on CLOSED_STATES rather
// than hardcoding 'done'. Before this existed the exclusions were scattered
// denylists ('("today","done")'), so adding 'cancelled' would have leaked
// cancelled tasks into all six of those surfaces. Add a new terminal state here
// and every consumer picks it up.
export const CLOSED_STATES = [STATE.DONE, STATE.CANCELLED];

// States a task can be in while it is still live work.
export const ACTIVE_STATES = [STATE.TODAY, STATE.THIS_WEEK, STATE.BACKLOG, STATE.WAITING];

/**
 * Build a PostgREST `in` filter list, e.g. '("today","done","cancelled")'.
 * Use with `.not('state', 'in', ...)` so exclusions stay in one place.
 *
 * @param {string[]} [extraStates] additional states to exclude alongside the
 *   terminal ones (typically STATE.TODAY when building a promotion pool).
 * @returns {string} PostgREST-formatted list.
 */
export function closedStatesFilter(extraStates = []) {
  const all = [...extraStates, ...CLOSED_STATES];
  return `(${all.map((s) => `"${s}"`).join(',')})`;
}

// Today Section Buckets
export const TODAY_SECTION = {
  MUST_DO: 'must_do',
  GOOD_TO_DO: 'good_to_do',
  QUICK_WINS: 'quick_wins'
};

export const TODAY_SECTION_ORDER = ['must_do', 'good_to_do', 'quick_wins'];
export const IDEA_STATE_ORDER = ['captured', 'exploring', 'ready_later'];

// Task Types
export const TASK_TYPE = {
  ADMIN: 'admin',
  REPLY_CHASE: 'reply_chase',
  FIX: 'fix',
  PLANNING: 'planning',
  CONTENT: 'content',
  DEEP_WORK: 'deep_work',
  PERSONAL: 'personal'
};

// Cross-cutting Chip Values
export const CHIP_VALUES = {
  HIGH_IMPACT: 'high_impact',
  URGENT: 'urgent',
  BLOCKS_OTHERS: 'blocks_others',
  STRESS_RELIEF: 'stress_relief',
  ONLY_I_CAN: 'only_i_can'
};

// Idea States
export const IDEA_STATE = {
  CAPTURED: 'captured',
  EXPLORING: 'exploring',
  READY_LATER: 'ready_later',
  PROMOTED: 'promoted'
};

// Planning Window Types
export const WINDOW_TYPE = {
  DAILY: 'daily',
  WEEKLY: 'weekly'
};

// Morning autopilot level (A3 / F5-lite). 'off' preserves the fully-manual
// behaviour (default); 'review' builds the day and shows a prominent
// review/undo banner until acknowledged; 'auto' builds the day with a lighter
// banner. Mirrors the user_settings.autopilot_level CHECK constraint.
export const AUTOPILOT_LEVEL = {
  OFF: 'off',
  REVIEW: 'review',
  AUTO: 'auto'
};

// Default planning window times
export const PLANNING_DEFAULTS = {
  DAILY_START: '20:05',
  DAILY_END: '20:00',
  WEEKLY_START: '20:05',
  WEEKLY_END: '20:00'
};

// Soft Caps per section
export const SOFT_CAPS = {
  MUST_DO: 5,
  GOOD_TO_DO: 5,
  QUICK_WINS: 8,
  THIS_WEEK: 15
};

// Carry-forward (A1): a Today task that has been carried this many consecutive
// evenings surfaces an amber "carried N days — still today?" nudge instead of
// silently persisting, so Today does not silt up with zombies.
export const CARRY_NUDGE_THRESHOLD = 3;

// Backlog-ageing next-review invariant (F4): an undated backlog task left
// untouched for this many days resurfaces in the planning modal's "Still needed?"
// group, so nothing sits unseen forever. Acting on a row (assign / defer / snooze
// / complete) resets entered_state_at via the DB trigger, so it will not re-nag
// until it ages again.
export const STALE_BACKLOG_DAYS = 14;

// Cap on how many aged backlog tasks surface per planning session, so an old
// vault can never flood the modal. Rows beyond the cap are summarised as
// "+N more ageing in backlog".
export const REVIEW_BACKLOG_CAP = 10;

// UI Constants
export const UI_CONSTANTS = {
  MOBILE_BREAKPOINT: 640,
  DEBOUNCE_DELAY: 500,
  MAX_FILE_LINES: 2000,
  ANIMATION_DELAY: 100,
  TOAST_DURATION: 3000
};

// Date Format Patterns
export const DATE_FORMATS = {
  DISPLAY: 'EEEE, MMM do',
  INPUT: 'yyyy-MM-dd',
  FULL: 'EEEE, MMM do, h:mm a',
  SHORT: 'MMM d',
  TIME: 'h:mm a'
};

// Note Types
export const NOTE_TYPE = {
  PROJECT: 'project',
  TASK: 'task'
};

// Filter Labels
export const FILTER_LABELS = {
  ALL_STAKEHOLDERS: 'All Stakeholders',
  NO_STAKEHOLDER: 'No Stakeholder'
};

// Error Messages
export const ERROR_MESSAGES = {
  GENERIC: 'An error occurred. Please try again.',
  NETWORK: 'Network error. Please check your connection.',
  AUTH: 'Authentication required. Please log in.',
  NOT_FOUND: 'Resource not found.',
  VALIDATION: 'Please check your input and try again.',
  SAVE_FAILED: 'Failed to save changes.',
  DELETE_FAILED: 'Failed to delete item.',
  LOAD_FAILED: 'Failed to load data.'
};

// Success Messages
export const SUCCESS_MESSAGES = {
  SAVED: 'Changes saved successfully.',
  DELETED: 'Item deleted successfully.',
  CREATED: 'Created successfully.',
  UPDATED: 'Updated successfully.',
  COPIED: 'Copied to clipboard.'
};

// Drag & Drop
export const DRAG_DATA_TYPES = {
  TASK: 'application/x-task-drag'
};

// Validation Rules
export const VALIDATION = {
  PROJECT_NAME_MIN: 1,
  PROJECT_NAME_MAX: 255,
  TASK_NAME_MIN: 1,
  TASK_NAME_MAX: 255,
  // Raised from 1000 in Phase 2, alongside the textarea. 1000 characters could
  // not hold a pasted email thread, which is exactly what customer notes are
  // for. The API cap and the input now agree.
  NOTE_MAX: 20000,
  DESCRIPTION_MAX: 1000,
  STAKEHOLDER_MAX: 50,
  MAX_STAKEHOLDERS: 10,
  // Customers. The name limit matches the customers_name_length check
  // constraint, so the API rejects an over-long name with a 400 rather than
  // letting the database raise a 500.
  CUSTOMER_NAME_MAX: 120,
  CUSTOMER_SUMMARY_MAX: 2000,
  CUSTOMER_WEBSITE_MAX: 500
};
