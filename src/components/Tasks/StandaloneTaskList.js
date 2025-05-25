'use client';

import { useState, useEffect, useMemo } from 'react';
import { format, parseISO, startOfDay, differenceInDays, isToday, isTomorrow, isPast, isSameDay, addDays, endOfDay, isWithinInterval, formatDistanceToNowStrict, compareAsc, compareDesc } from 'date-fns';
import { supabase } from '@/lib/supabaseClient';
import { PencilIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { useTargetProject } from '@/contexts/TargetProjectContext';

// Simplified helper for due date status (can be shared or passed if more complex)
const getTaskDueDateStatus = (dateString, isEditing = false, currentDueDate = '') => {
  const dateToConsider = isEditing && currentDueDate ? currentDueDate : dateString;
  if (!dateToConsider) return { text: 'No due date', classes: 'text-gray-600 text-xs', sortKey: Infinity };
  
  let date = startOfDay(parseISO(dateToConsider));
  if (typeof dateToConsider === 'string' && dateToConsider.match(/^\d{4}-\d{2}-\d{2}$/)) {
    date = startOfDay(new Date(dateToConsider + 'T00:00:00'));
  }

  const today = startOfDay(new Date());
  const daysDiff = differenceInDays(date, today);
  let text = `Due: ${format(date, 'MMM d')}`;
  let classes = 'text-gray-700';
  let sortKey = daysDiff;

  if (isToday(date)) {
    text = `Due Today`;
    classes = 'text-red-700 font-bold';
    sortKey = 0;
  } else if (isTomorrow(date)) {
    text = `Due Tomorrow`;
    classes = 'text-yellow-700 font-bold';
    sortKey = 1;
  } else if (isPast(date) && !isToday(date)) {
    text = `Overdue: ${format(date, 'MMM d')}`;
    classes = 'text-red-700 font-bold';
    sortKey = -Infinity + daysDiff;
  } else if (daysDiff < 0) { // Other past dates
     text = `Due ${format(date, 'MMM d')}`;
     classes = 'text-gray-600 italic';
  }
  return { text, classes, sortKey };
};

const getStandaloneTaskPriorityStyling = (priority) => {
  switch (priority) {
    case 'High':
      return 'border-l-4 border-red-700 bg-red-200';
    case 'Medium':
      return 'border-l-4 border-yellow-600 bg-yellow-100';
    case 'Low':
      return 'border-l-4 border-green-700 bg-green-200';
    default:
      return 'border-l-4 border-gray-400 bg-gray-100';
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
      const { data, error } = await supabase
        .from('tasks')
        .update({ name: currentName.trim(), updated_at: new Date().toISOString() })
        .eq('id', task.id)
        .select()
        .single();
      if (error) throw error;
      if (onTaskUpdated) onTaskUpdated(data);
      setIsEditingName(false);
    } catch (err) {
      console.error('Error updating task name:', err);
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
      const { data, error } = await supabase
        .from('tasks')
        .update({ due_date: currentDueDate || null, updated_at: new Date().toISOString() })
        .eq('id', task.id)
        .select()
        .single();
      if (error) throw error;
      if (onTaskUpdated) onTaskUpdated(data);
      setIsEditingDueDate(false);
    } catch (err) {
      console.error('Error updating task due date:', err);
      setCurrentDueDate(originalFormattedDate); // revert
      setIsEditingDueDate(false);
    }
  };

  const handleToggleComplete = async () => {
    const newCompletedStatus = !task.is_completed;
    try {
      const { data, error } = await supabase.from('tasks').update({ 
        is_completed: newCompletedStatus, 
        completed_at: newCompletedStatus ? new Date().toISOString() : null,
        updated_at: new Date().toISOString() 
      }).eq('id', task.id).select().single();
      if (error) throw error;
      if (onTaskUpdated) onTaskUpdated(data);
    } catch (err) {
      console.error('Error updating task status:', err);
    }
  };

  const handlePriorityUpdate = async () => {
    if (currentPriority === (task.priority || '')) {
      setIsEditingPriority(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('tasks')
        .update({ priority: currentPriority || null, updated_at: new Date().toISOString() })
        .eq('id', task.id)
        .select()
        .single();
      if (error) throw error;
      if (onTaskUpdated) onTaskUpdated(data);
      setIsEditingPriority(false);
    } catch (err) {
      console.error('Error updating task priority:', err);
      setCurrentPriority(task.priority || ''); // revert
      setIsEditingPriority(false);
    }
  };

  const priorityColors = {
    High: 'bg-red-600 text-white',
    Medium: 'bg-yellow-500 text-black',
    Low: 'bg-green-600 text-white',
    Default: 'bg-gray-500 text-white' // Added a default for safety
  };

  const itemPriorityClass = getStandaloneTaskPriorityStyling(task.priority);

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
              className="flex-grow text-sm p-0.5 border-b border-indigo-500 focus:outline-none mr-1"
              autoFocus
            />
          ) : (
            <p 
              className={`text-sm font-medium text-gray-800 truncate flex-grow mr-1 ${task.is_completed ? 'line-through' : 'cursor-text hover:bg-gray-100'}`}
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
              <CheckCircleIcon className="h-5 w-5 text-green-500" title="Completed" />
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
                  className={`${dueDateInfo.classes} ${!task.is_completed ? 'cursor-text hover:bg-gray-100 rounded px-0.5 -mx-0.5' : ''}`}
                  onClick={() => !task.is_completed && setIsEditingDueDate(true)}
                  title={task.due_date ? format(parseISO(task.due_date), 'MMM d, yyyy') : 'No due date'}
              >
                  {dueDateInfo.text}
              </span>
          )}
          {isEditingPriority ? (
            <select
              value={currentPriority}
              onChange={(e) => setCurrentPriority(e.target.value)}
              onBlur={handlePriorityUpdate}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handlePriorityUpdate();
                if (e.key === 'Escape') {
                  setCurrentPriority(task.priority || '');
                  setIsEditingPriority(false);
                }
              }}
              className="text-xs border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 py-0.5 px-1"
              autoFocus
            >
              <option value="">No Priority</option>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          ) : (
            task.priority && (
              <span 
                className={`px-1.5 py-0.5 rounded-full whitespace-nowrap text-2xs ${priorityColors[task.priority] || priorityColors.Default} ${!task.is_completed ? 'cursor-pointer hover:opacity-80' : ''}`}
                onClick={() => !task.is_completed && setIsEditingPriority(true)}
                title={task.priority}
              >
                {task.priority}
              </span>
            )
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
  const projectMap = useMemo(() => 
    projects.reduce((map, p) => {
      map[p.id] = p;
      return map;
    }, {}), 
  [projects]);

  const groupedAndSortedTasks = useMemo(() => {
    const groups = {
      overdue: [],
      today: [],
      thisWeek: [],
      later: [],
      noDueDate: [],
    };

    const today = startOfDay(new Date());
    const endOfThisWeek = endOfDay(addDays(today, 6 - today.getDay())); // Assuming week starts Sunday for getDay()

    allUserTasks.forEach(task => {
      if (task.is_completed) {
        return; // Skip completed tasks from all active groups
      }

      // Filter out tasks belonging to projects where Bill is a stakeholder, if the filter is active
      if (hideBillStakeholder) {
        const parentProject = projectMap[task.project_id];
        if (parentProject && parentProject.stakeholders && parentProject.stakeholders.includes('Bill')) {
          return; // Skip this task
        }
      }

      if (!task.due_date) {
        groups.noDueDate.push(task);
        return;
      }
      
      let dueDate;
      // Ensure dueDate is parsed correctly, similar to getTaskDueDateStatus
      if (typeof task.due_date === 'string' && task.due_date.match(/^\d{4}-\d{2}-\d{2}$/)) {
        dueDate = startOfDay(new Date(task.due_date + 'T00:00:00'));
      } else {
        dueDate = startOfDay(parseISO(task.due_date));
      }

      if (isPast(dueDate) && !isSameDay(dueDate, today)) { // isPast and not today
        groups.overdue.push(task);
      } else if (isSameDay(dueDate, today)) { // isToday
        groups.today.push(task);
      } else if (isWithinInterval(dueDate, { start: addDays(today, 1), end: endOfThisWeek })) {
        groups.thisWeek.push(task);
      } else { // Later (beyond this week or future dates without specific group yet)
        groups.later.push(task);
      }
    });

    // Sort tasks within each group: Due Date (Desc), then Priority (High-Low)
    for (const groupName in groups) {
      groups[groupName].sort((a, b) => {
        // Primary sort: Due Date (Descending - recent first)
        const dateA = a.due_date ? parseISO(a.due_date) : null;
        const dateB = b.due_date ? parseISO(b.due_date) : null;

        if (dateA === null && dateB === null) {
          // If both dates are null, sort by priority
          return getPriorityValue(b.priority) - getPriorityValue(a.priority);
        }
        if (dateA === null) return 1; // Null dates come after non-null dates
        if (dateB === null) return -1; // Non-null dates come before null dates

        const dateComparison = compareDesc(dateA, dateB);
        if (dateComparison !== 0) return dateComparison;

        // Secondary sort: Priority (High to Low)
        return getPriorityValue(b.priority) - getPriorityValue(a.priority);
      });
    }
    return groups;
  }, [allUserTasks, projectMap, hideBillStakeholder]);

  const groupOrder = ['overdue', 'today', 'thisWeek', 'later', 'noDueDate'];
  const groupLabels = {
    overdue: 'Overdue',
    today: 'Today',
    thisWeek: 'This Week',
    later: 'Later',
    noDueDate: 'No Due Date',
  };

  const hasTasksToShow = groupOrder.some(key => groupedAndSortedTasks[key] && groupedAndSortedTasks[key].length > 0);

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
        groupedAndSortedTasks[groupKey] && groupedAndSortedTasks[groupKey].length > 0 && (
          <div key={groupKey} className="pt-2">
            <h4 className="text-xs font-semibold uppercase text-gray-500 px-3 py-1 bg-gray-50 border-t border-b border-gray-200">{groupLabels[groupKey]}</h4>
            <div className="divide-y divide-gray-100">
              {groupedAndSortedTasks[groupKey].map(task => (
                <StandaloneTaskItem 
                  key={task.id} 
                  task={task} 
                  project={projectMap[task.project_id]} 
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