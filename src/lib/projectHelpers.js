import { differenceInDays, format, isToday, isTomorrow, isPast, startOfDay } from 'date-fns';

export const getDueDateStatus = (dateString, isEditing = false, currentDueDateValue = '') => {
  const dateToConsider = isEditing && currentDueDateValue ? currentDueDateValue : dateString;
  if (!dateToConsider) return { text: 'No due date', classes: 'text-[#2f617a]/70 text-xs', sortKey: Infinity, fullDate: '' };

  let date;
  if (typeof dateToConsider === 'string' && dateToConsider.match(/^\d{4}-\d{2}-\d{2}$/)) {
    date = startOfDay(new Date(dateToConsider + 'T00:00:00'));
  } else {
    date = startOfDay(new Date(dateToConsider));
  }

  const today = startOfDay(new Date());
  const daysDiff = differenceInDays(date, today);
  let text = `Due ${format(date, 'EEEE, MMM do')}`;
  let classes = 'text-[#036586]';
  let sortKey = daysDiff;
  const fullDateText = format(date, 'EEEE, MMM do, yyyy');

  if (isToday(date)) {
    text = `Due Today`;
    classes = 'text-red-500 font-semibold';
    sortKey = 0;
  } else if (isTomorrow(date)) {
    text = `Due Tomorrow`;
    classes = 'text-amber-500 font-semibold';
    sortKey = 1;
  } else if (isPast(date) && !isToday(date)) {
    text = `Overdue: ${format(date, 'EEEE, MMM do')}`;
    classes = 'text-red-500 font-semibold';
    sortKey = -Infinity + daysDiff;
  } else if (daysDiff < 0) {
    text = `Due ${format(date, 'EEEE, MMM do')}`;
    classes = 'text-[#2f617a]/70 italic';
  } else if (daysDiff >= 0 && daysDiff <= 7) {
    text = `Due ${format(date, 'EEEE, MMM do')}`;
  } else if (daysDiff > 7) {
    text = `Due ${format(date, 'EEEE, MMM do')}`;
  }

  return { text, classes, fullDate: fullDateText, sortKey };
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
