// Application Constants

// Project Status Values
export const PROJECT_STATUS = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  ON_HOLD: 'On Hold',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled'
};

// Priority Levels
export const PRIORITY = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low'
};

// Priority Values for Sorting
export const PRIORITY_VALUES = {
  [PRIORITY.HIGH]: 3,
  [PRIORITY.MEDIUM]: 2,
  [PRIORITY.LOW]: 1,
  DEFAULT: 0
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

// Task Status
export const TASK_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed'
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
