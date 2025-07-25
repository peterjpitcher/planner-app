'use client';

import { useState, useEffect, useMemo } from 'react';
import { format, parseISO, startOfDay, differenceInDays, isToday, isTomorrow, isPast, isSameDay, addDays, endOfDay, isWithinInterval, formatDistanceToNowStrict, compareAsc, compareDesc, endOfWeek } from 'date-fns';
import { apiClient } from '@/lib/apiClient';
import { PencilIcon, CheckCircleIcon as OutlineCheckCircleIcon } from '@heroicons/react/24/outline';
import { FireIcon as SolidFireIcon, ExclamationTriangleIcon as SolidExclamationTriangleIcon, CheckCircleIcon as SolidCheckIcon, ClockIcon as SolidClockIcon } from '@heroicons/react/20/solid';
import { useTargetProject } from '@/contexts/TargetProjectContext';

// Simplified helper for due date status (can be shared or passed if more complex)
const getTaskDueDateStatus = (dateString, isEditing = false, currentDueDate = '') => {
  const dateToConsider = isEditing && currentDueDate ? currentDueDate : dateString;
  if (!dateToConsider) return { text: 'No due date', classes: 'text-gray-600 text-xs', sortKey: Infinity, fullDate: '' };
  
  let date = startOfDay(parseISO(dateToConsider));
  if (typeof dateToConsider === 'string' && dateToConsider.match(/^\d{4}-\d{2}-\d{2}$/)) {
    date = startOfDay(new Date(dateToConsider + 'T00:00:00'));
  }

  const today = startOfDay(new Date());
  const daysDiff = differenceInDays(date, today);
  let text = `Due: ${format(date, 'EEEE, MMM do')}`;
  let classes = 'text-gray-700';
  let sortKey = daysDiff;
  const fullDateText = format(date, 'EEEE, MMM do, yyyy');

  if (isToday(date)) {
    text = `Due Today`;
    classes = 'text-red-700 font-bold';
    sortKey = 0;
  } else if (isTomorrow(date)) {
    text = `Due Tomorrow`;
    classes = 'text-yellow-700 font-bold';
    sortKey = 1;
  } else if (isPast(date) && !isToday(date)) {
    text = `Overdue: ${format(date, 'EEEE, MMM do')}`;
    classes = 'text-red-700 font-bold';
    sortKey = -Infinity + daysDiff;
  } else if (daysDiff < 0) { // Other past dates (should be covered by isPast)
     text = `Due ${format(date, 'EEEE, MMM do')}`;
     classes = 'text-gray-600 italic';
  } else if (daysDiff >= 0 && daysDiff <= 7) { // Changed from "Due in Xd (DayOfWeek)"
    text = `Due: ${format(date, 'EEEE, MMM do')}`; 
  }
  return { text, classes, sortKey, fullDate: fullDateText };
};

const getStandaloneTaskPriorityStyling = (priority) => {
  // Returns icon, text color, and card background/border color
  switch (priority) {
    case 'High':
      return { icon: <SolidFireIcon className="h-4 w-4 text-red-500" />, textClass: 'text-red-600 font-semibold', cardOuterClass: 'border-l-4 border-red-700 bg-red-200', badgeClass: 'bg-red-600 text-white' };
    case 'Medium':
      return { icon: <SolidExclamationTriangleIcon className="h-4 w-4 text-yellow-500" />, textClass: 'text-yellow-600 font-semibold', cardOuterClass: 'border-l-4 border-yellow-600 bg-yellow-100', badgeClass: 'bg-yellow-500 text-black' };
    case 'Low':
      return { icon: <SolidCheckIcon className="h-4 w-4 text-green-500" />, textClass: 'text-green-600', cardOuterClass: 'border-l-4 border-green-700 bg-green-200', badgeClass: 'bg-green-600 text-white' };
    default:
      return { icon: <SolidClockIcon className="h-4 w-4 text-gray-400" />, textClass: 'text-gray-500', cardOuterClass: 'border-l-4 border-gray-400 bg-gray-100', badgeClass: 'bg-gray-500 text-white' };
  }
};

const getPriorityValue = (priority) => {
    switch (priority) {
      case 'High': return 3;
      case 'Medium': return 2;
      case 'Low': return 1;
      default: return 0; // No priority or undefined
    }
};

