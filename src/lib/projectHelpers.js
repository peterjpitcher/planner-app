import { format, startOfDay } from 'date-fns';
import { getDueDateStatus as getSharedDueDateStatus } from './dateUtils';

// Delegates the Today/Tomorrow/Overdue classification to the shared,
// Europe/London-anchored dateUtils.getDueDateStatus (see FF-038) and only
// maps it to this module's own text/class/sortKey presentation.
export const getDueDateStatus = (dateString, isEditing = false, currentDueDateValue = '') => {
  const dateToConsider = isEditing && currentDueDateValue ? currentDueDateValue : dateString;
  if (!dateToConsider) return { text: 'No due date', classes: 'text-[#2f617a]/70 text-xs', sortKey: Infinity, fullDate: '' };

  const status = getSharedDueDateStatus(dateToConsider);
  if (!status) return { text: 'No due date', classes: 'text-[#2f617a]/70 text-xs', sortKey: Infinity, fullDate: '' };

  let date;
  if (typeof dateToConsider === 'string' && dateToConsider.match(/^\d{4}-\d{2}-\d{2}$/)) {
    date = startOfDay(new Date(dateToConsider + 'T00:00:00'));
  } else {
    date = startOfDay(new Date(dateToConsider));
  }
  const fullDateText = format(date, 'EEEE, MMM do, yyyy');
  const daysDiff = status.daysDiff;

  switch (status.type) {
    case 'TODAY':
      return { text: 'Due Today', classes: 'text-red-500 font-semibold', sortKey: 0, fullDate: fullDateText };
    case 'TOMORROW':
      return { text: 'Due Tomorrow', classes: 'text-amber-500 font-semibold', sortKey: 1, fullDate: fullDateText };
    case 'OVERDUE':
      return { text: `Overdue: ${format(date, 'EEEE, MMM do')}`, classes: 'text-red-500 font-semibold', sortKey: -Infinity + daysDiff, fullDate: fullDateText };
    default:
      return { text: `Due ${format(date, 'EEEE, MMM do')}`, classes: 'text-[#036586]', sortKey: daysDiff, fullDate: fullDateText };
  }
};

export const getStatusClasses = (status) => {
  switch (status) {
    case 'Completed':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'In Progress':
      return 'bg-[#0496c7]/15 text-[#036586] border-[#0496c7]/30';
    case 'On Hold':
      return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'Cancelled':
      return 'bg-rose-100 text-rose-600 border-rose-200';
    case 'Open':
    default:
      return 'bg-white text-[#036586] border-[#0496c7]/20';
  }
};
