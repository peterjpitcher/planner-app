// Style Utilities

import { PRIORITY } from './constants';

// Priority Style Classes
export const PRIORITY_STYLES = {
  [PRIORITY.HIGH]: {
    text: 'text-red-700',
    border: 'border-red-300',
    bg: 'bg-red-50',
    ring: 'ring-red-500',
    full: 'text-red-700 border-red-300 bg-red-50'
  },
  [PRIORITY.MEDIUM]: {
    text: 'text-yellow-700',
    border: 'border-yellow-300',
    bg: 'bg-yellow-50',
    ring: 'ring-yellow-500',
    full: 'text-yellow-700 border-yellow-300 bg-yellow-50'
  },
  [PRIORITY.LOW]: {
    text: 'text-green-700',
    border: 'border-green-300',
    bg: 'bg-green-50',
    ring: 'ring-green-500',
    full: 'text-green-700 border-green-300 bg-green-50'
  },
  DEFAULT: {
    text: 'text-gray-700',
    border: 'border-gray-300',
    bg: 'bg-gray-50',
    ring: 'ring-gray-500',
    full: 'text-gray-700 border-gray-300 bg-gray-50'
  }
};

// Get priority classes for an element
export function getPriorityClasses(priority, type = 'full') {
  const styles = PRIORITY_STYLES[priority] || PRIORITY_STYLES.DEFAULT;
  return styles[type] || styles.full;
}

// Status Style Classes
export const STATUS_STYLES = {
  'Open': {
    text: 'text-blue-700',
    bg: 'bg-blue-50',
    border: 'border-blue-300'
  },
  'In Progress': {
    text: 'text-purple-700',
    bg: 'bg-purple-50',
    border: 'border-purple-300'
  },
  'On Hold': {
    text: 'text-orange-700',
    bg: 'bg-orange-50',
    border: 'border-orange-300'
  },
  'Completed': {
    text: 'text-green-700',
    bg: 'bg-green-50',
    border: 'border-green-300'
  },
  'Cancelled': {
    text: 'text-gray-700',
    bg: 'bg-gray-50',
    border: 'border-gray-300'
  }
};

// Get status classes
export function getStatusClasses(status) {
  const styles = STATUS_STYLES[status] || STATUS_STYLES['Open'];
  return `${styles.text} ${styles.bg} ${styles.border}`;
}

// Due Date Status Classes
export const DUE_DATE_STYLES = {
  OVERDUE: {
    text: 'text-red-600',
    bg: 'bg-red-50',
    icon: 'text-red-500'
  },
  TODAY: {
    text: 'text-red-600',
    bg: 'bg-red-50',
    icon: 'text-red-500'
  },
  TOMORROW: {
    text: 'text-amber-600',
    bg: 'bg-amber-50',
    icon: 'text-amber-500'
  },
  THIS_WEEK: {
    text: 'text-blue-600',
    bg: 'bg-blue-50',
    icon: 'text-blue-500'
  },
  FUTURE: {
    text: 'text-gray-600',
    bg: 'bg-gray-50',
    icon: 'text-gray-500'
  }
};

// Common button styles
export const BUTTON_STYLES = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-500',
  secondary: 'bg-gray-200 text-gray-700 hover:bg-gray-300 focus:ring-gray-500',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
  success: 'bg-green-600 text-white hover:bg-green-700 focus:ring-green-500',
  ghost: 'bg-transparent hover:bg-gray-100 focus:ring-gray-500',
  disabled: 'bg-gray-300 text-gray-500 cursor-not-allowed'
};

// Common input styles
export const INPUT_STYLES = {
  base: 'block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500',
  error: 'border-red-300 focus:border-red-500 focus:ring-red-500',
  disabled: 'bg-gray-100 cursor-not-allowed'
};

// Common text styles
export const TEXT_STYLES = {
  h1: 'text-3xl font-bold text-gray-900',
  h2: 'text-2xl font-semibold text-gray-900',
  h3: 'text-lg font-medium text-gray-900',
  body: 'text-base text-gray-700',
  small: 'text-sm text-gray-600',
  muted: 'text-sm text-gray-500',
  error: 'text-sm text-red-600'
};

// Combine classes utility (similar to clsx)
export function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}