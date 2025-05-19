'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { differenceInDays, format, isToday, isTomorrow, isPast, startOfDay, formatDistanceToNowStrict, parseISO } from 'date-fns';
import { supabase } from '@/lib/supabaseClient';
import { quickPickOptions } from '@/lib/dateUtils';
import { ChatBubbleLeftEllipsisIcon, PencilIcon } from '@heroicons/react/24/outline';
import NoteList from '@/components/Notes/NoteList';
import AddNoteForm from '@/components/Notes/AddNoteForm';

// Helper to get priority styling
const getTaskPriorityClasses = (priority) => {
  switch (priority) {
    case 'High':
      return 'border-l-2 border-red-400 bg-red-50';
    case 'Medium':
      return 'border-l-2 border-yellow-400 bg-yellow-50';
    case 'Low':
      return 'border-l-2 border-green-400 bg-green-50';
    default:
      return 'border-l-2 border-gray-300 bg-gray-50';
  }
};

// Helper for due date status
const getTaskDueDateStatus = (dateString, isEditing = false, currentDueDate = '') => {
  const dateToConsider = isEditing && currentDueDate ? currentDueDate : dateString;
  if (!dateToConsider) return { text: 'No due date', classes: 'text-gray-400 text-xs' };
  
  // Ensure dateToConsider is treated as local date for formatting by adding time if not present
  // Input type="date" returns "YYYY-MM-DD"
  let date;
  if (typeof dateToConsider === 'string' && dateToConsider.match(/^\\d{4}-\\d{2}-\\d{2}$/)) {
    date = startOfDay(new Date(dateToConsider + 'T00:00:00')); // Treat as local
  } else {
    date = startOfDay(new Date(dateToConsider));
  }

  const today = startOfDay(new Date());
  const daysDiff = differenceInDays(date, today);
  let text = `Due: ${format(date, 'MMM d, yyyy')}`;
  let classes = 'text-gray-600 text-xs';
  if (isToday(date)) {
    text = `Due: Today`;
    classes = 'text-red-500 font-semibold text-xs';
  } else if (isTomorrow(date)) {
    text = `Due: Tomorrow`;
    classes = 'text-yellow-500 font-semibold text-xs';
  } else if (isPast(date) && !isToday(date)) { // Ensure overdue is not also today
    text = `Overdue: ${format(date, 'MMM d, yyyy')}`;
    classes = 'text-red-600 font-semibold text-xs';
  } else if (daysDiff > 0 && daysDiff <= 7) {
    text = `Due in ${daysDiff}d (${format(date, 'MMM d')})`;
  }
  return { text, classes };
};

