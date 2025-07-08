'use client';

import React, { useState, useEffect, useCallback, forwardRef } from 'react';
import { differenceInDays, format, isToday, isTomorrow, isPast, startOfDay, formatDistanceToNowStrict, parseISO } from 'date-fns';
import { apiClient } from '@/lib/apiClient';
import { quickPickOptions } from '@/lib/dateUtils';
import { handleSupabaseError, handleError } from '@/lib/errorHandler';
import { 
  ChevronDownIcon, ChevronUpIcon, PlusCircleIcon, EyeIcon, EyeSlashIcon, 
  ChatBubbleLeftEllipsisIcon, ClipboardDocumentIcon, EllipsisVerticalIcon,
  PencilIcon, UserGroupIcon, ChevronRightIcon
} from '@heroicons/react/24/outline';
import { FireIcon as SolidFireIcon, ExclamationTriangleIcon as SolidExclamationTriangleIcon, CheckCircleIcon as SolidCheckIcon, ClockIcon as SolidClockIcon } from '@heroicons/react/20/solid';
import TaskList from '@/components/Tasks/TaskList';
import AddTaskModal from '@/components/Tasks/AddTaskModal';
import NoteList from '@/components/Notes/NoteList';
import AddNoteForm from '@/components/Notes/AddNoteForm';
import ProjectCompletionModal from './ProjectCompletionModal';
import { useTargetProject } from '@/contexts/TargetProjectContext';

const getPriorityClasses = (priority) => {
  switch (priority) {
    case 'High':
      return { icon: <SolidFireIcon className="h-5 w-5 text-red-500" />, textClass: 'text-red-600 font-semibold', cardOuterClass: 'border-l-4 border-red-700 bg-red-200 text-red-800' };
    case 'Medium':
      return { icon: <SolidExclamationTriangleIcon className="h-5 w-5 text-yellow-500" />, textClass: 'text-yellow-600 font-semibold', cardOuterClass: 'border-l-4 border-yellow-600 bg-yellow-100 text-yellow-700' };
    case 'Low':
      return { icon: <SolidCheckIcon className="h-5 w-5 text-green-500" />, textClass: 'text-green-600', cardOuterClass: 'border-l-4 border-green-700 bg-green-200 text-green-800' };
    default:
      return { icon: <SolidClockIcon className="h-5 w-5 text-gray-400" />, textClass: 'text-gray-500', cardOuterClass: 'border-l-4 border-gray-400 bg-gray-100 text-gray-700' };
  }
};

const getDueDateStatus = (dateString, isEditing = false, currentDueDateValue = '') => {
  const dateToConsider = isEditing && currentDueDateValue ? currentDueDateValue : dateString;
  if (!dateToConsider) return { text: 'N/A', classes: 'text-gray-500 text-xs', sortKey: Infinity, fullDate: '' };

  let date;
  if (typeof dateToConsider === 'string' && dateToConsider.match(/^\d{4}-\d{2}-\d{2}$/)) {
    date = startOfDay(new Date(dateToConsider + 'T00:00:00'));
  } else {
    date = startOfDay(new Date(dateToConsider));
  }

  const today = startOfDay(new Date());
  const daysDiff = differenceInDays(date, today);
  let text = `Due ${format(date, 'EEEE, MMM do')}`;
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
  } else if (daysDiff < 0) {
    text = `Due ${format(date, 'EEEE, MMM do')}`;
    classes = 'text-gray-600 italic';
  } else if (daysDiff >= 0 && daysDiff <= 7) {
    text = `Due ${format(date, 'EEEE, MMM do')}`;
  } else if (daysDiff > 7) {
    text = `Due ${format(date, 'EEEE, MMM do')}`;
  }

  if (isToday(date) || isTomorrow(date)) {
    // fullDateText is already correctly set above to the actual date
  }

  return { text, classes, fullDate: fullDateText, sortKey };
};

const getStatusClasses = (status) => {
  switch (status) {
    case 'Completed':
      return 'bg-green-600 text-white';
    case 'In Progress':
      return 'bg-blue-600 text-white';
    case 'On Hold':
      return 'bg-yellow-500 text-black';
    case 'Cancelled':
      return 'bg-red-600 text-white';
    case 'Open':
    default:
      return 'bg-gray-500 text-white';
  }
};

