// Application Constants

// Project Status Values
export const PROJECT_STATUS = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  ON_HOLD: 'On Hold',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled'
};

// Task States
export const STATE = {
  TODAY: 'today',
  THIS_WEEK: 'this_week',
  BACKLOG: 'backlog',
  WAITING: 'waiting',
  DONE: 'done'
};

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

// Soft Caps per section
export const SOFT_CAPS = {
  MUST_DO: 5,
  GOOD_TO_DO: 5,
  QUICK_WINS: 8,
  THIS_WEEK: 15
};

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
  NOTE_MAX: 1000,
  DESCRIPTION_MAX: 1000,
  STAKEHOLDER_MAX: 50,
  MAX_STAKEHOLDERS: 10
};
