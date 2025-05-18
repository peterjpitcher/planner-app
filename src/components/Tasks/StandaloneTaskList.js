'use client';

import { useState, useEffect, useMemo } from 'react';
import { format, parseISO, startOfDay, differenceInDays, isToday, isTomorrow, isPast, isSameDay, addDays, endOfDay, isWithinInterval, formatDistanceToNowStrict } from 'date-fns';
import { supabase } from '@/lib/supabaseClient';
import { PencilIcon, CheckCircleIcon } from '@heroicons/react/24/outline';

// Simplified helper for due date status (can be shared or passed if more complex)
const getTaskDueDateStatus = (dateString, isEditing = false, currentDueDate = '') => {
  const dateToConsider = isEditing && currentDueDate ? currentDueDate : dateString;
  if (!dateToConsider) return { text: 'No due date', classes: 'text-gray-500 text-xs', sortKey: Infinity };
  
  let date = startOfDay(parseISO(dateToConsider));
  if (typeof dateToConsider === 'string' && dateToConsider.match(/^\\d{4}-\\d{2}-\\d{2}$/)) {
    date = startOfDay(new Date(dateToConsider + 'T00:00:00'));
  }

  const today = startOfDay(new Date());
  const daysDiff = differenceInDays(date, today);
  let text = `Due: ${format(date, 'MMM d')}`;
  let classes = 'text-gray-600 text-xs';
  let sortKey = daysDiff;

  if (isToday(date)) {
    text = `Due Today`;
    classes = 'text-red-500 font-semibold text-xs';
    sortKey = 0;
  } else if (isTomorrow(date)) {
    text = `Due Tomorrow`;
    classes = 'text-yellow-500 font-semibold text-xs';
    sortKey = 1;
  } else if (isPast(date) && !isToday(date)) {
    text = `Overdue: ${format(date, 'MMM d')}`;
    classes = 'text-red-600 font-semibold text-xs';
    sortKey = -Infinity + daysDiff; // Make overdue items sort earliest among past items
  } else if (daysDiff < 0) { // Other past dates
     text = `Due ${format(date, 'MMM d')}`;
     classes = 'text-gray-500 text-xs italic'; // less prominent for past items that aren't strictly overdue today/tomorrow
  }
  return { text, classes, sortKey };
};

const getStandaloneTaskPriorityStyling = (priority) => {
  switch (priority) {
    case 'High':
      return 'border-l-2 border-red-400 bg-red-50';
    case 'Medium':
      return 'border-l-2 border-yellow-400 bg-yellow-50';
    case 'Low':
      return 'border-l-2 border-green-400 bg-green-50';
    default:
      return 'border-l-2 border-gray-300 bg-gray-50'; // Default style for tasks without a known priority or other cases
  }
};

const getPriorityValue = (priority) => {
    switch (priority) {
      case 'High': return 1;
      case 'Medium': return 2;
      case 'Low': return 3;
      default: return 4;
    }
};

function StandaloneTaskItem({ task, project, onTaskUpdated }) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [currentName, setCurrentName] = useState(task.name);
  const [isEditingDueDate, setIsEditingDueDate] = useState(false);
  const [currentDueDate, setCurrentDueDate] = useState(task.due_date ? format(parseISO(task.due_date), 'yyyy-MM-dd') : '');
  // No priority editing in this simple list for now, just display

  useEffect(() => {
    setCurrentName(task.name);
    setCurrentDueDate(task.due_date ? format(parseISO(task.due_date), 'yyyy-MM-dd') : '');
  }, [task]);

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

  const priorityColors = {
    High: 'bg-red-100 text-red-700',
    Medium: 'bg-yellow-100 text-yellow-700',
    Low: 'bg-green-100 text-green-700',
  };

  const itemPriorityClass = getStandaloneTaskPriorityStyling(task.priority);

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
            {!task.is_completed && !isEditingName && !isEditingDueDate && (
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
          {task.priority && (
              <span className={`px-1.5 py-0.5 rounded-full whitespace-nowrap text-2xs ${priorityColors[task.priority] || 'bg-gray-100 text-gray-600'}`}>
                  {task.priority}
              </span>
          )}
           {project && (
            <span className="text-gray-500 truncate" title={`Project: ${project.name}`}>
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

export default function StandaloneTaskList({ allUserTasks, projects, onTaskUpdateNeeded }) {
  const projectMap = useMemo(() => 
    projects.reduce((map, p) => {
      map[p.id] = p;
      return map;
    }, {}), 
  [projects]);

  const groupedAndSortedTasks = useMemo(() => {
    if (!allUserTasks) return {};

    const today = startOfDay(new Date());
    const endOfToday = endOfDay(today);
    const startOfTomorrow = addDays(today, 1);
    const endOfThisWeek = endOfDay(addDays(today, 7)); // End of 7 days from today

    const groups = {
      overdue: [],
      today: [],
      thisWeek: [],
      later: [],
      noDate: [],
    };

    const sorted = [...allUserTasks]
      .filter(task => !task.is_completed)
      .sort((a, b) => { // Pre-sort for consistent order within groups
        const dueDateA = a.due_date ? parseISO(a.due_date) : null;
        const dueDateB = b.due_date ? parseISO(b.due_date) : null;
        const priorityA = getPriorityValue(a.priority);
        const priorityB = getPriorityValue(b.priority);
        if (dueDateA && dueDateB) {
          if (dueDateA < dueDateB) return -1;
          if (dueDateA > dueDateB) return 1;
        } else if (dueDateA) return -1;
        else if (dueDateB) return 1;
        if (priorityA !== priorityB) return priorityA - priorityB;
        return 0;
      });

    sorted.forEach(task => {
      if (!task.due_date) {
        groups.noDate.push(task);
      } else {
        const dueDate = startOfDay(parseISO(task.due_date));
        if (isPast(dueDate) && !isSameDay(dueDate, today)) {
          groups.overdue.push(task);
        } else if (isSameDay(dueDate, today)) {
          groups.today.push(task);
        } else if (isWithinInterval(dueDate, { start: startOfTomorrow, end: endOfThisWeek })) {
          groups.thisWeek.push(task);
        } else {
          groups.later.push(task);
        }
      }
    });
    return groups;
  }, [allUserTasks]);

  const groupOrder = ['overdue', 'today', 'thisWeek', 'later', 'noDate'];
  const groupLabels = {
    overdue: 'Overdue',
    today: 'Today',
    thisWeek: 'This Week',
    later: 'Later',
    noDate: 'No Due Date',
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