const ProjectItem = forwardRef(({ project, tasks: propTasks, notesByTask, onProjectDataChange, onProjectDeleted, areAllTasksExpanded }, ref) => {
  const [tasks, setTasks] = useState(propTasks || []);
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);
  const [showTasks, setShowTasks] = useState(areAllTasksExpanded !== undefined ? areAllTasksExpanded : true);
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);
  const [showCompletedTasks, setShowCompletedTasks] = useState(false);
  const [showProjectNotes, setShowProjectNotes] = useState(false);
  const [projectNotes, setProjectNotes] = useState([]);
  const [isLoadingProjectNotes, setIsLoadingProjectNotes] = useState(false);
  const [copyStatus, setCopyStatus] = useState('Copy');
  const [currentStatus, setCurrentStatus] = useState(project ? project.status || 'Open' : 'Open');
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [statusToConfirm, setStatusToConfirm] = useState(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const [isEditingName, setIsEditingName] = useState(false);
  const [currentName, setCurrentName] = useState(project ? project.name : '');
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [currentDescription, setCurrentDescription] = useState(project ? project.description || '' : '');
  const [isEditingDueDate, setIsEditingDueDate] = useState(false);
  const [currentDueDate, setCurrentDueDate] = useState(project && project.due_date ? format(new Date(project.due_date), 'yyyy-MM-dd') : '');
  const [isEditingPriority, setIsEditingPriority] = useState(false);
  const [currentPriority, setCurrentPriority] = useState(project ? project.priority : 'Medium');
  const [isEditingStakeholders, setIsEditingStakeholders] = useState(false);
  const [currentStakeholdersText, setCurrentStakeholdersText] = useState(project && project.stakeholders ? project.stakeholders.join(', ') : '');

  const { setTargetProjectId } = useTargetProject();

  useEffect(() => {
    if (areAllTasksExpanded !== undefined) {
      setShowTasks(areAllTasksExpanded);
    }
  }, [areAllTasksExpanded]);

  useEffect(() => {
    if (project) {
        setCurrentName(project.name);
        setCurrentDescription(project.description || '');
        setCurrentDueDate(project.due_date ? format(new Date(project.due_date), 'yyyy-MM-dd') : '');
        setCurrentPriority(project.priority);
        setCurrentStakeholdersText(project.stakeholders ? project.stakeholders.join(', ') : '');
        setCurrentStatus(project.status || 'Open');
        setIsEditingName(false);
        setIsEditingDescription(false);
        setIsEditingDueDate(false);
        setIsEditingPriority(false);
        setIsEditingStakeholders(false);
    }
  }, [project]);

  // Update tasks when propTasks changes
  useEffect(() => {
    if (propTasks) {
      // Sort tasks client-side
      const sortedTasks = [...propTasks].sort((a, b) => {
        if (a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1;
        // Sort by due date
        const dateA = a.due_date ? new Date(a.due_date) : null;
        const dateB = b.due_date ? new Date(b.due_date) : null;
        if (dateA && dateB) return dateA - dateB;
        if (dateA) return -1;
        if (dateB) return 1;
        // Sort by priority
        const priorityOrder = { 'High': 0, 'Medium': 1, 'Low': 2 };
        return (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3);
      });
      setTasks(sortedTasks);
    }
  }, [propTasks]);

  const fetchProjectNotes = useCallback(async () => {
    if (!project || !project.id) return;
    setIsLoadingProjectNotes(true);
    try {
      const data = await apiClient.getNotes(project.id);
      // Sort notes by created_at ascending
      const sortedNotes = (data || []).sort((a, b) => 
        new Date(a.created_at) - new Date(b.created_at)
      );
      setProjectNotes(sortedNotes);
    } catch (err) {
      handleError(err, 'fetchProjectNotes');
      setProjectNotes([]);
    } finally {
      setIsLoadingProjectNotes(false);
    }
  }, [project]);

  useEffect(() => {
    if (showProjectNotes && project && project.id) fetchProjectNotes();
  }, [showProjectNotes, project, fetchProjectNotes]);

  // Don't fetch notes on initial mount - only when notes section is opened
  // This prevents excessive API calls when dashboard loads

  if (!project) return null;

  const priorityStyles = getPriorityClasses(currentPriority);
  const dueDateDisplayStatus = getDueDateStatus(project.due_date, isEditingDueDate, currentDueDate);
  const projectStatusClasses = getStatusClasses(currentStatus);
  const projectStatusOptions = ['Open', 'In Progress', 'On Hold', 'Completed', 'Cancelled'];
  const priorityOptions = ['High', 'Medium', 'Low'];
  const isProjectCompletedOrCancelled = currentStatus === 'Completed' || currentStatus === 'Cancelled';

  const updatedAgo = project.updated_at
    ? formatDistanceToNowStrict(parseISO(project.updated_at), { addSuffix: true })
    : 'never';

  const renderStakeholders = () => {
    if (!project.stakeholders || project.stakeholders.length === 0) {
      return <span className="text-gray-500">No stakeholders</span>;
    }
    const stakeholderList = project.stakeholders;

    // Mobile: xs screens
    if (typeof window !== 'undefined' && window.innerWidth < 640) { // Approximating sm breakpoint
      if (stakeholderList.length === 1) {
        return <span className="truncate">{stakeholderList[0]}</span>;
      }
      if (stakeholderList.length === 2) {
        return <span className="truncate">{`${stakeholderList[0]}, ${stakeholderList[1]}`}</span>;
      }
      return <span className="truncate">{`${stakeholderList[0]} +${stakeholderList.length - 1} more`}</span>;
    }

    // Desktop: sm and larger screens
    return stakeholderList.map((sh, index) => (
      <span key={index} className="inline-block bg-gray-200 rounded-full px-2 py-0.5 text-xs font-medium text-gray-700 mr-1 mb-1">
        {sh}
      </span>
    ));
  };

  const updateParentProjectTimestamp = async () => {
    if (!project || !project.id) {
      return;
    }
    try {
      await apiClient.updateProject(project.id, { 
        updated_at: new Date().toISOString() 
      });
    } catch (err) {
      // Silently fail - timestamp update is non-critical
      handleError(err, 'updateParentProjectTimestamp');
    }
  };

  const handleTaskAdded = (newTask) => {
    const newTasks = [newTask, ...tasks].sort((a, b) => {
        if (a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1;
        // Add secondary sort if needed, e.g., by created_at or priority
        return 0;
    });
    setTasks(newTasks);
    onProjectDataChange(project.id, { ...project, updated_at: new Date().toISOString() }, 'task_added', { task: newTask });
  };

  const handleTaskUpdated = (updatedTask) => { 
    const updatedTasks = tasks.map(t => t.id === updatedTask.id ? updatedTask : t)
        .sort((a, b) => {
            if (a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1;
            // Add secondary sort if needed
            return 0;
        });
    setTasks(updatedTasks);

    if (onProjectDataChange && project && updatedTask) { // Ensure updatedTask is valid
        onProjectDataChange(project.id, updatedTask, 'task_updated');
    }
    // updateParentProjectTimestamp(); // Redundant if DashboardPage handles it

    if (updatedTask.is_completed && project) {
      const allTasksForProjectNowComplete = updatedTasks.every(t => t.is_completed);
      // Only trigger if there are tasks and all are complete, and project is not already completed/cancelled
      if (allTasksForProjectNowComplete && updatedTasks.length > 0 && project.status !== 'Completed' && project.status !== 'Cancelled') { 
        // Removed alert, will rely on conditional styling and existing target project highlight
        // The setTargetProjectId will still trigger a scroll and highlight via ProjectList
        // Conditional styling will be added directly in the JSX for a persistent red border
        setTargetProjectId(project.id); 
      }
    }
  };

  const handleDeleteProject = async () => {
    if (project && window.confirm('Are you sure you want to delete project "' + project.name + '" and all its tasks? This action cannot be undone.')) {
        try {
            await apiClient.deleteProject(project.id);
            if (onProjectDeleted) onProjectDeleted(project.id);
        } catch (err) {
            handleError(err, 'handleDeleteProject', { showAlert: true });
        }
    }
    setIsMenuOpen(false);
  };

  const handleProjectNoteAdded = (newNote) => {
    setProjectNotes(prevNotes => [newNote, ...prevNotes]);
    setShowProjectNotes(false); // Collapse notes after adding
    if (onProjectDataChange) onProjectDataChange(project.id, { updated_at: new Date().toISOString() }, 'project_details_changed');
  };

  const formatNoteForCopy = (note) => {
    if (!note) return '';
    // Exclude note.id and other internal IDs if present
    return `  - Note (${format(new Date(note.created_at), 'EEEE, MMM do, yyyy h:mm a')}): ${note.content}`;
  };

  const handleCopyProjectData = async () => {
    if (!project) return;
    setCopyStatus('Copying...');
    let projectDataText = `Project Name: ${project.name}\n`;
    projectDataText += `Status: ${currentStatus}\n`;
    projectDataText += `Priority: ${currentPriority}\n`;
    projectDataText += `Due Date: ${project.due_date ? format(new Date(project.due_date), 'EEEE, MMM do, yyyy') : 'N/A'}\n`;
    projectDataText += `Description: ${project.description || 'N/A'}\n`;
    projectDataText += `Stakeholders: ${project.stakeholders && project.stakeholders.length > 0 ? project.stakeholders.join(', ') : 'N/A'}\n`;

    // Fetch and add project notes (excluding IDs)
    if (projectNotes.length > 0) {
      projectDataText += `\nProject Notes:\n`;
      projectNotes.forEach(note => {
        projectDataText += `${formatNoteForCopy(note)}\n`;
      });
    }

    projectDataText += `\nTasks:\n`;

    // Fetch all tasks for this project to ensure we have latest
    try {
      const tasksWithDetails = await apiClient.getTasks(project.id);
      
      // For each task, fetch its notes
      const tasksWithNotes = await Promise.all(
        tasksWithDetails.map(async (task) => {
          try {
            const notes = await apiClient.getNotes(null, task.id);
            return { ...task, notes: notes || [] };
          } catch (err) {
            return { ...task, notes: [] };
          }
        })
      ); // Fetch tasks and their related notes
      if (tasksWithNotes && tasksWithNotes.length > 0) {
        tasksWithNotes.forEach(taskItem => {
          // Exclude taskItem.id and taskItem.project_id
          projectDataText += `  - Task: ${taskItem.name}\n`;
          projectDataText += `    Description: ${taskItem.description || 'N/A'}\n`;
          projectDataText += `    Due Date: ${taskItem.due_date ? format(new Date(taskItem.due_date), 'EEEE, MMM do, yyyy') : 'N/A'}\n`;
          projectDataText += `    Priority: ${taskItem.priority || 'N/A'}\n`;
          projectDataText += `    Completed: ${taskItem.is_completed ? 'Yes' : 'No'}\n`;
          if (taskItem.completed_at && taskItem.is_completed) {
            projectDataText += `    Completed At: ${format(new Date(taskItem.completed_at), 'EEEE, MMM do, yyyy h:mm a')}\n`;
          }
          
          // Add task notes (excluding IDs)
          if (taskItem.notes && taskItem.notes.length > 0) {
            projectDataText += `    Task Notes:\n`;
            taskItem.notes.forEach(note => {
              projectDataText += `    ${formatNoteForCopy(note)}\n`; // Re-use formatNoteForCopy, it already excludes IDs
            });
          }
          projectDataText += `\n`; // Add a blank line between tasks
        });
      } else {
        projectDataText += `  No tasks for this project.\n`;
      }
    } catch (err) {
      const errorMessage = handleSupabaseError(err, 'fetch');
      projectDataText += `  Error fetching task details: ${errorMessage}\n`;
      setCopyStatus('Error!');
      setTimeout(() => setCopyStatus('Copy'), 2000);
      return;
    }

    try {
      await navigator.clipboard.writeText(projectDataText);
      setCopyStatus('Copied!');
    } catch (err) {
      setCopyStatus('Failed!');
    }
    setTimeout(() => setCopyStatus('Copy'), 2000);
  };
  
  const updateProjectStatusInDb = async (newStatus) => {
    if (!project) return false;
    try {
      const data = await apiClient.updateProject(project.id, { 
        status: newStatus, 
        updated_at: new Date().toISOString() 
      });
      setCurrentStatus(newStatus);
      if (onProjectDataChange && project) { // Pass the full updated project object or essential fields
          onProjectDataChange(project.id, data, 'project_status_changed');
      }
      return true;
    } catch (err) {
      handleError(err, 'updateProjectStatusInDb', { showAlert: true });
      setCurrentStatus(project ? project.status || 'Open' : 'Open'); 
      return false;
    }
  };

  const handleChangeProjectStatus = async (newStatus) => {
    setShowStatusDropdown(false);
    if (newStatus === 'Completed') {
      const openTasks = tasks.filter(task => !task.is_completed);
      if (openTasks.length > 0) {
        setStatusToConfirm(newStatus);
        setShowCompletionModal(true);
        return;
      }
    }
    await updateProjectStatusInDb(newStatus);
  };

  const handleConfirmCompleteTasksAndProject = async () => {
    setShowCompletionModal(false);
    const openTasks = tasks.filter(task => !task.is_completed);
    if (openTasks.length > 0) {
      try {
        await Promise.all(
          openTasks.map(task => 
            apiClient.updateTask(task.id, { 
              is_completed: true, 
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
          )
        );
        fetchTasks();
      } catch (err) {
        handleError(err, 'handleConfirmCompleteTasksAndProject', { 
          showAlert: true, 
          fallbackMessage: 'Could not complete all open tasks. Project status not changed.' 
        });
        return;
      }
    }
    if (statusToConfirm) {
      await updateProjectStatusInDb(statusToConfirm);
      setStatusToConfirm(null);
    }
  };

  const handleCloseCompletionModal = () => {
    setShowCompletionModal(false);
    setStatusToConfirm(null);
  };

  const createUpdateHandler = (field, currentValue, originalValue, setter, editSetter, isArray = false, isDate = false) => async (optionalValue) => {
    if (!project) {
        handleError(new Error('Project data is missing'), 'createUpdateHandler', { 
          showAlert: true,
          fallbackMessage: 'Cannot update: project data is missing.'
        });
        if (editSetter) editSetter(false);
        return;
    }

    const valueToProcess = optionalValue !== undefined ? optionalValue : currentValue;

    let processedValue;
    if (isDate) {
      processedValue = valueToProcess ? valueToProcess : null;
    } else if (isArray) {
      const valToString = Array.isArray(valueToProcess) ? valueToProcess.join(',') : String(valueToProcess || '');
      processedValue = valToString.split(',').map(s => s.trim()).filter(s => s);
    } else {
      processedValue = (typeof valueToProcess === 'string' ? valueToProcess.trim() : valueToProcess);
    }

    let processedOriginalValue;
    if (isDate) {
      processedOriginalValue = originalValue ? format(new Date(originalValue), 'yyyy-MM-dd') : null;
    } else if (isArray) {
      processedOriginalValue = originalValue || [];
    } else {
      processedOriginalValue = (typeof originalValue === 'string' ? (originalValue || '').trim() : originalValue);
    }
    const valueChanged = isArray ? JSON.stringify(processedValue) !== JSON.stringify(processedOriginalValue) : processedValue !== processedOriginalValue;
    if (!valueChanged) {
      if (editSetter) editSetter(false);
      return;
    }
    try {
      const updateObject = { [field]: processedValue, updated_at: new Date().toISOString() };
      if (isDate && !processedValue) {
          updateObject[field] = null;
      }
      const data = await apiClient.updateProject(project.id, updateObject);
      if (data) {
        setter(
          isDate && data[field] ? format(new Date(data[field]), 'yyyy-MM-dd') : 
          isArray ? (data[field] ? data[field].join(', ') : '') :
          data[field]
        );
        const { last_activity_at, ...restOfUpdateObject } = updateObject;
        if (onProjectDataChange && project) { // Call the DashboardPage callback
            onProjectDataChange(project.id, data, 'project_details_changed');
        }
        if (field === 'priority') setCurrentPriority(data.priority); // Local state for UI
      } else {
         const errorMessage = `Failed to update project ${field}. No data returned.`;
         handleError(new Error(errorMessage), 'createUpdateHandler', { showAlert: true, fallbackMessage: errorMessage });
         setter(
            isDate ? (originalValue ? format(new Date(originalValue), 'yyyy-MM-dd') : '') :
            isArray ? (originalValue ? originalValue.join(', ') : '') :
            (originalValue || (isDate ? '' : ''))
         );
      }
    } catch (err) {
      const errorMessage = handleSupabaseError(err, 'update') || err.message;
      handleError(err, 'createUpdateHandler', { 
        showAlert: true, 
        fallbackMessage: `Failed to update project ${field}: ${errorMessage}`
      });
      setter(
        isDate ? (originalValue ? format(new Date(originalValue), 'yyyy-MM-dd') : '') :
        isArray ? (originalValue ? originalValue.join(', ') : '') :
        (originalValue || (isDate ? '' : ''))
     );
    } finally {
      if (editSetter) editSetter(false);
    }
  };

  const handleNameChange = (e) => setCurrentName(e.target.value);
  const handleNameUpdate = createUpdateHandler('name', currentName, project ? project.name : '', setCurrentName, setIsEditingName);
  const handleNameInputKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleNameUpdate(); }
    if (e.key === 'Escape') { setCurrentName(project ? project.name : ''); setIsEditingName(false); }
  };

  const handleDescriptionChange = (e) => setCurrentDescription(e.target.value);
  const handleDescriptionUpdate = createUpdateHandler('description', currentDescription, project ? project.description : '', setCurrentDescription, setIsEditingDescription);
  const handleDescriptionKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleDescriptionUpdate(); }
    if (e.key === 'Escape') { setCurrentDescription(project ? project.description || '' : ''); setIsEditingDescription(false); }
  };

  const handleDueDateChange = (e) => setCurrentDueDate(e.target.value);
  const handleDueDateUpdate = createUpdateHandler('due_date', currentDueDate, project ? project.due_date : null, setCurrentDueDate, setIsEditingDueDate, false, true);
  const handleDueDateInputKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleDueDateUpdate(); }
    if (e.key === 'Escape') { setCurrentDueDate(project && project.due_date ? format(new Date(project.due_date), 'yyyy-MM-dd') : ''); setIsEditingDueDate(false); }
  };
  
  const handlePriorityChange = (e) => setCurrentPriority(e.target.value);
  const handlePriorityUpdate = createUpdateHandler('priority', currentPriority, project ? project.priority : 'Medium', setCurrentPriority, setIsEditingPriority);
  const handlePriorityInputKeyDown = (e) => {
    if (e.key === 'Escape') { setCurrentPriority(project ? project.priority : 'Medium'); setIsEditingPriority(false); }
  };

  const handleStakeholdersChange = (e) => setCurrentStakeholdersText(e.target.value);
  const handleStakeholdersUpdate = createUpdateHandler('stakeholders', currentStakeholdersText, project ? project.stakeholders : [], setCurrentStakeholdersText, setIsEditingStakeholders, true);
  const handleStakeholdersInputKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleStakeholdersUpdate(); }
    if (e.key === 'Escape') { setCurrentStakeholdersText(project && project.stakeholders ? project.stakeholders.join(', ') : ''); setIsEditingStakeholders(false); }
  };

  const commonInputClasses = "text-xs p-1 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-100 disabled:cursor-not-allowed";
  const disabledInputClasses = "bg-gray-100 cursor-not-allowed";

  const openTasksCount = tasks.filter(task => !task.is_completed).length;
  const completedTasksCount = tasks.length - openTasksCount;

  const needsAttentionStyle = openTasksCount === 0 && tasks.length > 0 && !isProjectCompletedOrCancelled ? 'ring-2 ring-red-500 ring-offset-2' : '';

  const startEditingName = (e) => {
    if (isProjectCompletedOrCancelled) return;
    e.stopPropagation();
    setTargetProjectId(null);
    setIsEditingName(true);
  };

  const startEditingDescription = (e) => {
    if (isProjectCompletedOrCancelled) return;
    e.stopPropagation();
    setTargetProjectId(null);
    setIsEditingDescription(true);
  };

  const startEditingDueDate = (e) => {
    if (isProjectCompletedOrCancelled || isEditingPriority || isEditingStakeholders) return;
    e.stopPropagation();
    setTargetProjectId(null);
    setIsEditingDueDate(true);
  };
  
  const startEditingStakeholders = (e) => {
    if (isProjectCompletedOrCancelled || isEditingPriority || isEditingDueDate) return;
    e.stopPropagation();
    setTargetProjectId(null);
    setIsEditingStakeholders(true);
  };

  const handlePrioritySelectClick = (e) => {
    e.stopPropagation();
    setTargetProjectId(null);
  };

  return (
    <div 
      ref={ref}
      id={`project-item-${project.id}`}
      className={`rounded-lg shadow-md mb-3 transition-all duration-300 ease-in-out hover:shadow-lg ${priorityStyles.cardOuterClass} ${isProjectCompletedOrCancelled ? 'opacity-70' : ''} ${needsAttentionStyle}`}>
      <div 
        className="p-2.5 sm:p-3 border-b border-gray-200 cursor-pointer" 
        onClick={() => { setShowTasks(!showTasks); setTargetProjectId(null); }}
        role="button" tabIndex={0} 
        onKeyDown={(e) => {if ((e.key === 'Enter' || e.key === ' ') && !isMenuOpen && !isEditingName && !isEditingDueDate && !isEditingPriority && !isEditingStakeholders) setShowTasks(!showTasks)}}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-y-2 gap-x-3">
          <div className="flex-grow min-w-0 flex items-center gap-2">
            {showTasks ? (
              <ChevronDownIcon className="h-5 w-5 text-gray-500 flex-shrink-0" />
            ) : (
              <ChevronRightIcon className="h-5 w-5 text-gray-500 flex-shrink-0" />
            )}
            {isEditingName ? (
              <input
                type="text"
                value={currentName}
                onChange={handleNameChange}
                onBlur={() => handleNameUpdate()}
                onKeyDown={handleNameInputKeyDown}
                className={`w-full text-base sm:text-lg font-semibold p-0.5 border-b border-indigo-500 focus:outline-none ${isProjectCompletedOrCancelled ? disabledInputClasses : ''}`}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                disabled={isProjectCompletedOrCancelled}
              />
            ) : (
              <h3 
                className={`text-base sm:text-lg font-semibold text-gray-800 truncate ${!isProjectCompletedOrCancelled ? 'cursor-text hover:bg-gray-100 rounded p-0.5 -m-0.5' : ''} ${currentStatus === 'Completed' ? 'line-through text-gray-500' : ''}`}
                onClick={startEditingName}
                title={project.name}
              >
                {currentName || 'Unnamed Project'}
              </h3>
            )}
          </div>
          <div className="mt-1 ml-7 sm:flex sm:items-center sm:space-x-3 text-xs">
            {/* Stakeholders for mobile (xs) */}
            <div className="sm:hidden flex items-center text-gray-600 mb-1">
              <UserGroupIcon className="h-4 w-4 mr-1 text-gray-500 flex-shrink-0" />
              <div className="truncate">
                {renderStakeholders()} 
              </div>
            </div>
            {/* Stakeholders for desktop (sm and up) */}
            <div className="hidden sm:flex items-center text-gray-600">
              <UserGroupIcon className="h-4 w-4 mr-1 text-gray-500" />
              {project.stakeholders && project.stakeholders.length > 0 
                ? project.stakeholders.join(', ') 
                : <span className="text-gray-400">No stakeholders</span>}
            </div>
            
            {/* Separator, Due Date, Updated Ago for sm and up screens */}
            <div className="hidden sm:flex items-center space-x-3">
              <span className="text-gray-400">•</span>
              <div className={`${dueDateDisplayStatus.classes} break-words`} title={dueDateDisplayStatus.fullDate}>
                  {dueDateDisplayStatus.text}
              </div>
              <span className="text-gray-400">•</span>
              <div className="text-xs text-gray-500">
                  Updated {updatedAgo}
              </div>
            </div>

            {/* Due Date and Updated Ago for xs screens (stacked) */}
            <div className="sm:hidden mt-1">
                <div className={`${dueDateDisplayStatus.classes} mb-0.5 break-words`} title={dueDateDisplayStatus.fullDate}>
                    {dueDateDisplayStatus.text}
                </div>
                {/* Updated Ago is intentionally not shown on xs screens to save space */}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-x-2 gap-y-1 sm:gap-x-3 flex-wrap justify-start sm:justify-end flex-shrink-0">
          <div className="relative order-1 sm:order-none">
            <button
              onClick={(e) => { 
                e.stopPropagation(); 
                if (isProjectCompletedOrCancelled || isEditingPriority || isEditingDueDate || isEditingStakeholders) return;
                setShowStatusDropdown(!showStatusDropdown); 
              }}
              disabled={isProjectCompletedOrCancelled || isEditingPriority || isEditingDueDate || isEditingStakeholders}
              className={`touch-target-sm text-xs font-medium px-2 py-1 rounded-full flex items-center whitespace-nowrap ${projectStatusClasses} ${isProjectCompletedOrCancelled ? 'cursor-not-allowed' : 'hover:opacity-80'}`}
            >
              {currentStatus} <ChevronDownIcon className="w-3 h-3 ml-1 opacity-70"/>
            </button>
            {showStatusDropdown && !isProjectCompletedOrCancelled && (
              <div className="absolute right-0 mt-1 w-36 bg-white rounded-md shadow-lg z-20 border border-gray-200 py-0.5">
                {projectStatusOptions.map(option => (
                  <button
                    key={option}
                    onClick={(e) => { e.stopPropagation(); handleChangeProjectStatus(option); }}
                    className="touch-target-sm block w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 focus:bg-gray-100"
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative order-2 sm:order-none">
            {isEditingPriority && !isProjectCompletedOrCancelled ? (
              <select 
                value={currentPriority}
                onChange={handlePriorityChange}
                onBlur={() => handlePriorityUpdate()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handlePriorityUpdate();
                  } else if (e.key === 'Escape') {
                    setCurrentPriority(project ? project.priority : 'Medium');
                    setIsEditingPriority(false);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                className="text-xs p-1 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                autoFocus
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
              </select>
            ) : (
              <div 
                className="flex items-center cursor-pointer hover:bg-gray-200/50 p-0.5 rounded" 
                onClick={(e) => {
                  e.stopPropagation(); 
                  if (!isProjectCompletedOrCancelled && !isEditingName && !isEditingDescription && !isEditingDueDate && !isEditingStakeholders) {
                    setIsEditingPriority(true); 
                    setTargetProjectId(null);
                  }
                }}
                title={`Priority: ${currentPriority || 'N/A'}`}
              >
                {priorityStyles.icon}
                <span className={`ml-1 text-xs ${priorityStyles.textClass}`}>{currentPriority || 'No Priority'}</span>
              </div>
            )}
          </div>

          <div className="relative order-3 sm:order-none">
              {isEditingDueDate && !isProjectCompletedOrCancelled ? (
                  <div className="flex items-center gap-1 text-xs whitespace-nowrap">
                      <input
                          type="date"
                          value={currentDueDate}
                          onChange={handleDueDateChange}
                          onKeyDown={handleDueDateInputKeyDown}
                          onBlur={() => createUpdateHandler('due_date', currentDueDate, project.due_date, setCurrentDueDate, setIsEditingDueDate, false, true)()}
                          className="text-xs p-1 border border-gray-300 rounded-md w-full"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                      />
                      {/* Quick Pick Date Buttons for Inline Edit - ProjectItem */}
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {quickPickOptions.map(option => (
                            <button
                              key={option.label}
                              type="button"
                              onClick={() => {
                                const newDate = option.getValue();
                                setCurrentDueDate(newDate);
                                createUpdateHandler('due_date', newDate, project.due_date, setCurrentDueDate, setIsEditingDueDate, false, true)();
                              }}
                              className="touch-target-sm px-1.5 py-0.5 text-3xs font-medium text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-full cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-300"
                            >
                              {option.label}
                            </button>
                          ))}
                      </div>
                  </div>
              ) : (
                  <div 
                      className={`flex items-center gap-1 text-xs whitespace-nowrap ${dueDateDisplayStatus.classes} ${!isProjectCompletedOrCancelled && !isEditingPriority && !isEditingStakeholders ? 'cursor-pointer hover:bg-gray-100 p-0.5 -m-0.5 rounded' : 'text-gray-400'}`}
                      onClick={startEditingDueDate}
                      title={isProjectCompletedOrCancelled ? dueDateDisplayStatus.fullDate || 'Due date not editable' : dueDateDisplayStatus.fullDate || 'Set due date'}
                  >
                      <span className="text-gray-600">Due Date</span>
                      <span className="flex-1 text-right break-words">
                          {/* This span is primarily for layout, actual text is shown by parent's dueDateDisplayStatus.text or similar */}
                      </span>
                      {!isProjectCompletedOrCancelled && !isEditingPriority && !isEditingStakeholders && <PencilIcon className="w-3 h-3 opacity-60 ml-1 flex-shrink-0" />}
                  </div>
              )}
          </div>

          <div className="relative order-4 sm:order-none flex items-center gap-1 text-xs text-gray-600 whitespace-nowrap">
              <UserGroupIcon className="w-3.5 h-3.5 opacity-70 flex-shrink-0" />
              {isEditingStakeholders && !isProjectCompletedOrCancelled ? (
                  <input
                      type="text"
                      value={currentStakeholdersText}
                      onChange={handleStakeholdersChange}
                      onBlur={() => handleStakeholdersUpdate()}
                      onKeyDown={handleStakeholdersInputKeyDown}
                      className={`${commonInputClasses} w-full sm:w-32`}
                      placeholder="e.g., Team A, Client"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                  />
              ) : (
                  <span 
                      className={`flex items-center gap-1 ${!isProjectCompletedOrCancelled && !isEditingPriority && !isEditingDueDate ? 'cursor-pointer hover:bg-gray-100 p-0.5 -m-0.5 rounded' : 'text-gray-400'} ${!currentStakeholdersText ? 'italic' : ''}`}
                      onClick={startEditingStakeholders}
                      title={isProjectCompletedOrCancelled ? currentStakeholdersText || 'Stakeholders not editable' : currentStakeholdersText || 'Add stakeholders'}
                  >
                      <span className="text-gray-600">Stakeholders</span>
                       {!isProjectCompletedOrCancelled && !isEditingPriority && !isEditingDueDate && <PencilIcon className="w-3 h-3 opacity-50 inline ml-0.5" />}
                  </span>
              )}
          </div>

          <div className="relative order-last sm:order-none ml-auto sm:ml-0 flex items-center gap-x-1">
              <button
                onClick={(e) => { e.stopPropagation(); setShowProjectNotes(!showProjectNotes); }}
                className="icon-button rounded-full text-gray-500 hover:bg-gray-200 hover:text-indigo-600 flex items-center focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:ring-offset-1"
                aria-expanded={showProjectNotes}
                aria-controls={`project-notes-section-${project.id}`}
                disabled={isLoadingProjectNotes}
                title={showProjectNotes ? "Hide project notes" : "Show project notes"}
              >
                <ChatBubbleLeftEllipsisIcon className="h-5 w-5" />
                {projectNotes.length > 0 && (
                  <span className="ml-1 text-xs font-medium text-indigo-600">
                    ({projectNotes.length})
                  </span>
                )}
              </button>

              <button
                onClick={(e) => { e.stopPropagation(); handleCopyProjectData(); }}
                className="icon-button rounded-full text-gray-500 hover:bg-gray-200 hover:text-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:ring-offset-1"
                title={`Copy project data (${copyStatus})`}
              >
                <ClipboardDocumentIcon className="h-5 w-5" />
              </button>

              <button
                  onClick={(e) => { e.stopPropagation(); setIsMenuOpen(!isMenuOpen);}}
                  className="icon-button rounded-full hover:bg-gray-200 text-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:ring-offset-1"
                  aria-haspopup="true" aria-expanded={isMenuOpen}
                  title="More actions"
              >
                  <EllipsisVerticalIcon className="h-5 w-5"/>
              </button>
          </div>
        </div>

        <div className={`px-2.5 sm:px-3 pt-0.5 pb-1.5 border-t border-gray-200/50`}>
          {isEditingDescription && !isProjectCompletedOrCancelled ? (
            <textarea
              value={currentDescription}
              onChange={handleDescriptionChange}
              onBlur={() => handleDescriptionUpdate()}
              onKeyDown={handleDescriptionKeyDown}
              className={`${commonInputClasses} w-full min-h-[50px] resize-y text-xs`}
              rows="2"
              autoFocus
              onClick={(e) => e.stopPropagation()}
              placeholder="Project description..."
            />
          ) : currentDescription ? (
            <p 
              className={`text-xs text-gray-600 whitespace-pre-wrap break-words ${!isProjectCompletedOrCancelled ? 'cursor-text hover:bg-gray-50 p-0.5 -m-0.5 rounded' : 'text-gray-500'}`}
              onClick={startEditingDescription}
            >
              {currentDescription}
            </p>
          ) : !isProjectCompletedOrCancelled ? (
            <p 
              className="text-xs text-gray-400 italic cursor-text hover:bg-gray-50 p-0.5 -m-0.5 rounded break-words"
              onClick={startEditingDescription}
            >
              Add project description...
            </p>
          ) : null}
        </div>
      </div>

      {showTasks && (
          <div className="border-t border-gray-200 bg-gray-50/50">
            <div className="px-2.5 sm:px-3 py-1.5 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-semibold text-gray-700">
                  Tasks ({openTasksCount} open, {completedTasksCount} completed)
                </h4>
                {tasks.length > 0 && completedTasksCount > 0 && (
                    <button
                        onClick={(e) => {e.stopPropagation(); setShowCompletedTasks(!showCompletedTasks);}}
                        className="touch-target-sm text-xs text-indigo-600 hover:text-indigo-800 flex items-center"
                    >
                        {showCompletedTasks ? <EyeSlashIcon className="w-3.5 h-3.5 mr-1"/> : <EyeIcon className="w-3.5 h-3.5 mr-1"/>}
                        {showCompletedTasks ? 'Hide' : 'Show'} Completed
                    </button>
                )}
              </div>
              {!isProjectCompletedOrCancelled && (
                <button
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      setShowAddTaskModal(true);
                    }}
                    className="hidden sm:flex items-center text-xs bg-indigo-500 hover:bg-indigo-600 text-white font-medium py-1 px-2 rounded-md transition-colors"
                >
                    <PlusCircleIcon className="w-4 h-4 mr-1.5" /> Add Task
                </button>
              )}
            </div>
            <div className="px-2.5 sm:px-3 pb-2">
              {isLoadingTasks ? (
                <p className="text-xs text-gray-500 italic py-2 px-1">Loading tasks...</p>
              ) : tasks.length > 0 ? (
                <TaskList
                  tasks={tasks}
                  notesByTask={notesByTask}
                  isLoading={isLoadingTasks}
                  onTaskUpdated={handleTaskUpdated}
                  showCompletedTasks={showCompletedTasks}
                  isProjectCompleted={isProjectCompletedOrCancelled}
                />
              ) : (
                <p className="text-xs text-gray-500 italic py-2 px-1">No tasks for this project yet. Click &quot;Add Task&quot; to create one.</p>
              )}
            </div>
          </div>
      )}

      {/* Project Notes Section */}
      {showProjectNotes && (
        <div id={`project-notes-section-${project.id}`} className="border-t border-gray-200 px-3 sm:px-4 py-1.5">
          <h4 className="text-xs font-semibold text-gray-700 mb-1.5">Project Notes</h4>
          <AddNoteForm
            parentId={project.id}
            onNoteAdded={handleProjectNoteAdded}
            disabled={isProjectCompletedOrCancelled}
          />
          {isLoadingProjectNotes ? (
            <p className="text-xs text-gray-500 py-2">Loading notes...</p>
          ) : projectNotes.length > 0 ? (
            <NoteList notes={projectNotes} />
          ) : (
            <p className="text-xs text-gray-500 italic py-2">No notes for this project yet.</p>
          )}
        </div>
      )}
      
      {showAddTaskModal && (
        <AddTaskModal
          isOpen={showAddTaskModal}
          projectId={project.id}
          defaultPriority={project.priority}
          onClose={() => setShowAddTaskModal(false)}
          onTaskAdded={handleTaskAdded}
        />
      )}

      <ProjectCompletionModal
        isOpen={showCompletionModal}
        onClose={handleCloseCompletionModal}
        onConfirmCompleteTasks={handleConfirmCompleteTasksAndProject}
        projectName={currentName}
        openTasksCount={tasks.filter(task => !task.is_completed).length}
      />
    </div>
  );
});

ProjectItem.displayName = 'ProjectItem';

export default React.memo(ProjectItem, (prevProps, nextProps) => {
  // Only re-render if these specific props change
  return (
    prevProps.project.id === nextProps.project.id &&
    prevProps.project.updated_at === nextProps.project.updated_at &&
    prevProps.project.name === nextProps.project.name &&
    prevProps.project.status === nextProps.project.status &&
    prevProps.project.priority === nextProps.project.priority &&
    prevProps.project.due_date === nextProps.project.due_date &&
    prevProps.isExpanded === nextProps.isExpanded &&
    prevProps.isTargetProject === nextProps.isTargetProject
  );
});