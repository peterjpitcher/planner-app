'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { differenceInDays, format, isToday, isTomorrow, isPast, startOfDay, formatDistanceToNowStrict, parseISO, addDays } from 'date-fns';
import { apiClient } from '@/lib/apiClient';
import { quickPickOptions } from '@/lib/dateUtils';
import { handleSupabaseError, handleError } from '@/lib/errorHandler';
import { ChatBubbleLeftEllipsisIcon, PencilIcon, Bars3Icon, PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { FireIcon, ExclamationTriangleIcon, CheckCircleIcon, ClockIcon } from '@heroicons/react/20/solid';
import NoteList from '@/components/Notes/NoteList';
import AddNoteForm from '@/components/Notes/AddNoteForm';
import ChaseTaskModal from './ChaseTaskModal';
import { DRAG_DATA_TYPES } from '@/lib/constants';

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

function TaskItem({ task, notes: propNotes, onTaskUpdated, onTaskDragStateChange }) {
  // All useState hooks
  const [isCompleted, setIsCompleted] = useState(task ? task.is_completed : false);
  const [isUpdatingTask, setIsUpdatingTask] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState(propNotes || []);
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
  const [isDragging, setIsDragging] = useState(false);
  const [isChaseModalOpen, setIsChaseModalOpen] = useState(false);

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
      const data = await apiClient.getNotes(null, task.id);
      // Sort notes by created_at descending (newest first)
      const sortedNotes = (data || []).sort((a, b) => 
        new Date(b.created_at) - new Date(a.created_at)
      );
      setNotes(sortedNotes);
    } catch (error) {
      handleError(error, 'fetchNotes');
      setNotes([]);
    } finally {
      setIsLoadingNotes(false);
    }
  }, [task]); 

  // Update notes when propNotes changes
  useEffect(() => {
    if (propNotes) {
      setNotes(propNotes);
    }
  }, [propNotes]);
  
  // Only fetch notes if we don't have them from props
  useEffect(() => {
    let timeoutId;
    if (showNotes && task && task.id && !propNotes) { 
      fetchNotes(); // Only fetch if not provided via props
      // Delay focus slightly to ensure the input field is rendered and visible
      timeoutId = setTimeout(() => {
        if (noteInputRef.current) {
          noteInputRef.current.focus();
        }
      }, 100); // 100ms delay, adjust if needed
    } else if (showNotes && noteInputRef.current) {
      // If we have notes from props, just focus the input
      noteInputRef.current.focus();
    }
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [showNotes, task, fetchNotes, propNotes]);
  
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
      const data = await apiClient.updateTask(task.id, { 
        is_completed: newCompletedStatus, 
        completed_at: newCompletedStatus ? new Date().toISOString() : null,
        updated_at: new Date().toISOString() 
      });
      setIsCompleted(newCompletedStatus);
      if (onTaskUpdated) onTaskUpdated(data);
    } catch (err) {
      handleError(err, 'handleToggleComplete', { showAlert: true });
    } finally {
      setIsUpdatingTask(false);
    }
  };

  const handleChaseConfirm = async (daysToPush) => {
    setIsChaseModalOpen(false);
    setIsUpdatingTask(true);
    try {
      // 1. Add Note
      const noteContent = `Chased task. Pushed due date by ${daysToPush} day${daysToPush !== 1 ? 's' : ''}.`;
      await apiClient.createNote({
        task_id: task.id,
        content: noteContent,
      });

      // 2. Calculate New Date
      // If current due date exists, add to that. If not, add to today.
      const baseDate = task.due_date ? new Date(task.due_date) : new Date();
      const newDueDate = addDays(baseDate, daysToPush);
      const formattedNewDate = format(newDueDate, 'yyyy-MM-dd');

      // 3. Update Task
      const updateObject = {
        due_date: formattedNewDate,
        updated_at: new Date().toISOString()
      };

      const data = await apiClient.updateTask(task.id, updateObject);
      
      if (data) {
        setCurrentDueDate(formattedNewDate);
        if (onTaskUpdated) onTaskUpdated(data);
        // Refresh notes to show the chase note
        fetchNotes();
      }
    } catch (error) {
      handleError(error, 'handleChaseConfirm', { showAlert: true });
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

      const data = await apiClient.updateTask(task.id, updateObject);
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

  const handleDragStart = (event) => {
    if (!task?.id) return;
    if (isUpdatingTask || isEditingTaskName || isEditingTaskDescription || isEditingDueDate || isEditingPriority) {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
    const payload = {
      taskId: task.id,
      previousProjectId: task.project_id || null,
    };
    const serializedPayload = JSON.stringify(payload);
    event.dataTransfer.setData('text/plain', serializedPayload);
    try {
      event.dataTransfer.setData(DRAG_DATA_TYPES.TASK, serializedPayload);
    } catch (dragError) {
      // Ignore browsers that block custom MIME types
    }
    try {
      event.dataTransfer.setData('application/json', serializedPayload);
    } catch {
      // Optional MIME type
    }
    event.dataTransfer.effectAllowed = 'move';
    setIsDragging(true);
    if (onTaskDragStateChange) {
      onTaskDragStateChange(true, task.project_id || null);
    }
  };

  const handleDragEnd = (event) => {
    if (event) {
      event.stopPropagation();
    }
    setIsDragging(false);
    if (onTaskDragStateChange) {
      onTaskDragStateChange(false, task.project_id || null);
    }
  };

  return (
    <div 
      className={`py-0.5 px-2 border-b border-gray-200 last:border-b-0 ${priorityStyles.cardOuterClass} ${isCompleted ? 'opacity-60 hover:opacity-80' : 'hover:shadow-sm'} ${isDragging ? 'ring-2 ring-indigo-300 ring-offset-1' : ''} transition-opacity duration-150 relative group`}
      data-task-id={task.id}
    >
      <div className="flex flex-wrap items-start gap-x-2 gap-y-3 sm:items-center">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <div
            className={`flex h-5 w-5 select-none items-center justify-center rounded-full border border-transparent text-gray-300 transition hover:text-gray-500 ${isCompleted ? 'opacity-40 cursor-default' : 'cursor-grab active:cursor-grabbing hover:border-gray-200'}`}
            draggable={!isCompleted}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onMouseDown={(event) => {
              if (!isCompleted) {
                event.stopPropagation();
              }
            }}
            role="button"
            aria-label="Drag task to another project"
          >
            <Bars3Icon className="h-3.5 w-3.5" />
          </div>
          <input
            type="checkbox"
            checked={isCompleted}
            onChange={handleToggleComplete}
            disabled={isUpdatingTask || isEditingTaskName || isEditingTaskDescription || isEditingDueDate || isEditingPriority}
            className="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 flex-shrink-0 cursor-pointer mt-0.5"
            style={{ minWidth: '16px', minHeight: '16px' }}
          />
          {!isCompleted && !isEditingTaskName && !isEditingTaskDescription && !isEditingDueDate && !isEditingPriority && (
            <button
              className="text-gray-300 hover:text-indigo-600 cursor-pointer flex-shrink-0 mt-0.5"
              onClick={() => setIsChaseModalOpen(true)}
              title="Chase task (add note & push due date)"
            >
              <PaperAirplaneIcon className="h-3.5 w-3.5 -rotate-45" />
            </button>
          )}
          <div className="flex min-w-0 flex-1">
            <div className="flex w-full min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-1.5">
              {isEditingTaskName ? (
                <input
                  type="text"
                  value={currentTaskName}
                  onChange={handleTaskNameChange}
                  onBlur={handleTaskNameUpdate}
                  onKeyDown={handleTaskNameInputKeyDown}
                  className="w-full flex-1 min-w-[50px] break-words border-b border-indigo-500 py-0.5 text-sm font-medium text-gray-900 focus:outline-none focus:ring-0 sm:min-w-[120px]"
                  ref={taskNameInputRef}
                />
              ) : (
                <span 
                  onClick={() => !isCompleted && !isEditingTaskDescription && setIsEditingTaskName(true)} 
                  className={`block w-full text-sm font-medium ${editableTextClasses(false)} ${isCompleted ? 'line-through' : ''} ${isEditingTaskDescription ? 'cursor-default' : ''}`}
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
                    className="w-full min-h-[2em] resize-none break-words border-b border-indigo-500 py-0.5 text-xs text-gray-600 focus:outline-none focus:ring-0"
                    rows="1"
                    autoFocus
                  />
                ) : (
                  currentTaskDescription ? (
                    <span 
                      onClick={() => !isCompleted && !isEditingTaskName && setIsEditingTaskDescription(true)} 
                      className={`block text-xs text-gray-600 ${editableTextClasses(false)} ${isCompleted ? 'line-through' : ''} ${isEditingTaskName ? 'cursor-default' : ''}`}
                      title={currentTaskDescription}
                    >
                      {currentTaskDescription}
                    </span>
                  ) : null
                )
              )}
            </div>
          </div>
        </div>

        <div className="flex w-full items-center gap-2 text-xs flex-wrap sm:w-auto sm:flex-nowrap sm:justify-end">
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

          {isEditingPriority ? (
            <select 
              value={currentPriority}
              onChange={(e) => setCurrentPriority(e.target.value)} 
              onBlur={handlePriorityUpdate} 
              onKeyDown={(e) => e.key === 'Enter' && handlePriorityUpdate() || e.key === 'Escape' && (setCurrentPriority(task.priority || ''), setIsEditingPriority(false))}
              className="h-6 rounded-md border border-gray-300 p-0.5 text-xs focus:border-indigo-500 focus:ring-indigo-500"
              autoFocus
            >
              <option value="">No Priority</option>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          ) : (
            <div 
              className={`flex items-center rounded p-0.5 ${isCompleted ? 'pointer-events-none' : 'cursor-pointer hover:bg-gray-100/50'}`}
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
                className="w-[130px] rounded-md border border-gray-300 px-1.5 py-1 text-xs focus:border-indigo-500 focus:ring-indigo-500"
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
            className="icon-button relative flex items-center text-gray-400 hover:text-indigo-600"
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
          <span className="hidden text-2xs text-gray-400 sm:inline-block" title={`Last updated: ${task.updated_at ? format(parseISO(task.updated_at), 'Pp') : 'N/A'}`}>
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

      <ChaseTaskModal
        isOpen={isChaseModalOpen}
        onClose={() => setIsChaseModalOpen(false)}
        onConfirm={handleChaseConfirm}
        taskName={task.name}
      />
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