function StandaloneTaskItem({ task, project, onTaskUpdated }) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [currentName, setCurrentName] = useState(task.name);
  const [isEditingDueDate, setIsEditingDueDate] = useState(false);
  const [currentDueDate, setCurrentDueDate] = useState(task.due_date ? format(parseISO(task.due_date), 'yyyy-MM-dd') : '');
  const [isEditingPriority, setIsEditingPriority] = useState(false);
  const [currentPriority, setCurrentPriority] = useState(task.priority || '');
  const { setTargetProjectId } = useTargetProject();

  useEffect(() => {
    setCurrentName(task.name);
    setCurrentDueDate(task.due_date ? format(parseISO(task.due_date), 'yyyy-MM-dd') : '');
    if (!isEditingPriority) {
      setCurrentPriority(task.priority || '');
    }
  }, [task, isEditingPriority]);

  const dueDateInfo = getTaskDueDateStatus(task.due_date, isEditingDueDate, currentDueDate);
  const updatedAgo = task.updated_at 
    ? formatDistanceToNowStrict(parseISO(task.updated_at), { addSuffix: true })
    : 'never';

  const handleNameUpdate = async () => {
    if (currentName.trim() === task.name) {
      setIsEditingName(false);
      return;
    }
    try {
      const data = await apiClient.updateTask(task.id, { 
        name: currentName.trim(), 
        updated_at: new Date().toISOString() 
      });
      if (onTaskUpdated) onTaskUpdated(data);
      setIsEditingName(false);
    } catch (err) {
      setCurrentName(task.name); // revert
      setIsEditingName(false);
    }
  };

  const handleDueDateUpdate = async () => {
    const originalFormattedDate = task.due_date ? format(parseISO(task.due_date), 'yyyy-MM-dd') : '';
    if (currentDueDate === originalFormattedDate) {
      setIsEditingDueDate(false);
      return;
    }
    try {
      const data = await apiClient.updateTask(task.id, { 
        due_date: currentDueDate || null, 
        updated_at: new Date().toISOString() 
      });
      if (onTaskUpdated) onTaskUpdated(data);
      setIsEditingDueDate(false);
    } catch (err) {
      setCurrentDueDate(originalFormattedDate); // revert
      setIsEditingDueDate(false);
    }
  };

  const handleToggleComplete = async () => {
    const newCompletedStatus = !task.is_completed;
    try {
      const data = await apiClient.updateTask(task.id, { 
        is_completed: newCompletedStatus, 
        completed_at: newCompletedStatus ? new Date().toISOString() : null,
        updated_at: new Date().toISOString() 
      });
      if (onTaskUpdated) onTaskUpdated(data);
    } catch (err) {
      // Error updating task status
    }
  };

  const handlePriorityUpdate = async () => {
    if (currentPriority === (task.priority || '')) {
      setIsEditingPriority(false);
      return;
    }
    try {
      const data = await apiClient.updateTask(task.id, { 
        priority: currentPriority || null, 
        updated_at: new Date().toISOString() 
      });
      if (onTaskUpdated) onTaskUpdated(data);
      setIsEditingPriority(false);
    } catch (err) {
      setCurrentPriority(task.priority || ''); // revert
      setIsEditingPriority(false);
    }
  };

  const priorityStyles = getStandaloneTaskPriorityStyling(currentPriority);
  const itemPriorityClass = priorityStyles.cardOuterClass; // Used for the main div

  const handleProjectClick = () => {
    if (project && project.id) {
      setTargetProjectId(project.id);
    }
  };

  return (
    <div className={`p-1.5 border-b border-gray-200 flex items-start gap-2 rounded-md mb-1 ${itemPriorityClass} ${task.is_completed ? 'opacity-60 hover:opacity-80' : 'hover:shadow-sm'}`}>
      <input 
        type="checkbox" 
        checked={task.is_completed}
        onChange={handleToggleComplete}
        className="mt-0.5 h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 flex-shrink-0"
      />
      <div className="flex-grow min-w-0">
        <div className="flex items-center justify-between">
          {isEditingName ? (
            <input 
              type="text" 
              value={currentName}
              onChange={(e) => setCurrentName(e.target.value)}
              onBlur={handleNameUpdate}
              onKeyDown={(e) => e.key === 'Enter' && handleNameUpdate() || e.key === 'Escape' && (setCurrentName(task.name), setIsEditingName(false))}
              className="flex-grow text-sm p-0.5 border-b border-indigo-500 focus:outline-none mr-1 break-words"
              autoFocus
            />
          ) : (
            <p 
              className={`text-sm font-medium text-gray-800 truncate flex-grow mr-1 ${task.is_completed ? 'line-through' : 'cursor-text hover:bg-gray-100'} break-words`}
              onClick={() => !task.is_completed && setIsEditingName(true)}
              title={currentName}
            >
              {currentName}
            </p>
          )}
          <div className="flex-shrink-0 flex items-center">
            {!task.is_completed && !isEditingName && !isEditingDueDate && !isEditingPriority && (
              <PencilIcon 
                  className="h-4 w-4 text-gray-400 hover:text-indigo-600 cursor-pointer"
                  onClick={() => setIsEditingName(true)}
                  title="Edit task"
              />
            )}
            {task.is_completed && (
              <SolidCheckIcon className="h-5 w-5 text-green-500" title="Completed" />
            )}
          </div>
        </div>
        <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-xs mt-0.5">
          {isEditingDueDate ? (
              <input 
                  type="date" 
                  value={currentDueDate}
                  onChange={(e) => setCurrentDueDate(e.target.value)}
                  onBlur={handleDueDateUpdate}
                  onKeyDown={(e) => e.key === 'Enter' && handleDueDateUpdate() || e.key === 'Escape' && (setCurrentDueDate(task.due_date ? format(parseISO(task.due_date), 'yyyy-MM-dd') : ''), setIsEditingDueDate(false))}
                  className="text-xs p-0.5 border-b border-indigo-500 focus:outline-none w-28"
                  autoFocus
              />
          ) : (
              <span 
                  className={`${dueDateInfo.classes} ${!task.is_completed ? 'cursor-text hover:bg-gray-100 rounded px-0.5 -mx-0.5' : ''} break-words`}
                  onClick={() => !task.is_completed && setIsEditingDueDate(true)}
                  title={dueDateInfo.fullDate || (task.due_date ? format(parseISO(task.due_date), 'EEEE, MMM do, yyyy') : 'No due date')}
              >
                  {dueDateInfo.text}
              </span>
          )}
          {isEditingPriority ? (
            <select 
              value={currentPriority}
              onChange={(e) => setCurrentPriority(e.target.value)} 
              onBlur={handlePriorityUpdate} 
              onKeyDown={(e) => e.key === 'Enter' && handlePriorityUpdate() || e.key === 'Escape' && (setCurrentPriority(task.priority || ''), setIsEditingPriority(false))}
              className="text-xs p-0.5 border-b border-indigo-500 focus:outline-none h-6"
              autoFocus
            >
              <option value="">No Priority</option>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          ) : (
            <div 
              className={`flex items-center cursor-pointer hover:bg-gray-100/50 p-0.5 rounded -ml-0.5 ${task.is_completed ? 'pointer-events-none' : ''}`}
              onClick={() => {if (!task.is_completed) setIsEditingPriority(true);}}
              title={`Priority: ${currentPriority || 'N/A'}`}
            >
              {priorityStyles.icon} 
              <span className={`ml-0.5 text-xs ${priorityStyles.textClass} ${task.is_completed ? 'text-gray-500' : ''}`}>{currentPriority || 'No Priority'}</span>
            </div>
          )}
           {project && (
            <span 
              className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer truncate"
              title={`Go to project: ${project.name}`}
              onClick={handleProjectClick}
            >
              Proj: {project.name}
            </span>
          )}
          <span className="text-gray-400 text-2xs whitespace-nowrap hidden sm:inline-block" title={`Last updated: ${task.updated_at ? format(parseISO(task.updated_at), 'Pp') : 'N/A'}`}>
              {updatedAgo}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function StandaloneTaskList({ allUserTasks, projects, onTaskUpdateNeeded, hideBillStakeholder }) {
  const [isLoading, setIsLoading] = useState(true);
  const { targetProjectId, setTargetProjectId, actionedProjectIdRef } = useTargetProject();

  useEffect(() => {
    if (allUserTasks) {
      setIsLoading(false);
    }
  }, [allUserTasks]);

  const sortedAndGroupedTasks = useMemo(() => {
    if (!allUserTasks) return {};

    const today = startOfDay(new Date());
    const tomorrow = startOfDay(addDays(today, 1));
    const endOfThisWeek = endOfWeek(today, { weekStartsOn: 1 }); // Assuming Monday is the start of the week

    const filteredTasks = allUserTasks.filter(task => !task.is_completed);

    // Sort tasks first by priority (descending), then by due date (ascending)
    const sortedTasks = filteredTasks.sort((a, b) => {
      const priorityA = getPriorityValue(a.priority);
      const priorityB = getPriorityValue(b.priority);

      if (priorityA !== priorityB) {
        return priorityB - priorityA; // Higher priority value first
      }

      // If priorities are the same, sort by due date (ascending, nulls last)
      const dateA = a.due_date ? parseISO(a.due_date) : null;
      const dateB = b.due_date ? parseISO(b.due_date) : null;

      if (dateA && dateB) {
        return compareAsc(dateA, dateB);
      }
      if (dateA) return -1; // dateA is not null, dateB is null, so A comes first
      if (dateB) return 1;  // dateB is not null, dateA is null, so B comes first
      return 0; // Both are null
    });

    const groups = {
      overdue: [],
      today: [],
      tomorrow: [],
      thisWeek: [],
      // noDueDate: [], // No longer showing tasks beyond this week or without due date
    };

    sortedTasks.forEach(task => {
      if (task.is_completed) return; // Should already be filtered, but as a safeguard

      const dueDate = task.due_date ? startOfDay(parseISO(task.due_date)) : null;

      if (dueDate) {
        if (isPast(dueDate) && !isToday(dueDate)) {
          groups.overdue.push(task);
        } else if (isToday(dueDate)) {
          groups.today.push(task);
        } else if (isTomorrow(dueDate)) {
          groups.tomorrow.push(task);
        } else if (isWithinInterval(dueDate, { start: addDays(tomorrow, 1), end: endOfThisWeek })) {
          groups.thisWeek.push(task);
        }
        // Tasks due later than this week are intentionally not shown
      } else {
        // Tasks with no due date are intentionally not shown based on previous requirements
        // groups.noDueDate.push(task);
      }
    });

    // The tasks within each group are already sorted by priority then due_date
    // because the initial `sortedTasks` array was sorted this way before grouping.
    // No need to re-sort each group individually if the overall list is pre-sorted correctly.

    return groups;
  }, [allUserTasks]);

  const groupOrder = ['overdue', 'today', 'tomorrow', 'thisWeek'];
  const groupLabels = {
    overdue: 'Overdue',
    today: 'Today',
    tomorrow: 'Tomorrow',
    thisWeek: 'This Week',
  };

  const hasTasksToShow = groupOrder.some(key => sortedAndGroupedTasks[key] && sortedAndGroupedTasks[key].length > 0);

  if (!hasTasksToShow) {
    return (
      <div className="bg-white shadow rounded-lg h-full flex items-center justify-center p-4">
        <p className="text-sm text-gray-500">No upcoming tasks.</p>
      </div>
    );
  }

  return (
    <div className="bg-white shadow rounded-lg h-full overflow-y-auto">
      <h3 className="text-lg font-semibold text-gray-800 p-3 border-b border-gray-200 sticky top-0 bg-white z-10">Upcoming Tasks</h3>
      {groupOrder.map(groupKey => (
        sortedAndGroupedTasks[groupKey] && sortedAndGroupedTasks[groupKey].length > 0 && (
          <div key={groupKey} className="pt-2">
            <h4 className="text-xs font-semibold uppercase text-gray-500 px-3 py-1 bg-gray-50 border-t border-b border-gray-200">{groupLabels[groupKey]}</h4>
            <div className="divide-y divide-gray-100">
              {sortedAndGroupedTasks[groupKey].map(task => (
                <StandaloneTaskItem 
                  key={task.id} 
                  task={task} 
                  project={projects.find(p => p.id === task.project_id)} 
                  onTaskUpdated={onTaskUpdateNeeded} 
                />
              ))}
            </div>
          </div>
        )
      ))}
    </div>
  );
} 