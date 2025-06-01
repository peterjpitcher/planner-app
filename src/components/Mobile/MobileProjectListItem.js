'use client';

import Link from 'next/link';
import {
  ChevronRightIcon,
  BriefcaseIcon,
  CalendarDaysIcon,
  ExclamationTriangleIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  MinusIcon,
  ShieldCheckIcon
} from '@heroicons/react/24/outline';
import { formatDistanceToNowStrict, parseISO, format, isPast, isToday, isTomorrow } from 'date-fns';

const priorityStyles = {
  High: { icon: <ExclamationTriangleIcon className="h-4 w-4 text-red-600" />, textClass: 'text-red-700 font-semibold', bgColor: 'bg-red-50' },
  Medium: { icon: <ArrowUpIcon className="h-4 w-4 text-yellow-600" />, textClass: 'text-yellow-700 font-semibold', bgColor: 'bg-yellow-50' },
  Low: { icon: <ArrowDownIcon className="h-4 w-4 text-green-600" />, textClass: 'text-green-700', bgColor: 'bg-green-50' },
  default: { icon: <MinusIcon className="h-4 w-4 text-gray-500" />, textClass: 'text-gray-600', bgColor: 'bg-gray-50' }
};

const getPriorityStyling = (priority) => {
  return priorityStyles[priority] || priorityStyles.default;
};

const statusColors = {
  'Open': 'text-blue-700 bg-blue-100',
  'In Progress': 'text-purple-700 bg-purple-100',
  'On Hold': 'text-orange-700 bg-orange-100',
  'Completed': 'text-green-700 bg-green-100',
  'Cancelled': 'text-red-700 bg-red-100',
  default: 'text-gray-700 bg-gray-100'
};

const getStatusStyling = (status) => {
  return statusColors[status] || statusColors.default;
};

const MobileProjectListItem = ({ project }) => {
  const openTaskCount = project.tasks?.filter(t => !t.is_completed).length || 0;
  const priorityStyling = getPriorityStyling(project.priority);
  const statusStyling = getStatusStyling(project.status);
  const isArchived = project.status === 'Completed' || project.status === 'Cancelled';

  let dueDateStatus = 'No due date';
  let dueDateClasses = 'text-gray-500 italic';
  let DueDateIconComponent = CalendarDaysIcon;
  let dueDateIconClass = 'text-gray-500';

  if (project.due_date) {
    const date = parseISO(project.due_date);
    if (isPast(date) && !isToday(date) && !isArchived) {
      dueDateStatus = `Overdue ${formatDistanceToNowStrict(date, { addSuffix: true })}`;
      dueDateClasses = 'text-red-600 font-semibold';
      DueDateIconComponent = ExclamationTriangleIcon;
      dueDateIconClass = 'text-red-500';
    } else if (isToday(date) && !isArchived){
      dueDateStatus = 'Due Today';
      dueDateClasses = 'text-orange-600 font-semibold';
      DueDateIconComponent = ExclamationTriangleIcon;
      dueDateIconClass = 'text-orange-500';
    } else if (isTomorrow(date) && !isArchived){
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
    <Link href={`/m/project/${project.id}`} className="block w-full">
      <div className={`p-3 rounded-lg shadow hover:shadow-md transition-all duration-150 ease-in-out mb-3 border border-gray-200/80 ${priorityStyling.bgColor} ${isArchived ? 'opacity-70' : ''}`}>
        <div className="flex items-start justify-between">
          <div className="flex items-start min-w-0">
            <span className="mr-2 pt-0.5 flex-shrink-0">{priorityStyling.icon}</span>
            <div className="min-w-0">
                <h3 className={`text-md font-semibold text-gray-900 truncate pr-1`}>
                {project.name}
                </h3>
                 <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full inline-block mt-0.5 ${statusStyling} ${isArchived ? 'line-through' :''}`}>
                    {project.status || 'N/A'}
                </span>
            </div>
          </div>
          <ChevronRightIcon className="h-5 w-5 text-gray-400 flex-shrink-0 mt-0.5" />
        </div>

        <div className="mt-2 pl-7 text-xs space-y-1">
          <div className={`flex items-center ${dueDateClasses}`}>
            <DueDateIconComponent className={`h-3.5 w-3.5 mr-1 flex-shrink-0 ${dueDateIconClass}`} />
            <span>{dueDateStatus}</span>
          </div>

          <p className="text-gray-600">
            {openTaskCount > 0 ? (
                <span className="font-medium text-indigo-600">{openTaskCount} open task{openTaskCount !== 1 ? 's' : ''}</span>
            ) : (
                <span className="text-gray-500">No open tasks</span>
            )}
          </p>

          {project.stakeholders && project.stakeholders.length > 0 && (
            <div className="pt-1 mt-1 border-t border-gray-300/70">
                <p className="text-gray-500 truncate">
                    Stakeholders: {project.stakeholders.join(', ')}
                </p>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
};

export default MobileProjectListItem; 