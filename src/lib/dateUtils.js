import { 
  addDays, 
  nextFriday, 
  nextMonday, 
  endOfMonth, 
  format, 
  setDay, 
  startOfWeek,
  differenceInCalendarDays,
  isPast,
  parseISO,
  isToday,
  isTomorrow,
  isThisWeek
} from 'date-fns';
import { DUE_DATE_STYLES } from './styleUtils';

export const quickPickOptions = [
  {
    label: 'Tomorrow',
    getValue: () => format(addDays(new Date(), 1), 'yyyy-MM-dd'),
  },
  {
    label: '+2 Days',
    getValue: () => format(addDays(new Date(), 2), 'yyyy-MM-dd'),
  },
  {
    label: 'This Friday',
    getValue: () => format(nextFriday(new Date()), 'yyyy-MM-dd'),
  },
  {
    label: 'Next Monday',
    // To ensure it's always the upcoming Monday, even if today is Monday
    getValue: () => {
      const today = new Date();
      let target = nextMonday(today);
      // If today is Monday, nextMonday gives today. We want next week's Monday in that case.
      if (format(target, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd') && today.getDay() === 1) {
        target = addDays(target, 7);
      }
      return format(target, 'yyyy-MM-dd');
    },
  },
  {
    label: 'End Next Week',
    // Friday of the next calendar week
    getValue: () => format(setDay(addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), 7), 5), 'yyyy-MM-dd'),
  },
  {
    label: 'End of Month',
    getValue: () => format(endOfMonth(new Date()), 'yyyy-MM-dd'),
  },
];

/**
 * Get the status of a due date
 * @param {string|Date} dueDate - The due date to check
 * @returns {Object} Status object with type, label, and style information
 */
export function getDueDateStatus(dueDate) {
  if (!dueDate) return null;
  
  const date = typeof dueDate === 'string' ? parseISO(dueDate) : dueDate;
  const today = new Date();
  const daysDiff = differenceInCalendarDays(date, today);
  
  if (daysDiff < 0 || (daysDiff === 0 && isPast(date))) {
    return {
      type: 'OVERDUE',
      label: 'Overdue',
      daysDiff,
      styles: DUE_DATE_STYLES.OVERDUE
    };
  } else if (isToday(date)) {
    return {
      type: 'TODAY',
      label: 'Due Today',
      daysDiff: 0,
      styles: DUE_DATE_STYLES.TODAY
    };
  } else if (isTomorrow(date)) {
    return {
      type: 'TOMORROW',
      label: 'Due Tomorrow',
      daysDiff: 1,
      styles: DUE_DATE_STYLES.TOMORROW
    };
  } else if (isThisWeek(date, { weekStartsOn: 1 })) {
    return {
      type: 'THIS_WEEK',
      label: `Due ${format(date, 'EEEE')}`,
      daysDiff,
      styles: DUE_DATE_STYLES.THIS_WEEK
    };
  } else {
    return {
      type: 'FUTURE',
      label: format(date, 'MMM d'),
      daysDiff,
      styles: DUE_DATE_STYLES.FUTURE
    };
  }
}

/**
 * Format a date for display
 * @param {string|Date} date - The date to format
 * @param {string} formatString - The format string (defaults to 'EEEE, MMM do')
 * @returns {string} Formatted date string
 */
export function formatDate(date, formatString = 'EEEE, MMM do') {
  if (!date) return '';
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  return format(dateObj, formatString);
} 