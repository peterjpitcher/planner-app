'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { differenceInDays, format, isToday, isTomorrow, isPast, startOfDay, formatDistanceToNowStrict, parseISO } from 'date-fns';
import { useSupabase } from '@/contexts/SupabaseContext';
import { quickPickOptions } from '@/lib/dateUtils';
import { handleSupabaseError, handleError } from '@/lib/errorHandler';
import { ChatBubbleLeftEllipsisIcon, PencilIcon } from '@heroicons/react/24/outline';
import { FireIcon, ExclamationTriangleIcon, CheckCircleIcon, ClockIcon } from '@heroicons/react/20/solid';
import NoteList from '@/components/Notes/NoteList';
import AddNoteForm from '@/components/Notes/AddNoteForm';

// Helper to get priority styling
const getTaskPriorityClasses = (priority) => {
  // Returns icon, text color, and badge background/text color
  switch (priority) {
    case 'High':
      return { icon: <FireIcon className="h-4 w-4 text-red-500" />, textClass: 'text-red-600 font-semibold', cardOuterClass: 'border-l-4 border-red-700 bg-red-200', badgeClass: 'bg-red-600 text-white' };
    case 'Medium':
      return { icon: <ExclamationTriangleIcon className="h-4 w-4 text-yellow-500" />, textClass: 'text-yellow-600 font-semibold', cardOuterClass: 'border-l-4 border-yellow-600 bg-yellow-100', badgeClass: 'bg-yellow-500 text-black' };
    case 'Low':
      return { icon: <CheckCircleIcon className="h-4 w-4 text-green-500" />, textClass: 'text-green-600', cardOuterClass: 'border-l-4 border-green-700 bg-green-200', badgeClass: 'bg-green-600 text-white' };
    default:
      return { icon: <ClockIcon className="h-4 w-4 text-gray-400" />, textClass: 'text-gray-500', cardOuterClass: 'border-l-4 border-gray-400 bg-gray-100', badgeClass: 'bg-gray-500 text-white' };
  }
};

// Helper for due date status
const getTaskDueDateStatus = (dateString, isEditing = false, currentDueDate = '') => {
  const dateToConsider = isEditing && currentDueDate ? currentDueDate : dateString;
  if (!dateToConsider) return { text: 'No due date', classes: 'text-gray-600 text-xs', fullDate: '' };
  
  let date;
  if (typeof dateToConsider === 'string' && dateToConsider.match(/^\d{4}-\d{2}-\d{2}$/)) {
    date = startOfDay(new Date(dateToConsider + 'T00:00:00'));
  } else {
    date = startOfDay(new Date(dateToConsider));
  }

  const today = startOfDay(new Date());
  const daysDiff = differenceInDays(date, today);
  let text = `Due: ${format(date, 'EEEE, MMM do')}`; // Default format
  let classes = 'text-gray-700 text-xs';
  const fullDateText = format(date, 'EEEE, MMM do, yyyy'); // For tooltips

  if (isToday(date)) {
    text = `Due: Today`;
    classes = 'text-red-700 font-bold text-xs';
  } else if (isTomorrow(date)) {
    text = `Due: Tomorrow`;
    classes = 'text-yellow-700 font-bold text-xs';
  } else if (isPast(date) && !isToday(date)) {
    text = `Overdue: ${format(date, 'EEEE, MMM do')}`;
    classes = 'text-red-700 font-bold text-xs';
  } else if (daysDiff < 0) { // Other past dates (should be covered by isPast)
    text = `Due ${format(date, 'EEEE, MMM do')}`;
    classes = 'text-gray-600 italic text-xs';
  } else if (daysDiff >= 0 && daysDiff <= 7) {
    text = `Due: ${format(date, 'EEEE, MMM do')}`;
  } // For future dates beyond 7 days, text remains `Due: EEEE, MMM do` and classes remain default
  
  return { text, classes, fullDate: fullDateText };
};

