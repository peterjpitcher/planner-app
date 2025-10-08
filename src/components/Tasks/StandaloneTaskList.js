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
  if (!dateToConsider) return { text: 'No due date', classes: 'text-slate-400 text-xs', sortKey: Infinity, fullDate: '' };
  
  let date = startOfDay(parseISO(dateToConsider));
  if (typeof dateToConsider === 'string' && dateToConsider.match(/^\d{4}-\d{2}-\d{2}$/)) {
    date = startOfDay(new Date(dateToConsider + 'T00:00:00'));
  }

  const today = startOfDay(new Date());
  const daysDiff = differenceInDays(date, today);
  let text = `Due: ${format(date, 'EEEE, MMM do')}`;
  let classes = 'text-slate-600';
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
  } else if (daysDiff < 0) { // Other past dates (should be covered by isPast)
     text = `Due ${format(date, 'EEEE, MMM do')}`;
     classes = 'text-slate-500 italic';
  } else if (daysDiff >= 0 && daysDiff <= 7) { // Changed from "Due in Xd (DayOfWeek)"
    text = `Due: ${format(date, 'EEEE, MMM do')}`; 
  }
  return { text, classes, sortKey, fullDate: fullDateText };
};

const getStandaloneTaskPriorityStyling = (priority) => {
  // Returns icon, text color, and card background/border color
  switch (priority) {
    case 'High':
      return { icon: <SolidFireIcon className="h-4 w-4 text-red-400" />, textClass: 'text-red-500 font-semibold', cardOuterClass: 'border-red-200/70 bg-white/85 shadow-[0_20px_45px_-28px_rgba(239,68,68,0.5)]', badgeClass: 'bg-red-500/90 text-white', glowClass: 'bg-red-400/40', ribbonClass: 'from-red-400/60 via-red-300/25 to-transparent' };
    case 'Medium':
      return { icon: <SolidExclamationTriangleIcon className="h-4 w-4 text-amber-400" />, textClass: 'text-amber-500 font-semibold', cardOuterClass: 'border-amber-200/60 bg-white/85 shadow-[0_20px_45px_-28px_rgba(245,158,11,0.4)]', badgeClass: 'bg-amber-400/90 text-slate-900', glowClass: 'bg-amber-400/35', ribbonClass: 'from-amber-400/50 via-amber-300/20 to-transparent' };
    case 'Low':
      return { icon: <SolidCheckIcon className="h-4 w-4 text-emerald-400" />, textClass: 'text-emerald-500', cardOuterClass: 'border-emerald-200/60 bg-white/85 shadow-[0_20px_45px_-28px_rgba(16,185,129,0.35)]', badgeClass: 'bg-emerald-500/85 text-white', glowClass: 'bg-emerald-300/35', ribbonClass: 'from-emerald-400/50 via-emerald-300/20 to-transparent' };
    default:
      return { icon: <SolidClockIcon className="h-4 w-4 text-[#2f617a]" />, textClass: 'text-[#2f617a]', cardOuterClass: 'border-slate-200/70 bg-white/85 shadow-[0_20px_45px_-30px_rgba(4,150,199,0.25)]', badgeClass: 'bg-[#0496c7]/15 text-[#036586]', glowClass: 'bg-[#0496c7]/18', ribbonClass: 'from-[#0496c7]/18 via-[#5bd2c1]/12 to-transparent' };
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
    <div className={`group relative mx-auto flex w-full max-w-[18.5rem] items-start gap-3 rounded-2xl border border-slate-200/70 bg-white/90 px-4 py-3 shadow-[0_24px_50px_-32px_rgba(4,150,199,0.35)] transition-all sm:mx-0 sm:max-w-[24rem] ${itemPriorityClass} ${task.is_completed ? 'opacity-60 saturate-75' : 'hover:-translate-y-0.5 hover:shadow-[0_34px_60px_-30px_rgba(4,150,199,0.45)]'}`}>
      <input 
        type="checkbox" 
        checked={task.is_completed}
        onChange={handleToggleComplete}
        className="mt-0.5 h-4 w-4 text-indigo-600 border-slate-300/80 rounded focus:ring-indigo-500 flex-shrink-0"
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
              className={`text-sm font-medium leading-snug text-slate-900 flex-grow mr-1 ${task.is_completed ? 'line-through' : 'cursor-text hover:bg-slate-100'} break-words`}
              onClick={() => !task.is_completed && setIsEditingName(true)}
              title={currentName}
            >
              {currentName}
            </p>
          )}
          <div className="flex-shrink-0 flex items-center">
            {!task.is_completed && !isEditingName && !isEditingDueDate && !isEditingPriority && (
              <PencilIcon 
                  className="h-4 w-4 text-[#2f617a]/70 hover:text-[#0496c7] cursor-pointer"
                  onClick={() => setIsEditingName(true)}
                  title="Edit task"
              />
            )}
            {task.is_completed && (
              <SolidCheckIcon className="h-5 w-5 text-emerald-500" title="Completed" />
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
                  className={`${dueDateInfo.classes} ${!task.is_completed ? 'cursor-text hover:bg-slate-100 rounded px-0.5 -mx-0.5' : ''} break-words`}
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
              className={`flex items-center cursor-pointer hover:bg-slate-100/60 p-0.5 rounded-full -ml-0.5 ${task.is_completed ? 'pointer-events-none' : ''}`}
              onClick={() => {if (!task.is_completed) setIsEditingPriority(true);}}
              title={`Priority: ${currentPriority || 'N/A'}`}
              aria-label={`Priority ${currentPriority || 'none'}`}
            >
              <span className="sr-only">{`Priority ${currentPriority || 'none'}`}</span>
              {priorityStyles.icon} 
            </div>
          )}
           {project && (
            <span 
              className="text-indigo-500 hover:text-indigo-600 hover:underline cursor-pointer truncate"
              title={`Go to project: ${project.name}`}
              onClick={handleProjectClick}
            >
              Proj: {project.name}
            </span>
          )}
          <span className="text-[#2f617a]/70 text-2xs whitespace-nowrap hidden sm:inline-block" title={`Last updated: ${task.updated_at ? format(parseISO(task.updated_at), 'Pp') : 'N/A'}`}>
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

    const billRegex = /\bbill\b/i;
    const projectIdsToExclude = hideBillStakeholder
      ? new Set(
          (projects || [])
            .filter(project => billRegex.test((project.stakeholders || []).join(' ')))
            .map(project => project.id)
        )
      : null;

    const filteredTasks = allUserTasks.filter(task => {
      if (task.is_completed) return false;
      if (!hideBillStakeholder || !projectIdsToExclude) return true;
      if (!task.project_id) return true;
      return !projectIdsToExclude.has(task.project_id);
    });

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
  }, [allUserTasks, projects, hideBillStakeholder]);

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
      <div className="flex h-full items-center justify-center rounded-3xl border border-[#0496c7]/20 bg-white/85 p-6 text-sm text-[#2f617a] shadow-inner shadow-[#0496c7]/15">
        No upcoming tasks.
      </div>
    );
  }

  return (
    <div className="flex max-h-full flex-col items-center gap-6 overflow-y-auto pb-3 sm:items-stretch">
      {groupOrder.map(groupKey => {
        const tasks = sortedAndGroupedTasks[groupKey];
        if (!tasks || tasks.length === 0) return null;
        return (
          <div key={groupKey} className="space-y-3">
            <div className="flex items-center justify-between px-1 text-xs uppercase tracking-[0.18em] text-[#036586]/80">
              <span>{groupLabels[groupKey]}</span>
              <span className="rounded-full border border-[#0496c7]/20 px-2 py-0.5 text-[10px] font-semibold text-[#036586]">
                {tasks.length}
              </span>
            </div>
            <div className="flex flex-col items-center gap-4 sm:items-stretch sm:gap-4">
              {tasks.map(task => (
                <StandaloneTaskItem
                  key={task.id}
                  task={task}
                  project={projects.find(p => p.id === task.project_id)}
                  onTaskUpdated={onTaskUpdateNeeded}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
} 
