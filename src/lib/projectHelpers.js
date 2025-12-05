import React from 'react';
import { differenceInDays, format, isToday, isTomorrow, isPast, startOfDay } from 'date-fns';
import { 
  FireIcon as SolidFireIcon, 
  ExclamationTriangleIcon as SolidExclamationTriangleIcon, 
  CheckCircleIcon as SolidCheckIcon, 
  ClockIcon as SolidClockIcon 
} from '@heroicons/react/20/solid';

export const getPriorityClasses = (priority) => {
  switch (priority) {
    case 'High':
      return {
        icon: <SolidFireIcon className="h-5 w-5 text-red-400" />,
        textClass: 'text-red-500 font-semibold',
        cardOuterClass: 'border-red-200/70 shadow-[0_24px_48px_-28px_rgba(239,68,68,0.65)]',
        glowClass: 'bg-red-400/45',
        ribbonClass: 'from-red-500/70 via-red-400/30 to-transparent',
      };
    case 'Medium':
      return {
        icon: <SolidExclamationTriangleIcon className="h-5 w-5 text-amber-400" />,
        textClass: 'text-amber-500 font-semibold',
        cardOuterClass: 'border-amber-200/60 shadow-[0_24px_48px_-28px_rgba(245,158,11,0.4)]',
        glowClass: 'bg-amber-400/35',
        ribbonClass: 'from-amber-400/60 via-amber-300/25 to-transparent',
      };
    case 'Low':
      return {
        icon: <SolidCheckIcon className="h-5 w-5 text-emerald-400" />,
        textClass: 'text-emerald-500 font-medium',
        cardOuterClass: 'border-emerald-200/60 shadow-[0_24px_48px_-28px_rgba(16,185,129,0.35)]',
        glowClass: 'bg-emerald-300/40',
        ribbonClass: 'from-emerald-400/60 via-emerald-300/20 to-transparent',
      };
    default:
      return {
        icon: <SolidClockIcon className="h-5 w-5 text-slate-400" />,
        textClass: 'text-slate-500',
        cardOuterClass: 'border-slate-200/70 shadow-[0_24px_48px_-30px_rgba(100,116,139,0.35)]',
        glowClass: 'bg-slate-400/35',
        ribbonClass: 'from-slate-400/40 via-slate-300/25 to-transparent',
      };
  }
};

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
