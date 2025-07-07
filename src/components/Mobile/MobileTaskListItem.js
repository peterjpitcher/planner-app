'use client';

import React from 'react';
import Link from 'next/link';
// useRouter removed as it's not directly used after swipe removal
import {
  ChevronRightIcon,
  CheckCircleIcon as OutlineCheckCircleIcon,
  ClockIcon,
  CalendarDaysIcon,
  ExclamationTriangleIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  MinusIcon
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as SolidCheckCircleIcon } from '@heroicons/react/24/solid';
import { format, isToday, isTomorrow, isPast, startOfDay, parseISO } from 'date-fns';

const priorityStyles = {
  High: { icon: <ExclamationTriangleIcon className="h-4 w-4 text-red-600" />, textClass: 'text-red-700 font-semibold', bgColor: 'bg-red-50', completionColor: 'text-red-500' },
  Medium: { icon: <ArrowUpIcon className="h-4 w-4 text-yellow-600" />, textClass: 'text-yellow-700 font-semibold', bgColor: 'bg-yellow-50', completionColor: 'text-yellow-500' },
  Low: { icon: <ArrowDownIcon className="h-4 w-4 text-green-600" />, textClass: 'text-green-700', bgColor: 'bg-green-50', completionColor: 'text-green-500' },
  default: { icon: <MinusIcon className="h-4 w-4 text-gray-500" />, textClass: 'text-gray-600', bgColor: 'bg-gray-50', completionColor: 'text-gray-400' }
};

const getPriorityStyling = (priority) => {
  return priorityStyles[priority] || priorityStyles.default;
};

const MobileTaskListItem = ({ task, projectContext = null }) => {
  const priorityStyling = getPriorityStyling(task.priority);

  let dueDateStatus = 'No due date';
  let dueDateClasses = 'text-gray-500 italic';
  let DueDateIconComponent = ClockIcon;
  let dueDateIconClass = 'text-gray-400';

  if (task.is_completed) {
    dueDateStatus = task.completed_at ? `Completed ${format(parseISO(task.completed_at), 'MMM d')}` : 'Completed';
    dueDateClasses = 'text-green-600';
    DueDateIconComponent = SolidCheckCircleIcon;
    dueDateIconClass = 'text-green-500';
  } else if (task.due_date) {
    const date = parseISO(task.due_date);
    if (isPast(date) && !isToday(date)) {
      dueDateStatus = `Overdue ${format(date, 'MMM d')}`;
      dueDateClasses = 'text-red-600 font-semibold';
      DueDateIconComponent = ExclamationTriangleIcon;
      dueDateIconClass = 'text-red-500';
    } else if (isToday(date)){
      dueDateStatus = 'Due Today';
      dueDateClasses = 'text-orange-600 font-semibold';
      DueDateIconComponent = ExclamationTriangleIcon;
      dueDateIconClass = 'text-orange-500';
    } else if (isTomorrow(date)){
      dueDateStatus = 'Due Tomorrow';
      dueDateClasses = 'text-yellow-600 font-semibold';
      DueDateIconComponent = CalendarDaysIcon;
      dueDateIconClass = 'text-yellow-500';
    } else {
      dueDateStatus = `Due ${format(date, 'MMM d, yyyy')}`;
      dueDateClasses = 'text-gray-600';
      DueDateIconComponent = CalendarDaysIcon;
      dueDateIconClass = 'text-gray-500';
    }
  }

  return (
    <Link href={`/m/task/${task.id}`} className="block w-full">
      <div className={`p-3 rounded-lg shadow hover:shadow-md mb-3 border border-gray-200/80 transition-all duration-150 ease-in-out ${priorityStyling.bgColor} ${task.is_completed ? 'opacity-70' : ''}`}>
        <div className="flex items-start justify-between">
          <div className="flex items-start min-w-0">
            {task.is_completed ? 
              <SolidCheckCircleIcon className={`h-5 w-5 ${priorityStyling.completionColor} mr-2 flex-shrink-0`} /> :
              <OutlineCheckCircleIcon className="h-5 w-5 text-gray-400 mr-2 flex-shrink-0" />
            }
            <div className="min-w-0">
                <h3 className={`text-sm font-semibold ${task.is_completed ? 'line-through text-gray-500' : 'text-gray-900'} truncate pr-1`}>
                {task.name}
                </h3>
            </div>
          </div>
          <ChevronRightIcon className="h-5 w-5 text-gray-400 flex-shrink-0 mt-0.5" />
        </div>

        {(task.description || projectContext || task.priority || task.due_date || task.is_completed) && (
            <div className={`mt-2 pl-7 text-xs space-y-1 ${task.is_completed ? 'text-gray-500' : 'text-gray-700'}`}>
                {task.description && (
                <p className={`truncate ${task.is_completed ? 'text-gray-500' : 'text-gray-600'}`}>
                    {task.description}
                </p>
                )}
                {projectContext && projectContext.id && projectContext.name && (
                <p className={`${task.is_completed ? 'text-gray-500' : 'text-gray-500'}`}>
                    Project: <Link href={`/m/project/${projectContext.id}`} className={`font-medium ${task.is_completed ? 'text-gray-500 hover:text-gray-600' : 'text-indigo-600 hover:text-indigo-700'} hover:underline`} onClick={(e) => e.stopPropagation()}>{projectContext.name}</Link>
                </p>
                )}
                <div className={`flex items-center ${task.is_completed ? 'text-gray-500' : priorityStyling.textClass }`}>
                    {priorityStyling.icon} 
                    <span className="ml-1">{task.priority || 'No Priority'}</span>
                </div>
                <div className={`flex items-center ${dueDateClasses}`}>
                    <DueDateIconComponent className={`h-3.5 w-3.5 mr-1 flex-shrink-0 ${dueDateIconClass}`} />
                    <span>{dueDateStatus}</span>
                </div>
            </div>
        )}
      </div>
    </Link>
  );
};

export default React.memo(MobileTaskListItem, (prevProps, nextProps) => {
  return (
    prevProps.task.id === nextProps.task.id &&
    prevProps.task.updated_at === nextProps.task.updated_at &&
    prevProps.task.name === nextProps.task.name &&
    prevProps.task.is_completed === nextProps.task.is_completed &&
    prevProps.task.priority === nextProps.task.priority &&
    prevProps.task.due_date === nextProps.task.due_date
  );
}); 