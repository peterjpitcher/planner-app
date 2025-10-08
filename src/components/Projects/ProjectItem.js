'use client';

import React, { useState, useEffect, useCallback, forwardRef } from 'react';
import { differenceInDays, format, isToday, isTomorrow, isPast, startOfDay, formatDistanceToNowStrict, parseISO } from 'date-fns';
import { apiClient } from '@/lib/apiClient';
import { quickPickOptions } from '@/lib/dateUtils';
import { handleSupabaseError, handleError } from '@/lib/errorHandler';
import { 
  ChevronDownIcon, ChevronUpIcon, PlusCircleIcon, EyeIcon, EyeSlashIcon, 
  ChatBubbleLeftEllipsisIcon, ClipboardDocumentIcon,
  PencilIcon, UserGroupIcon, ChevronRightIcon, CalendarDaysIcon, TrashIcon
} from '@heroicons/react/24/outline';
import { FireIcon as SolidFireIcon, ExclamationTriangleIcon as SolidExclamationTriangleIcon, CheckCircleIcon as SolidCheckIcon, ClockIcon as SolidClockIcon } from '@heroicons/react/20/solid';
import TaskList from '@/components/Tasks/TaskList';
import NoteList from '@/components/Notes/NoteList';
import AddNoteForm from '@/components/Notes/AddNoteForm';
import ProjectCompletionModal from './ProjectCompletionModal';
import { useTargetProject } from '@/contexts/TargetProjectContext';
import { useSession } from 'next-auth/react';
import QuickTaskForm from '@/components/Tasks/QuickTaskForm';

const getPriorityClasses = (priority) => {
  switch (priority) {
    case 'High':
      return {
        icon: <SolidFireIcon className="h-5 w-5 text-red-400" />,
        textClass: 'text-red-500 font-semibold',
        cardOuterClass: 'border-red-200/70 shadow-[0_24px_48px_-28px_rgba(239,68,68,0.65)]',
        glowClass: 'bg-red-400/45',
        ribbonClass: 'from-red-500/70 via-red-400/30 to-transparent',
      };
    case 'Medium':
      return {
        icon: <SolidExclamationTriangleIcon className="h-5 w-5 text-amber-400" />,
        textClass: 'text-amber-500 font-semibold',
        cardOuterClass: 'border-amber-200/60 shadow-[0_24px_48px_-28px_rgba(245,158,11,0.4)]',
        glowClass: 'bg-amber-400/35',
        ribbonClass: 'from-amber-400/60 via-amber-300/25 to-transparent',
      };
    case 'Low':
      return {
        icon: <SolidCheckIcon className="h-5 w-5 text-emerald-400" />,
        textClass: 'text-emerald-500 font-medium',
        cardOuterClass: 'border-emerald-200/60 shadow-[0_24px_48px_-28px_rgba(16,185,129,0.35)]',
        glowClass: 'bg-emerald-300/40',
        ribbonClass: 'from-emerald-400/60 via-emerald-300/20 to-transparent',
      };
    default:
      return {
        icon: <SolidClockIcon className="h-5 w-5 text-slate-400" />,
        textClass: 'text-slate-500',
        cardOuterClass: 'border-slate-200/70 shadow-[0_24px_48px_-30px_rgba(100,116,139,0.35)]',
        glowClass: 'bg-slate-400/35',
        ribbonClass: 'from-slate-400/40 via-slate-300/25 to-transparent',
      };
  }
};

const getTodayISODate = () => format(new Date(), 'yyyy-MM-dd');

const getDueDateStatus = (dateString, isEditing = false, currentDueDateValue = '') => {
  const dateToConsider = isEditing && currentDueDateValue ? currentDueDateValue : dateString;
  if (!dateToConsider) return { text: 'No due date', classes: 'text-[#2f617a]/70 text-xs', sortKey: Infinity, fullDate: '' };

  let date;
  if (typeof dateToConsider === 'string' && dateToConsider.match(/^\d{4}-\d{2}-\d{2}$/)) {
    date = startOfDay(new Date(dateToConsider + 'T00:00:00'));
  } else {
    date = startOfDay(new Date(dateToConsider));
  }

  const today = startOfDay(new Date());
  const daysDiff = differenceInDays(date, today);
  let text = `Due ${format(date, 'EEEE, MMM do')}`;
  let classes = 'text-[#036586]';
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
  } else if (daysDiff < 0) {
    text = `Due ${format(date, 'EEEE, MMM do')}`;
    classes = 'text-[#2f617a]/70 italic';
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
      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'In Progress':
      return 'bg-[#0496c7]/15 text-[#036586] border-[#0496c7]/30';
    case 'On Hold':
      return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'Cancelled':
      return 'bg-rose-100 text-rose-600 border-rose-200';
    case 'Open':
    default:
      return 'bg-white text-[#036586] border-[#0496c7]/20';
  }
};

