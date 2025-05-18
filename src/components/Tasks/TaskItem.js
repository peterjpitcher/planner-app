'use client';

import { useState, useEffect, useCallback } from 'react';
import { differenceInDays, format, isToday, isTomorrow, isPast, startOfDay, formatDistanceToNowStrict, parseISO } from 'date-fns';
import { supabase } from '@/lib/supabaseClient';
import { ChatBubbleLeftEllipsisIcon, PencilIcon } from '@heroicons/react/24/outline';
import NoteList from '@/components/Notes/NoteList';
import AddNoteForm from '@/components/Notes/AddNoteForm';

// Helper to get priority styling
const getTaskPriorityClasses = (priority) => {
  switch (priority) {
    case 'High':
      return 'border-l-2 border-red-400 bg-red-50/50';
    case 'Medium':
      return 'border-l-2 border-yellow-400 bg-yellow-50/50';
    case 'Low':
      return 'border-l-2 border-green-400 bg-green-50/50';
    default:
      return 'border-l-2 border-gray-300 bg-gray-50/50';
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
                  autoFocus
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
                    className="ml-1 block w-full text-xs border-gray-300 rounded-md shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50 p-1 resize-none flex-grow min-w-[100px]"
                    rows="1" 
                    autoFocus
                    placeholder="Description..."
                  />
                ) : currentTaskDescription ? (
                  <p 
                    onClick={() => !isCompleted && !isEditingTaskName && setIsEditingTaskDescription(true)}
                    className={`text-xs text-gray-500 italic truncate max-w-[200px] sm:max-w-[300px] ${editableTextClasses(false)} ${isCompleted ? 'line-through' : ''} flex-shrink min-w-0`}
                    title={currentTaskDescription}
                  >
                    - {currentTaskDescription}
                  </p>
                ) : !isCompleted && (
                   <span onClick={() => !isEditingTaskName && setIsEditingTaskDescription(true)} className={`text-xs text-gray-400 italic ${editableTextClasses(false)} flex-shrink-0`}>
                      - add description
                   </span>
                )
              )}
            </div>
          </div>
        </div>

        {/* Priority, Due Date, and Edit Icons Container */}
        <div className="flex items-center space-x-1.5 sm:space-x-2 mt-1 sm:mt-0 flex-shrink-0 self-start sm:self-center pl-6 sm:pl-0">
          {/* Priority Display */}
          <span className={`text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap ${
            task.priority === 'High' ? 'bg-red-100 text-red-700' :
            task.priority === 'Medium' ? 'bg-yellow-100 text-yellow-700' :
            task.priority === 'Low' ? 'bg-green-100 text-green-700' :
            'bg-gray-100 text-gray-600'
          }`}>
            {getPriorityText(task.priority)}
          </span>

          {/* Due Date Display/Edit */}
          {isEditingDueDate ? (
            <div className="flex items-center">
              <input
                type="date"
                value={currentDueDate}
                onChange={handleDueDateChange}
                onBlur={handleDueDateUpdate}
                onKeyDown={handleDueDateInputKeyDown}
                className="text-2xs border-gray-300 rounded-md shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50 py-0.5 px-1"
                autoFocus
              />
            </div>
          ) : (
            <div 
              className={`flex items-center cursor-pointer hover:bg-gray-100 p-0.5 rounded-sm group ${dueDateStatusToDisplay.classes}`}
              onClick={() => !isCompleted && setIsEditingDueDate(true)}
              title={`Due date: ${task.due_date ? format(new Date(task.due_date), 'MMM d, yyyy') : 'Not set'}`}
            >
              <span className="text-2xs">{dueDateStatusToDisplay.text}</span>
              {!isCompleted && (
                <PencilIcon className="h-2.5 w-2.5 ml-0.5 text-gray-400 group-hover:text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
            </div>
          )}

          {/* Last Updated Timestamp */}
          <span className="text-2xs text-gray-400 whitespace-nowrap" title={`Last updated: ${task.updated_at ? format(parseISO(task.updated_at), 'Pp') : 'N/A'}`}>
            {updatedAgo}
          </span>

          {/* Notes Toggle Icon - smaller */}
          <button 
            onClick={() => setShowNotes(!showNotes)}
            className="p-0.5 rounded-full hover:bg-gray-200 text-gray-500 hover:text-indigo-600 transition-colors"
            title={showNotes ? "Hide Notes" : "Show Notes"}
          >
            <ChatBubbleLeftEllipsisIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </button>
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