export default function TaskItem({ task, onTaskUpdated }) {
  // All useState hooks
  const [isCompleted, setIsCompleted] = useState(task ? task.is_completed : false);
  const [isUpdatingTask, setIsUpdatingTask] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState([]);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);
  const [isEditingTaskName, setIsEditingTaskName] = useState(false);
  const [currentTaskName, setCurrentTaskName] = useState(task ? task.name : '');
  const [isEditingTaskDescription, setIsEditingTaskDescription] = useState(false);
  const [currentTaskDescription, setCurrentTaskDescription] = useState(task ? task.description || '' : '');
  const [isEditingDueDate, setIsEditingDueDate] = useState(false);
  const [currentDueDate, setCurrentDueDate] = useState(task && task.due_date ? format(new Date(task.due_date), 'yyyy-MM-dd') : '');

  // All useEffect and useCallback hooks
  useEffect(() => {
    if (task) {
        setIsCompleted(task.is_completed);
        setCurrentTaskName(task.name);
        setCurrentTaskDescription(task.description || '');
        setCurrentDueDate(task.due_date ? format(new Date(task.due_date), 'yyyy-MM-dd') : '');
        if (isEditingTaskName && task.name !== currentTaskName) setIsEditingTaskName(false);
        if (isEditingTaskDescription && (task.description || '') !== currentTaskDescription) setIsEditingTaskDescription(false);
        if (isEditingDueDate && (task.due_date ? format(new Date(task.due_date), 'yyyy-MM-dd') : '') !== currentDueDate) setIsEditingDueDate(false);
    }
  }, [task, currentTaskName, currentTaskDescription, currentDueDate, isEditingTaskName, isEditingTaskDescription, isEditingDueDate]);

  const fetchNotes = useCallback(async () => {
    if (!task || !task.id) return; 
    setIsLoadingNotes(true);
    try {
      const { data, error } = await supabase.from('notes').select('*').eq('task_id', task.id).order('created_at', { ascending: false });
      if (error) throw error;
      setNotes(data || []);
    } catch (error) {
      console.error('Error fetching notes for task:', error);
      setNotes([]);
    } finally {
      setIsLoadingNotes(false);
    }
  }, [task]); 

  useEffect(() => {
    if (showNotes && task && task.id) { 
      fetchNotes();
    }
  }, [showNotes, task, fetchNotes]);
  
  const taskNameInputRef = useRef(null);
  useEffect(() => {
    if (isEditingTaskName && taskNameInputRef.current) {
      taskNameInputRef.current.focus();
    }
  }, [isEditingTaskName]);

  // Early return AFTER all hooks
  if (!task) return null;

  // Helper for priority text (if not already available globally)
  const getPriorityText = (priority) => {
    if (!priority) return 'No Priority';
    return priority;
  };

  const updatedAgo = task.updated_at 
    ? formatDistanceToNowStrict(parseISO(task.updated_at), { addSuffix: true })
    : 'never';

  const handleNoteAdded = (newNote) => {
    setNotes(prevNotes => [newNote, ...prevNotes]);
  };

  const priorityClasses = getTaskPriorityClasses(task.priority);
  // Display due date status using currentDueDate if editing, otherwise task.due_date
  const dueDateStatusToDisplay = getTaskDueDateStatus(isEditingDueDate ? currentDueDate : task.due_date);

  const handleToggleComplete = async () => {
    if (isUpdatingTask || isEditingTaskName || isEditingTaskDescription || isEditingDueDate) return;
    setIsUpdatingTask(true);
    const newCompletedStatus = !isCompleted;
    try {
      const { error } = await supabase.from('tasks').update({ 
        is_completed: newCompletedStatus, 
        completed_at: newCompletedStatus ? new Date().toISOString() : null,
        updated_at: new Date().toISOString() 
      }).eq('id', task.id);
      if (error) {
        console.error('Error updating task status:', error);
        // Potentially revert optimistic UI update here if needed
      } else {
        setIsCompleted(newCompletedStatus); // Optimistic update
        if (onTaskUpdated) onTaskUpdated({ ...task, is_completed: newCompletedStatus, completed_at: newCompletedStatus ? new Date().toISOString() : null });
      }
    } catch (err) {
      console.error('Exception while updating task:', err);
    } finally {
      setIsUpdatingTask(false);
    }
  };

  const handleTaskNameChange = (e) => setCurrentTaskName(e.target.value);
  const handleTaskDescriptionChange = (e) => setCurrentTaskDescription(e.target.value);
  const handleDueDateChange = (e) => setCurrentDueDate(e.target.value);

  const createUpdateHandler = (field, currentValue, originalValue, setter, editSetter, isDate = false) => async () => {
    // Ensure task exists before trying to update
    if (!task) {
        alert('Cannot update: task data is missing.');
        if (editSetter) editSetter(false);
        return;
    }
    const processedValue = isDate ? (currentValue ? currentValue : null) : (currentValue || '').trim();
    const processedOriginalValue = isDate ? (originalValue ? format(new Date(originalValue), 'yyyy-MM-dd') : null) : (originalValue || '').trim();

    if (processedValue === processedOriginalValue) {
      editSetter(false);
      return;
    }
    setIsUpdatingTask(true);
    try {
      const updateObject = { [field]: processedValue, updated_at: new Date().toISOString() };
      // If due date is being cleared, Supabase expects null, not an empty string
      if (isDate && !processedValue) {
          updateObject[field] = null;
      }

      const { data, error } = await supabase.from('tasks').update(updateObject).eq('id', task.id).select().single();
      if (error) throw error;
      if (data) {
        if (onTaskUpdated) onTaskUpdated(data); // Pass the updated task object
        setter(isDate && data[field] ? format(new Date(data[field]), 'yyyy-MM-dd') : data[field]);
      } else {
        alert(`Failed to update task ${field}. No data returned.`);
        setter(originalValue); // Revert on failure
      }
    } catch (err) {
      console.error(`Error updating task ${field}:`, err);
      alert(`Failed to update task ${field}: ${err.message}`);
      setter(isDate && originalValue ? format(new Date(originalValue), 'yyyy-MM-dd') : (originalValue || (isDate ? '' : ''))); 
    } finally {
      editSetter(false);
      setIsUpdatingTask(false);
    }
  };

  const handleTaskNameUpdate = createUpdateHandler('name', currentTaskName, task ? task.name : '', setCurrentTaskName, setIsEditingTaskName);
  const handleTaskDescriptionUpdate = createUpdateHandler('description', currentTaskDescription, task ? task.description : '', setCurrentTaskDescription, setIsEditingTaskDescription);
  const handleDueDateUpdate = createUpdateHandler('due_date', currentDueDate, task ? task.due_date : null, setCurrentDueDate, setIsEditingDueDate, true);

  const createKeyDownHandler = (updateHandler, originalValue, setter, editSetter, isDate = false) => (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { 
        e.preventDefault();
        updateHandler();
    }
    if (e.key === 'Escape') {
      setter(isDate && originalValue ? format(new Date(originalValue), 'yyyy-MM-dd') : (originalValue || (isDate ? '' : '')));
      editSetter(false);
    }
  };
  
  const handleTaskNameInputKeyDown = createKeyDownHandler(handleTaskNameUpdate, task ? task.name : '', setCurrentTaskName, setIsEditingTaskName);
  const handleTaskDescriptionKeyDown = createKeyDownHandler(handleTaskDescriptionUpdate, task ? task.description : '', setCurrentTaskDescription, setIsEditingTaskDescription);
  const handleDueDateInputKeyDown = createKeyDownHandler(handleDueDateUpdate, task ? task.due_date : null, setCurrentDueDate, setIsEditingDueDate, true);

  const itemBaseClasses = "p-1.5 rounded-md shadow-sm mb-1.5 flex flex-col transition-all hover:shadow-md";
  const completedItemVisualClasses = isCompleted ? "opacity-60 hover:opacity-80" : "";
  const editableTextClasses = (isEditState) => `cursor-text hover:bg-gray-100 p-0.5 rounded-sm ${isCompleted && !isEditState ? 'line-through text-gray-500' : 'text-gray-800'}`;

  return (
    <div className={`${itemBaseClasses} ${priorityClasses} ${completedItemVisualClasses}`}>
      <div className="flex flex-col sm:flex-row items-start sm:items-center w-full">
        {/* Checkbox, Task Name & Description */}
        <div className="flex items-start flex-grow min-w-0 mr-2 sm:mr-3">
          <input
            type="checkbox"
            checked={isCompleted}
            onChange={handleToggleComplete}
            disabled={isUpdatingTask || isEditingTaskName || isEditingTaskDescription || isEditingDueDate}
            className="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 mr-2.5 mt-0.5 flex-shrink-0"
          />
          <div className="flex-grow min-w-0">
            {/* Flex container for Name and Description to be on the same line */}
            <div className="flex items-baseline gap-x-1.5">
              {isEditingTaskName ? (
                <input
                  type="text"
                  value={currentTaskName}
                  onChange={handleTaskNameChange}
                  onBlur={handleTaskNameUpdate}
                  onKeyDown={handleTaskNameInputKeyDown}
                  className="text-sm font-medium text-gray-900 border-b border-indigo-500 focus:outline-none focus:ring-0 py-0.5 flex-grow min-w-[50px]"
                  ref={taskNameInputRef}
                />
              ) : (
                <span 
                  onClick={() => !isCompleted && !isEditingTaskDescription && setIsEditingTaskName(true)} 
                  className={`text-sm font-medium ${editableTextClasses(false)} ${isCompleted ? 'line-through' : ''} ${isEditingTaskDescription ? 'cursor-default' : ''} flex-shrink-0`}
                  title={currentTaskName}
                >
                  {currentTaskName || 'Untitled Task'}
                </span>
              )}

              {/* Task Description - In-line with Name (conditionally) */}
              {!isEditingTaskName && (
                isEditingTaskDescription ? (
                  <textarea
                    value={currentTaskDescription}
                    onChange={handleTaskDescriptionChange}
                    onBlur={handleTaskDescriptionUpdate}
                    onKeyDown={handleTaskDescriptionKeyDown}
                    className="text-xs text-gray-600 border-b border-indigo-500 focus:outline-none focus:ring-0 py-0.5 w-full min-h-[2em] resize-none"
                    rows="1"
                    autoFocus
                  />
                ) : (
                  <span 
                    onClick={() => !isCompleted && !isEditingTaskName && setIsEditingTaskDescription(true)} 
                    className={`text-xs text-gray-600 ${editableTextClasses(false)} ${isCompleted ? 'line-through' : ''} ${isEditingTaskName ? 'cursor-default' : ''} truncate`}
                    title={currentTaskDescription}
                  >
                    {currentTaskDescription || (isEditingTaskName ? '' : 'No description')}
                  </span>
                )
              )}
            </div>
          </div>
        </div>

        {/* Priority, Due Date, Notes Toggle & Updated At - flex-shrink-0 to prevent shrinking */}
        <div className="flex items-center space-x-2 sm:space-x-3 text-xs mt-1 sm:mt-0 pl-[2.125rem] sm:pl-0 flex-shrink-0">
          <span className="px-1.5 py-0.5 text-xs font-medium rounded-full bg-opacity-20"
            // Basic color based on priority text for now, can be more specific if needed
            style={{
              backgroundColor: task.priority === 'High' ? 'rgba(239, 68, 68, 0.1)' : 
                               task.priority === 'Medium' ? 'rgba(245, 158, 11, 0.1)' : 
                               task.priority === 'Low' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(107, 114, 128, 0.1)',
              color: task.priority === 'High' ? 'rgb(185, 28, 28)' : 
                     task.priority === 'Medium' ? 'rgb(194, 102, 7)' : 
                     task.priority === 'Low' ? 'rgb(4, 120, 87)' : 'rgb(55, 65, 81)',
            }}
          >
            {getPriorityText(task.priority)}
          </span>

          {isEditingDueDate ? (
            <div className="flex flex-col items-start">
              <input
                type="date"
                value={currentDueDate}
                onChange={handleDueDateChange}
                onBlur={handleDueDateUpdate}
                onKeyDown={handleDueDateInputKeyDown}
                className="text-xs border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 py-1 px-1.5 w-[130px]"
                autoFocus
              />
              <div className="mt-1 grid grid-cols-3 gap-1 w-[130px]">
                  {quickPickOptions.slice(0,3).map(opt => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => {
                        const newDate = opt.getDate();
                        setCurrentDueDate(format(newDate, 'yyyy-MM-dd'));
                      }}
                      className="text-3xs font-medium text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-full py-0.5 px-1 text-center"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
            </div>
          ) : (
            <span 
              onClick={() => !isCompleted && setIsEditingDueDate(true)} 
              className={`${dueDateStatusToDisplay.classes} ${!isCompleted ? 'cursor-pointer hover:text-indigo-700' : ''}`}
              title={dueDateStatusToDisplay.text}
            >
              {dueDateStatusToDisplay.text}
            </span>
          )}
          
          <button onClick={() => setShowNotes(!showNotes)} className="text-gray-400 hover:text-indigo-600">
            <ChatBubbleLeftEllipsisIcon className="h-4 w-4" />
          </button>
          <span className="text-gray-400 text-2xs hidden sm:inline-block" title={`Last updated: ${task.updated_at ? format(parseISO(task.updated_at), 'Pp') : 'N/A'}`}>
            {updatedAgo}
          </span>
        </div>
      </div>

      {/* Notes Section - now takes full width under the main task line */}
      {showNotes && (
        <div className="mt-1.5 w-full pl-6">
          <h4 className="text-xs font-medium text-gray-600 mb-0.5">Notes:</h4>
          {isLoadingNotes ? (
            <p className="text-xs text-gray-500">Loading notes...</p>
          ) : (
            <>
              <AddNoteForm 
                taskId={task.id} 
                onNoteAdded={handleNoteAdded} 
                disabled={isCompleted || isUpdatingTask}
              />
              <NoteList notes={notes} />
            </>
          )}
        </div>
      )}
    </div>
  );
} 