function TaskItem({ task, onTaskUpdated }) {
  const supabase = useSupabase();
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
  const [isEditingPriority, setIsEditingPriority] = useState(false);
  const [currentPriority, setCurrentPriority] = useState(task ? task.priority || '' : '');
  const noteInputRef = useRef(null); // Ref for the note input

  // All useEffect and useCallback hooks
  useEffect(() => {
    if (task) {
        // Always update non-editable fields like completion status directly from prop
        setIsCompleted(task.is_completed);

        // Only update editable fields from prop if not currently being edited
        if (!isEditingTaskName) {
            setCurrentTaskName(task.name);
        }
        if (!isEditingTaskDescription) {
            setCurrentTaskDescription(task.description || '');
        }
        if (!isEditingDueDate) {
            setCurrentDueDate(task.due_date ? format(new Date(task.due_date), 'yyyy-MM-dd') : '');
        }
        if (!isEditingPriority) {
            setCurrentPriority(task.priority || '');
        }
    }
  }, [task, isEditingTaskName, isEditingTaskDescription, isEditingDueDate, isEditingPriority]); // Added isEditingPriority

  const fetchNotes = useCallback(async () => {
    if (!task || !task.id) return; 
    setIsLoadingNotes(true);
    try {
      // Sort notes by created_at descending (newest first)
      const { data, error } = await supabase.from('notes').select('*').eq('task_id', task.id).order('created_at', { ascending: false });
      if (error) {
        const errorMessage = handleSupabaseError(error, 'fetch');
        handleError(error, 'fetchNotes', { fallbackMessage: errorMessage });
        setNotes([]);
        return;
      }
      setNotes(data || []);
    } catch (error) {
      handleError(error, 'fetchNotes');
      setNotes([]);
    } finally {
      setIsLoadingNotes(false);
    }
  }, [task]); 

  useEffect(() => {
    if (task && task.id) {
      fetchNotes(); // Fetch notes on initial mount/task change for note count
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]); // fetchNotes is memoized, direct task.id is fine
  
  useEffect(() => {
    let timeoutId;
    if (showNotes && task && task.id) { 
      fetchNotes(); // Re-fetch if already shown, or fetch if just shown
      // Delay focus slightly to ensure the input field is rendered and visible
      timeoutId = setTimeout(() => {
        if (noteInputRef.current) {
          noteInputRef.current.focus();
        }
      }, 100); // 100ms delay, adjust if needed
    }
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [showNotes, task, fetchNotes]); // Added fetchNotes to dependencies as it's called
  
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
    // Optimistically add new note to the top (as it's newest)
    setNotes(prevNotes => [newNote, ...prevNotes]);
    setShowNotes(false); // Collapse notes section after adding
    // No need to call fetchNotes() here if optimistic update is sufficient
    // and order is handled by insertion point and initial fetch order.
  };

  const priorityStyles = getTaskPriorityClasses(currentPriority);
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
        const errorMessage = handleSupabaseError(error, 'update');
        handleError(error, 'handleToggleComplete', { showAlert: true, fallbackMessage: errorMessage });
        return;
      } else {
        setIsCompleted(newCompletedStatus);
        if (onTaskUpdated) onTaskUpdated({ ...task, is_completed: newCompletedStatus, completed_at: newCompletedStatus ? new Date().toISOString() : null, updated_at: new Date().toISOString() });
      }
    } catch (err) {
      handleError(err, 'handleToggleComplete', { showAlert: true });
    } finally {
      setIsUpdatingTask(false);
    }
  };

  const handleTaskNameChange = (e) => setCurrentTaskName(e.target.value);
  const handleTaskDescriptionChange = (e) => setCurrentTaskDescription(e.target.value);
  const handleDueDateChange = (e) => setCurrentDueDate(e.target.value);
  const handlePriorityChange = (e) => setCurrentPriority(e.target.value);

  const createUpdateHandler = (field, currentValue, originalValue, setter, editSetter, isDate = false) => async () => {
    // Ensure task exists before trying to update
    if (!task) {
        handleError(new Error('Task data is missing'), 'createUpdateHandler', { 
          showAlert: true,
          fallbackMessage: 'Cannot update: task data is missing.'
        });
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
      if (error) {
        const errorMessage = handleSupabaseError(error, 'update');
        throw new Error(errorMessage);
      }
      if (data) {
        if (onTaskUpdated) onTaskUpdated(data); // Pass the updated task object
        setter(isDate && data[field] ? format(new Date(data[field]), 'yyyy-MM-dd') : data[field]);
      } else {
        const errorMessage = `Failed to update task ${field}. No data returned.`;
        handleError(new Error(errorMessage), 'createUpdateHandler', { showAlert: true, fallbackMessage: errorMessage });
        setter(originalValue); // Revert on failure
      }
    } catch (err) {
      const errorMessage = handleSupabaseError(err, 'update') || err.message;
      handleError(err, 'createUpdateHandler', { 
        showAlert: true, 
        fallbackMessage: `Failed to update task ${field}: ${errorMessage}`
      });
      setter(isDate && originalValue ? format(new Date(originalValue), 'yyyy-MM-dd') : (originalValue || (isDate ? '' : ''))); 
    } finally {
      editSetter(false);
      setIsUpdatingTask(false);
    }
  };

  const handleTaskNameUpdate = createUpdateHandler('name', currentTaskName, task ? task.name : '', setCurrentTaskName, setIsEditingTaskName);
  const handleTaskDescriptionUpdate = createUpdateHandler('description', currentTaskDescription, task ? task.description : '', setCurrentTaskDescription, setIsEditingTaskDescription);
  const handleDueDateUpdate = (overrideValue) =>
    createUpdateHandler(
      'due_date',
      overrideValue !== undefined ? overrideValue : currentDueDate,
      task ? task.due_date : null,
      setCurrentDueDate,
      setIsEditingDueDate,
      true
    )();
  const handlePriorityUpdate = createUpdateHandler('priority', currentPriority, task ? task.priority : '', setCurrentPriority, setIsEditingPriority);

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
  const handleDueDateInputKeyDown = createKeyDownHandler(handleDueDateUpdate, task ? task.due_date : null, setCurrentDueDate, setIsEditingDueDate);
  const handlePrioritySelectKeyDown = createKeyDownHandler(handlePriorityUpdate, task ? task.priority : '', setCurrentPriority, setIsEditingPriority);

  const itemBaseClasses = "p-1.5 rounded-md shadow-sm mb-1.5 flex flex-col transition-all hover:shadow-md";
  const completedItemVisualClasses = isCompleted ? "opacity-60 hover:opacity-80" : "";
  const editableTextClasses = (isEditState) => `cursor-text hover:bg-gray-100 rounded-sm ${isCompleted && !isEditState ? 'line-through text-gray-500' : 'text-gray-800'}`;

  return (
    <div 
      className={`py-0.5 px-2 border-b border-gray-200 last:border-b-0 ${priorityStyles.cardOuterClass} ${isCompleted ? 'opacity-60 hover:opacity-80' : 'hover:shadow-sm'} transition-opacity duration-150 relative group`}
    >
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={isCompleted}
          onChange={handleToggleComplete}
          disabled={isUpdatingTask || isEditingTaskName || isEditingTaskDescription || isEditingDueDate || isEditingPriority}
          className="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 flex-shrink-0"
        />
        <div className="flex-grow min-w-0 flex items-center gap-2">
          <div className="flex items-center gap-x-1.5 flex-grow">
            {isEditingTaskName ? (
              <input
                type="text"
                value={currentTaskName}
                onChange={handleTaskNameChange}
                onBlur={handleTaskNameUpdate}
                onKeyDown={handleTaskNameInputKeyDown}
                className="text-sm font-medium text-gray-900 border-b border-indigo-500 focus:outline-none focus:ring-0 py-0.5 flex-grow min-w-[50px] break-words"
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

            {!isEditingTaskName && (
              isEditingTaskDescription ? (
                <textarea
                  value={currentTaskDescription}
                  onChange={handleTaskDescriptionChange}
                  onBlur={handleTaskDescriptionUpdate}
                  onKeyDown={handleTaskDescriptionKeyDown}
                  className="text-xs text-gray-600 border-b border-indigo-500 focus:outline-none focus:ring-0 py-0.5 w-full min-h-[2em] resize-none break-words"
                  rows="1"
                  autoFocus
                />
              ) : (
                <span 
                  onClick={() => !isCompleted && !isEditingTaskName && setIsEditingTaskDescription(true)} 
                  className={`text-xs text-gray-600 ${editableTextClasses(false)} ${isCompleted ? 'line-through' : ''} ${isEditingTaskName ? 'cursor-default' : ''}`}
                  title={currentTaskDescription}
                >
                  {currentTaskDescription || (isEditingTaskName ? '' : <span className="italic opacity-70">No description</span>)}
                </span>
              )
            )}
          </div>
        </div>
        <div className="flex-shrink-0">
          {!isCompleted && !isEditingTaskName && !isEditingTaskDescription && !isEditingDueDate && !isEditingPriority && (
            <button
              className="icon-button text-gray-400 hover:text-indigo-600 cursor-pointer"
              onClick={() => {
                setIsEditingTaskName(true);
              }}
              title="Edit task details"
            >
              <PencilIcon className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center space-x-2 text-xs flex-shrink-0">
          {isEditingPriority ? (
            <select 
              value={currentPriority}
              onChange={(e) => setCurrentPriority(e.target.value)} 
              onBlur={handlePriorityUpdate} 
              onKeyDown={(e) => e.key === 'Enter' && handlePriorityUpdate() || e.key === 'Escape' && (setCurrentPriority(task.priority || ''), setIsEditingPriority(false))}
              className="text-xs p-0.5 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 h-6"
              autoFocus
            >
              <option value="">No Priority</option>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          ) : (
            <div 
              className={`flex items-center cursor-pointer hover:bg-gray-100/50 p-0.5 rounded -ml-0.5 ${isCompleted ? 'pointer-events-none' : ''}`}
              onClick={() => {if (!isCompleted) setIsEditingPriority(true);}}
              title={`Priority: ${currentPriority || 'N/A'}`}
            >
              {priorityStyles.icon} 
              <span className={`ml-0.5 text-xs ${priorityStyles.textClass} ${isCompleted ? 'text-gray-500' : ''}`}>{currentPriority || 'No Priority'}</span>
            </div>
          )}

          {isEditingDueDate ? (
            <div className="flex flex-col items-start">
              <input
                type="date"
                value={currentDueDate}
                onChange={handleDueDateChange}
                onBlur={() => handleDueDateUpdate()}
                onKeyDown={handleDueDateInputKeyDown}
                className="text-xs border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 py-1 px-1.5 w-[130px]"
                autoFocus
              />
            </div>
          ) : (
            <span 
              onClick={() => !isCompleted && setIsEditingDueDate(true)} 
              className={`${dueDateStatusToDisplay.classes} ${!isCompleted ? 'cursor-pointer hover:text-indigo-700' : ''} break-words`}
              title={dueDateStatusToDisplay.fullDate || (task.due_date ? format(parseISO(task.due_date), 'EEEE, MMM do, yyyy') : 'Set due date')}
            >
              {dueDateStatusToDisplay.text}
            </span>
          )}
          
          <button 
            onClick={() => setShowNotes(!showNotes)} 
            className="icon-button relative text-gray-400 hover:text-indigo-600 flex items-center"
            aria-expanded={showNotes}
            aria-controls={`notes-section-${task.id}`}
            disabled={isLoadingNotes}
          >
            <ChatBubbleLeftEllipsisIcon className="h-4 w-4" />
            {notes.length > 0 && (
              <span className="ml-1 text-xs font-medium text-indigo-600">
                ({notes.length})
              </span>
            )}
          </button>
          <span className="text-gray-400 text-2xs hidden sm:inline-block" title={`Last updated: ${task.updated_at ? format(parseISO(task.updated_at), 'Pp') : 'N/A'}`}>
            {updatedAgo}
          </span>
        </div>
      </div>

      {showNotes && (
        <div id={`notes-section-${task.id}`} className="mt-1 pt-1 border-t border-gray-200">
          <AddNoteForm
            ref={noteInputRef}
            parentId={task.id}
            parentType="task"
            onNoteAdded={handleNoteAdded}
          />
          {isLoadingNotes ? (
            <p className="text-xs text-gray-500">Loading notes...</p>
          ) : (
            <NoteList notes={notes} />
          )}
        </div>
      )}
    </div>
  );
}

export default React.memo(TaskItem, (prevProps, nextProps) => {
  return (
    prevProps.task.id === nextProps.task.id &&
    prevProps.task.updated_at === nextProps.task.updated_at &&
    prevProps.task.name === nextProps.task.name &&
    prevProps.task.is_completed === nextProps.task.is_completed &&
    prevProps.task.priority === nextProps.task.priority &&
    prevProps.task.due_date === nextProps.task.due_date
  );
}); 