const ProjectItem = forwardRef(({ project, tasks: propTasks, notesByTask, onProjectDataChange, onProjectDeleted, areAllTasksExpanded }, ref) => {
  const { data: session } = useSession();
  const currentUser = session?.user;
  const [tasks, setTasks] = useState(propTasks || []);
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);
  const [showTasks, setShowTasks] = useState(areAllTasksExpanded !== undefined ? areAllTasksExpanded : true);
  const [showCompletedTasks, setShowCompletedTasks] = useState(false);
  const [showProjectNotes, setShowProjectNotes] = useState(false);
  const [projectNotes, setProjectNotes] = useState([]);
  const [isLoadingProjectNotes, setIsLoadingProjectNotes] = useState(false);
  const [copyStatus, setCopyStatus] = useState('Copy');
  const [currentStatus, setCurrentStatus] = useState(project ? project.status || 'Open' : 'Open');
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [statusToConfirm, setStatusToConfirm] = useState(null);

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
  const isProjectCompletedOrCancelled = currentStatus === 'Completed' || currentStatus === 'Cancelled';
  const updatedAgo = project.updated_at
    ? formatDistanceToNowStrict(parseISO(project.updated_at), { addSuffix: true })
    : 'never';

  const renderStakeholders = () => {
    if (!project.stakeholders || project.stakeholders.length === 0) {
      return <span className="text-slate-400">No stakeholders</span>;
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
      <span key={index} className="mr-1 mb-1 inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
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

  const commonInputClasses = "text-xs p-1 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-slate-100 disabled:cursor-not-allowed";
  const disabledInputClasses = "bg-slate-100 cursor-not-allowed";

  const openTasksCount = tasks.filter(task => !task.is_completed).length;
  const completedTasksCount = tasks.length - openTasksCount;

  const needsAttentionStyle = openTasksCount === 0 && tasks.length > 0 && !isProjectCompletedOrCancelled ? 'ring-2 ring-red-400/70 ring-offset-2 ring-offset-white' : '';

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

  const submitQuickTask = async ({ name, dueDate, priority }) => {
    if (!project || !project.id) {
      throw new Error('Project is not available.');
    }
    if (!currentUser?.id) {
      throw new Error('Sign in to add tasks.');
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error('Add a short name to create the task.');
    }
    const createdTask = await apiClient.createTask({
      name: trimmedName,
      description: null,
      due_date: dueDate || getTodayISODate(),
      priority: priority || 'Medium',
      project_id: project.id,
      user_id: currentUser.id,
    });
    handleTaskAdded(createdTask);
  };

  return (
    <div 
      ref={ref}
      id={`project-item-${project.id}`}
      className={`relative overflow-hidden rounded-3xl border border-slate-200/65 bg-white/80 px-2 py-3 shadow-[0_28px_60px_-32px_rgba(4,150,199,0.35)] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_40px_70px_-28px_rgba(4,150,199,0.45)] ${priorityStyles.cardOuterClass} ${isProjectCompletedOrCancelled ? 'opacity-60 saturate-75' : ''} ${needsAttentionStyle}`}>
      <span className={`pointer-events-none absolute inset-x-3 top-2 h-[6px] rounded-full bg-gradient-to-r ${priorityStyles.ribbonClass}`} />
      <div className={`pointer-events-none absolute -top-10 right-0 h-32 w-32 rounded-full ${priorityStyles.glowClass} blur-3xl`} />
      <div className="relative z-10">
      <div 
        className="relative cursor-pointer rounded-2xl bg-white/65 px-4 py-4 shadow-inner shadow-slate-200/40 transition-colors hover:bg-white/80" 
        onClick={() => { setShowTasks(!showTasks); setTargetProjectId(null); }}
        role="button" tabIndex={0} 
        onKeyDown={(e) => {if ((e.key === 'Enter' || e.key === ' ') && !isEditingName && !isEditingDueDate && !isEditingPriority && !isEditingStakeholders) setShowTasks(!showTasks)}}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-y-2 gap-x-3">
          <div className="flex-grow min-w-0 flex items-center gap-2">
            {showTasks ? (
              <ChevronDownIcon className="h-5 w-5 text-slate-400 flex-shrink-0" />
            ) : (
              <ChevronRightIcon className="h-5 w-5 text-slate-400 flex-shrink-0" />
            )}
            {isEditingName ? (
              <input
                type="text"
                value={currentName}
                onChange={handleNameChange}
                onBlur={() => handleNameUpdate()}
                onKeyDown={handleNameInputKeyDown}
                className={`w-full text-base sm:text-lg font-semibold p-0.5 border-b border-indigo-500/80 bg-white/70 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${isProjectCompletedOrCancelled ? disabledInputClasses : ''}`}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                disabled={isProjectCompletedOrCancelled}
              />
            ) : (
              <h3 
                className={`text-base sm:text-lg font-semibold text-slate-900 truncate ${!isProjectCompletedOrCancelled ? 'cursor-text rounded-md px-1 py-0.5 -mx-1 transition hover:bg-indigo-50/80' : ''} ${currentStatus === 'Completed' ? 'line-through text-slate-400' : ''}`}
                onClick={startEditingName}
                title={project.name}
              >
                {currentName || 'Unnamed Project'}
              </h3>
            )}
          </div>
          <div className="mt-1 ml-7 sm:flex sm:items-center sm:space-x-3 text-xs text-slate-500">
            {/* Stakeholders for mobile (xs) */}
            <div className="sm:hidden mb-1 flex items-center text-slate-500">
              <UserGroupIcon className="mr-1 h-4 w-4 flex-shrink-0 text-slate-400" />
              <div className="truncate">
                {renderStakeholders()} 
              </div>
            </div>
            {/* Stakeholders for desktop (sm and up) */}
            <div className="hidden items-center text-slate-500 sm:flex">
              <UserGroupIcon className="mr-1 h-4 w-4 text-slate-400" />
              {project.stakeholders && project.stakeholders.length > 0 
                ? project.stakeholders.join(', ') 
                : <span className="text-slate-400">No stakeholders</span>}
            </div>
            
            {/* Separator, Due Date, Updated Ago for sm and up screens */}
            <div className="hidden sm:flex items-center space-x-3">
              <span className="text-slate-400">•</span>
              <div className={`${dueDateDisplayStatus.classes} break-words`} title={dueDateDisplayStatus.fullDate}>
                  {dueDateDisplayStatus.text}
              </div>
              <span className="text-slate-400">•</span>
              <div className="text-xs text-slate-400">
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
              className={`touch-target-sm text-xs font-medium px-3 py-1.5 rounded-full flex items-center gap-1 whitespace-nowrap border transition ${projectStatusClasses} ${isProjectCompletedOrCancelled ? 'cursor-not-allowed opacity-70' : 'hover:shadow'}`}
            >
              {currentStatus} <ChevronDownIcon className="w-3 h-3 ml-1 opacity-70"/>
            </button>
            {showStatusDropdown && !isProjectCompletedOrCancelled && (
              <div className="absolute right-0 mt-1 w-40 rounded-2xl border border-[#0496c7]/25 bg-white/95 p-1.5 text-xs text-[#036586] shadow-[0_18px_35px_-28px_rgba(4,150,199,0.45)]">
                {projectStatusOptions.map(option => (
                  <button
                    key={option}
                    onClick={(e) => { e.stopPropagation(); handleChangeProjectStatus(option); }}
                    className={`block w-full rounded-xl px-3 py-2 text-left transition hover:bg-[#0496c7]/10 ${option === currentStatus ? 'bg-[#0496c7]/12 font-semibold' : ''}`}
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
                className="flex items-center cursor-pointer hover:bg-slate-200/50 p-0.5 rounded" 
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
                          className="w-full rounded-xl border border-[#0496c7]/25 bg-white px-2 py-1 text-xs text-[#052a3b] shadow-inner shadow-[#0496c7]/10 focus:border-[#0496c7] focus:outline-none focus:ring-2 focus:ring-[#0496c7]/30"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                      />
                      {/* Quick Pick Date Buttons for Inline Edit - ProjectItem */}
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {quickPickOptions.map(option => (
                            <button
                              key={option.label}
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                const newDate = option.getValue();
                                setCurrentDueDate(newDate);
                                createUpdateHandler('due_date', newDate, project.due_date, setCurrentDueDate, setIsEditingDueDate, false, true)();
                              }}
                              className="touch-target-sm px-2 py-0.5 text-[10px] font-medium text-[#036586] rounded-full border border-[#0496c7]/25 hover:border-[#0496c7]/45 hover:bg-[#0496c7]/10 focus:outline-none focus:ring-2 focus:ring-[#0496c7]/30"
                            >
                              {option.label}
                            </button>
                          ))}
                      </div>
                  </div>
              ) : (
                  <button
                    type="button"
                    className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition ${
                      isProjectCompletedOrCancelled
                        ? 'cursor-not-allowed border-transparent text-[#2f617a]/60'
                        : 'border-[#0496c7]/25 text-[#036586] hover:border-[#0496c7]/40 hover:bg-[#0496c7]/10'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isProjectCompletedOrCancelled || isEditingPriority || isEditingStakeholders) return;
                      startEditingDueDate(e);
                    }}
                    title={dueDateDisplayStatus.fullDate || 'Set due date'}
                    disabled={isProjectCompletedOrCancelled || isEditingPriority || isEditingStakeholders}
                  >
                    <CalendarDaysIcon className="h-4 w-4" />
                    <span className="whitespace-nowrap">{dueDateDisplayStatus.text}</span>
                  </button>
              )}
          </div>

          <div className="relative order-4 sm:order-none flex items-center gap-1 text-xs text-[#2f617a] whitespace-nowrap">
              <UserGroupIcon className="w-3.5 h-3.5 opacity-70 flex-shrink-0" />
              {isEditingStakeholders && !isProjectCompletedOrCancelled ? (
                  <input
                      type="text"
                      value={currentStakeholdersText}
                      onChange={handleStakeholdersChange}
                      onBlur={() => handleStakeholdersUpdate()}
                      onKeyDown={handleStakeholdersInputKeyDown}
                      className="w-full sm:w-32 rounded-xl border border-[#0496c7]/25 bg-white px-3 py-1 text-xs text-[#052a3b] shadow-inner shadow-[#0496c7]/10 focus:border-[#0496c7] focus:outline-none focus:ring-2 focus:ring-[#0496c7]/30"
                      placeholder="e.g., Team A, Client"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                  />
              ) : (
                  <button
                      type="button"
                      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 transition ${
                        isProjectCompletedOrCancelled || isEditingPriority || isEditingDueDate
                          ? 'cursor-not-allowed border-transparent text-[#2f617a]/60'
                          : 'border-[#0496c7]/25 text-[#036586] hover:border-[#0496c7]/45 hover:bg-[#0496c7]/10'
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isProjectCompletedOrCancelled || isEditingPriority || isEditingDueDate) return;
                        setIsEditingStakeholders(true);
                        setTargetProjectId(null);
                      }}
                      title={isProjectCompletedOrCancelled ? currentStakeholdersText || 'Stakeholders not editable' : currentStakeholdersText || 'Add stakeholders'}
                      disabled={isProjectCompletedOrCancelled || isEditingPriority || isEditingDueDate}
                  >
                      <span className="font-medium">Stakeholders:</span>
                      <span className="truncate max-w-[6.5rem] sm:max-w-none">{currentStakeholdersText || 'None'}</span>
                  </button>
              )}
          </div>

          <div className="relative order-last sm:order-none ml-auto sm:ml-0 flex items-center gap-x-1">
              <button
                onClick={(e) => { e.stopPropagation(); setShowProjectNotes(!showProjectNotes); }}
                className="icon-button rounded-full text-slate-400 hover:bg-slate-200 hover:text-indigo-600 flex items-center focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:ring-offset-1"
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
                className="icon-button rounded-full text-slate-400 hover:bg-slate-200 hover:text-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:ring-offset-1"
                title={`Copy project data (${copyStatus})`}
              >
                <ClipboardDocumentIcon className="h-5 w-5" />
              </button>

              <button
                onClick={(e) => { e.stopPropagation(); handleDeleteProject(); }}
                className="icon-button rounded-full text-red-500 hover:bg-red-50 focus:outline-none focus:ring-1 focus:ring-red-400 focus:ring-offset-1"
                title="Delete project"
                type="button"
              >
                <TrashIcon className="h-5 w-5" />
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
              className={`text-xs text-slate-500 whitespace-pre-wrap break-words ${!isProjectCompletedOrCancelled ? 'cursor-text hover:bg-gray-50 p-0.5 -m-0.5 rounded' : 'text-slate-400'}`}
              onClick={startEditingDescription}
            >
              {currentDescription}
            </p>
          ) : !isProjectCompletedOrCancelled ? (
            <p 
              className="text-xs text-slate-400 italic cursor-text hover:bg-gray-50 p-0.5 -m-0.5 rounded break-words"
              onClick={startEditingDescription}
            >
              Add project description...
            </p>
          ) : null}
        </div>
      </div>

      {showTasks && (
        <div className="mt-3">
          <QuickTaskForm
            onSubmit={submitQuickTask}
            namePlaceholder="Add a task..."
            buttonLabel="Add Task"
            buttonIcon={PlusCircleIcon}
            priorityType="select"
            priorityOptions={[
              { value: 'Low', label: 'Low' },
              { value: 'Medium', label: 'Medium' },
              { value: 'High', label: 'High' },
            ]}
            defaultPriority="Medium"
            defaultDueDate={getTodayISODate()}
            className="rounded-2xl border border-[#0496c7]/20 bg-white/90 p-3 shadow-inner shadow-[#0496c7]/10"
          />
        </div>
      )}

      {showTasks && (
          <div className="border-t border-gray-200 bg-gray-50/50">
            <div className="px-2.5 sm:px-3 py-1.5 flex justify-between items-center">
        <div className="flex items-center gap-2">
            <h4 className="text-xs font-semibold text-slate-600">
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
            </div>
            <div className="px-2.5 sm:px-3 pb-2">
              {isLoadingTasks ? (
                <div className="flex items-center justify-center rounded-2xl border border-[#0496c7]/25 bg-white/85 py-3 text-xs text-[#036586] shadow-inner shadow-[#0496c7]/10">
                  Loading tasks…
                </div>
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
                <div className="rounded-2xl border border-dashed border-[#0496c7]/30 bg-[#0496c7]/5 px-3 py-2 text-xs text-[#036586]/80">
                  No tasks yet—use the quick add above to create one.
                </div>
              )}
            </div>
          </div>
      )}

      {/* Project Notes Section */}
      {showProjectNotes && (
        <div id={`project-notes-section-${project.id}`} className="border-t border-gray-200 px-3 sm:px-4 py-1.5">
          <h4 className="text-xs font-semibold text-slate-600 mb-1.5">Project Notes</h4>
          <AddNoteForm
            parentId={project.id}
            onNoteAdded={handleProjectNoteAdded}
            disabled={isProjectCompletedOrCancelled}
          />
          {isLoadingProjectNotes ? (
            <p className="text-xs text-slate-400 py-2">Loading notes...</p>
          ) : projectNotes.length > 0 ? (
            <NoteList notes={projectNotes} />
          ) : (
            <p className="text-xs text-slate-400 italic py-2">No notes for this project yet.</p>
          )}
        </div>
      )}
      
      <ProjectCompletionModal
        isOpen={showCompletionModal}
        onClose={handleCloseCompletionModal}
        onConfirmCompleteTasks={handleConfirmCompleteTasksAndProject}
        projectName={currentName}
        openTasksCount={tasks.filter(task => !task.is_completed).length}
      />
    </div>
    </div>
  );
});

ProjectItem.displayName = 'ProjectItem';

export default React.memo(ProjectItem);
