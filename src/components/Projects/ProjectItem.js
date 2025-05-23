'use client';

import React, { useState, useEffect, useCallback, forwardRef } from 'react';
import { differenceInDays, format, isToday, isTomorrow, isPast, startOfDay, formatDistanceToNowStrict, parseISO } from 'date-fns';
import { supabase } from '@/lib/supabaseClient';
import { quickPickOptions } from '@/lib/dateUtils';
import { 
  ChevronDownIcon, ChevronUpIcon, PlusCircleIcon, EyeIcon, EyeSlashIcon, 
  ChatBubbleLeftEllipsisIcon, ClipboardDocumentIcon, EllipsisVerticalIcon,
  PencilIcon, UserGroupIcon, ChevronRightIcon
} from '@heroicons/react/24/outline';
import TaskList from '@/components/Tasks/TaskList';
import AddTaskModal from '@/components/Tasks/AddTaskModal';
import NoteList from '@/components/Notes/NoteList';
import AddNoteForm from '@/components/Notes/AddNoteForm';
import ProjectCompletionModal from './ProjectCompletionModal';
import { useTargetProject } from '@/contexts/TargetProjectContext';

const getPriorityClasses = (priority) => {
  switch (priority) {
    case 'High':
      return 'border-l-4 border-red-500 bg-red-50';
    case 'Medium':
      return 'border-l-4 border-yellow-500 bg-yellow-50';
    case 'Low':
      return 'border-l-4 border-green-500 bg-green-50';
    default:
      return 'border-l-4 border-gray-300 bg-gray-50';
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
  let text = `Due ${format(date, 'MMM d, yyyy')}`;
  let classes = 'text-gray-600 text-xs font-medium';
  let sortKey = daysDiff;
  const fullDateText = format(date, 'MMM d, yyyy');

  if (isToday(date)) {
    text = `Due Today`;
    classes = 'text-red-500 text-xs font-semibold';
    sortKey = 0;
  } else if (isTomorrow(date)) {
    text = `Due Tomorrow`;
    classes = 'text-yellow-600 text-xs font-semibold';
    sortKey = 1;
  } else if (isPast(date) && !isToday(date)) {
    text = `Overdue`;
    classes = 'text-red-600 text-xs font-semibold';
    sortKey = -Infinity + daysDiff;
  } else if (daysDiff > 0 && daysDiff <= 7) {
    text = `Due in ${daysDiff}d`;
  } else if (daysDiff > 7) {
    text = `Due ${format(date, 'MMM d')}`;
  }
  return { text, classes, fullDate: fullDateText, sortKey };
};

const getStatusClasses = (status) => {
  switch (status) {
    case 'Completed':
      return 'bg-green-100 text-green-700';
    case 'In Progress':
      return 'bg-blue-100 text-blue-700';
    case 'On Hold':
      return 'bg-yellow-100 text-yellow-700';
    case 'Cancelled':
      return 'bg-red-100 text-red-700';
    case 'Open':
    default:
      return 'bg-gray-100 text-gray-700';
  }
};

const ProjectItem = forwardRef(({ project, onProjectDataChange, onProjectDeleted, areAllTasksExpanded }, ref) => {
  const [tasks, setTasks] = useState([]);
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

  const fetchTasks = useCallback(async () => {
    if (!project || !project.id) return;
    setIsLoadingTasks(true);
    try {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('project_id', project.id)
        .order('is_completed', { ascending: true })
        .order('priority', { ascending: false, nullsFirst: false, foreignTable: undefined })
        .order('due_date', { ascending: true, nullsFirst: false });
      if (error) throw error;
      setTasks(data || []);
    } catch (err) {
      console.error(`Error fetching tasks for project ${project.id}:`, err);
      setTasks([]);
    } finally {
      setIsLoadingTasks(false);
    }
  }, [project]);

  useEffect(() => {
    if (project && project.id) fetchTasks();
  }, [project, fetchTasks]);

  const fetchProjectNotes = useCallback(async () => {
    if (!project || !project.id) return;
    setIsLoadingProjectNotes(true);
    try {
      const { data, error } = await supabase
        .from('notes')
        .select('*')
        .eq('project_id', project.id)
        .is('task_id', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setProjectNotes(data || []);
    } catch (err) {
      console.error('Error fetching notes for project:', err);
      setProjectNotes([]);
    } finally {
      setIsLoadingProjectNotes(false);
    }
  }, [project]);

  useEffect(() => {
    if (showProjectNotes && project && project.id) fetchProjectNotes();
  }, [showProjectNotes, project, fetchProjectNotes]);

  // Fetch project notes on initial mount or when project.id changes to get note count
  useEffect(() => {
    if (project && project.id) {
      fetchProjectNotes();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]); // fetchProjectNotes is memoized with project, so direct project.id is fine

  if (!project) return null;

  const projectPriorityClasses = getPriorityClasses(currentPriority);
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
      console.warn('Cannot update project timestamp: project or project.id is missing.');
      return;
    }
    try {
      const { error } = await supabase
        .from('projects')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', project.id);
      if (error) {
        console.error('Error updating project timestamp in DB:', error);
        // Potentially alert the user or log more formally
      }
    } catch (err) {
      console.error('Exception while updating project timestamp:', err);
    }
  };

  const handleTaskAdded = (newTask) => {
    const newTasks = [newTask, ...tasks].sort((a, b) => {
        if (a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1;
        // Add secondary sort if needed, e.g., by created_at or priority
        return 0;
    });
    setTasks(newTasks);
    setShowAddTaskModal(false);
    if (onProjectDataChange && project && newTask) { // Ensure newTask is valid
        onProjectDataChange(newTask.project_id, newTask, 'task_added');
    }
    // updateParentProjectTimestamp(); // This might be redundant if DashboardPage handles project updated_at
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
        onProjectDataChange(updatedTask.project_id, updatedTask, 'task_updated');
    }
    // updateParentProjectTimestamp(); // Redundant if DashboardPage handles it

    if (updatedTask.is_completed && project) {
      const allTasksForProjectNowComplete = updatedTasks.every(t => t.is_completed);
      if (allTasksForProjectNowComplete && updatedTasks.length > 0) { 
        setTimeout(() => {
          alert(`Project '${project.name}' now has no open tasks. Consider adding new tasks or updating the project status.`);
          setTargetProjectId(project.id);
        }, 100); 
      }
    }
  };

  const handleDeleteProject = async () => {
    if (project && window.confirm('Are you sure you want to delete project "' + project.name + '" and all its tasks? This action cannot be undone.')) {
        try {
            const { error } = await supabase.from('projects').delete().eq('id', project.id);
            if (error) throw error;
            if (onProjectDeleted) onProjectDeleted(project.id);
        } catch (err) {
            console.error('Error deleting project:', err);
            alert(`Failed to delete project: ${err.message}`);
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
    return `  - Note (${format(new Date(note.created_at), 'MMM d, yyyy h:mm a')}): ${note.content}`;
  };

  const handleCopyProjectData = async () => {
    if (!project) return;
    setCopyStatus('Copying...');
    let projectDataText = `Project Name: ${project.name}\n`;
    projectDataText += `Status: ${currentStatus}\n`;
    projectDataText += `Priority: ${currentPriority}\n`;
    projectDataText += `Due Date: ${project.due_date ? format(new Date(project.due_date), 'MMM d, yyyy') : 'N/A'}\n`;
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

    // Fetch all tasks for this project to ensure we have latest, including their notes
    try {
      const { data: tasksWithDetails, error: tasksError } = await supabase
        .from('tasks')
        .select('*, notes(*)') // Fetch tasks and their related notes
        .eq('project_id', project.id)
        .order('created_at', { ascending: true });

      if (tasksError) throw tasksError;

      if (tasksWithDetails && tasksWithDetails.length > 0) {
        tasksWithDetails.forEach(taskItem => {
          // Exclude taskItem.id and taskItem.project_id
          projectDataText += `  - Task: ${taskItem.name}\n`;
          projectDataText += `    Description: ${taskItem.description || 'N/A'}\n`;
          projectDataText += `    Due Date: ${taskItem.due_date ? format(new Date(taskItem.due_date), 'MMM d, yyyy') : 'N/A'}\n`;
          projectDataText += `    Priority: ${taskItem.priority || 'N/A'}\n`;
          projectDataText += `    Completed: ${taskItem.is_completed ? 'Yes' : 'No'}\n`;
          if (taskItem.completed_at && taskItem.is_completed) {
            projectDataText += `    Completed At: ${format(new Date(taskItem.completed_at), 'MMM d, yyyy h:mm a')}\n`;
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
      console.error('Error fetching tasks and notes for copy:', err);
      projectDataText += `  Error fetching task details.\n`;
      setCopyStatus('Error!');
      setTimeout(() => setCopyStatus('Copy'), 2000);
      return;
    }

    try {
      await navigator.clipboard.writeText(projectDataText);
      setCopyStatus('Copied!');
    } catch (err) {
      console.error('Failed to copy project data:', err);
      setCopyStatus('Failed!');
    }
    setTimeout(() => setCopyStatus('Copy'), 2000);
  };
  
  const updateProjectStatusInDb = async (newStatus) => {
    if (!project) return false;
    try {
      const { data, error } = await supabase
        .from('projects')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', project.id)
        .select()
        .single();
      if (error) throw error;
      setCurrentStatus(newStatus);
      if (onProjectDataChange && project) { // Pass the full updated project object or essential fields
          onProjectDataChange(project.id, data, 'project_status_changed');
      }
      return true;
    } catch (err) {
      console.error('Error updating project status:', err);
      alert(`Failed to update project status: ${err.message}`);
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
        const updates = openTasks.map(task => 
          supabase.from('tasks').update({ 
            is_completed: true, 
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }).eq('id', task.id)
        );
        await Promise.all(updates);
        fetchTasks();
      } catch (err) {
        console.error('Error completing open tasks:', err);
        alert('Could not complete all open tasks. Project status not changed.');
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
        alert('Cannot update: project data is missing.');
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
      const { data, error } = await supabase.from('projects').update(updateObject).eq('id', project.id).select().single();
      if (error) throw error;
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
         alert(`Failed to update project ${field}. No data returned.`);
         setter(
            isDate ? (originalValue ? format(new Date(originalValue), 'yyyy-MM-dd') : '') :
            isArray ? (originalValue ? originalValue.join(', ') : '') :
            (originalValue || (isDate ? '' : ''))
         );
      }
    } catch (err) {
      console.error(`Error updating project ${field}:`, err);
      alert(`Failed to update project ${field}: ${err.message}`);
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
      className={`rounded-lg shadow-md mb-3 transition-all duration-300 ease-in-out hover:shadow-lg ${projectPriorityClasses} ${isProjectCompletedOrCancelled ? 'opacity-70' : ''}`}>
      <div 
        className="p-2.5 sm:p-3 border-b border-gray-200 cursor-pointer" 
        onClick={() => !isMenuOpen && !isEditingName && !isEditingDueDate && !isEditingPriority && !isEditingStakeholders && setShowTasks(!showTasks)} 
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
                onBlur={handleNameUpdate}
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
              <div className={`${dueDateDisplayStatus.classes}`}>
                  {dueDateDisplayStatus.text}
              </div>
              <span className="text-gray-400">•</span>
              <div className="text-xs text-gray-500">
                  Updated {updatedAgo}
              </div>
            </div>

            {/* Due Date and Updated Ago for xs screens (stacked) */}
            <div className="sm:hidden mt-1">
                <div className={`${dueDateDisplayStatus.classes} mb-0.5`}>
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
              className={`text-xs font-medium px-2 py-1 rounded-full flex items-center whitespace-nowrap ${projectStatusClasses} ${isProjectCompletedOrCancelled ? 'cursor-not-allowed' : 'hover:opacity-80'}`}
            >
              {currentStatus} <ChevronDownIcon className="w-3 h-3 ml-1 opacity-70"/>
            </button>
            {showStatusDropdown && !isProjectCompletedOrCancelled && (
              <div className="absolute right-0 mt-1 w-36 bg-white rounded-md shadow-lg z-20 border border-gray-200 py-0.5">
                {projectStatusOptions.map(option => (
                  <button
                    key={option}
                    onClick={(e) => { e.stopPropagation(); handleChangeProjectStatus(option); }}
                    className="block w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 focus:bg-gray-100"
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative order-2 sm:order-none">
            <select
              value={currentPriority}
              onChange={(e) => { 
                  setCurrentPriority(e.target.value); 
                  handlePriorityUpdate(e.target.value);
              }}
              className={`${commonInputClasses} w-28`}
              onClick={handlePrioritySelectClick}
            >
              {priorityOptions.map(p => <option key={p} value={p}>{p} Priority</option>)}
            </select>
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
                              className="px-1.5 py-0.5 text-3xs font-medium text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-full cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-300"
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
                      {!isProjectCompletedOrCancelled && !isEditingPriority && !isEditingStakeholders && <PencilIcon className="w-3 h-3 opacity-60" />}
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
                      onBlur={handleStakeholdersUpdate}
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

          <div className="relative order-last sm:order-none ml-auto sm:ml-0">
              <button 
                  onClick={(e) => { e.stopPropagation(); setIsMenuOpen(!isMenuOpen);}}
                  className="p-1.5 rounded-full hover:bg-gray-200 text-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:ring-offset-1"
                  aria-haspopup="true" aria-expanded={isMenuOpen}
                  title="More actions"
              >
                  <EllipsisVerticalIcon className="h-5 w-5"/>
              </button>
              {isMenuOpen && (
                  <div className="absolute right-0 mt-1 w-48 bg-white rounded-md shadow-lg z-30 border border-gray-200 py-1" role="menu">
                      <div className="flex items-center">
                        <button 
                          onClick={() => setShowProjectNotes(!showProjectNotes)} 
                          className="p-1 text-gray-500 hover:text-indigo-600 flex items-center"
                          aria-expanded={showProjectNotes}
                          aria-controls={`project-notes-section-${project.id}`}
                          disabled={isLoadingProjectNotes}
                        >
                          <ChatBubbleLeftEllipsisIcon className="h-5 w-5" />
                          {projectNotes.length > 0 && (
                            <span className="ml-1 text-xs font-medium text-indigo-600">
                              ({projectNotes.length})
                            </span>
                          )}
                      </button>
                        <button onClick={handleCopyProjectData} className="p-1 text-gray-500 hover:text-indigo-600">
                          <ClipboardDocumentIcon className="h-5 w-5" />
                      </button>
                      </div>
                      {!isProjectCompletedOrCancelled && (
                          <button onClick={(e) => {e.stopPropagation(); setShowAddTaskModal(true); setIsMenuOpen(false);}} className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2">
                             <PlusCircleIcon className="h-4 w-4"/> Add Task
                          </button>
                      )}
                       <div className="my-1 border-t border-gray-100"></div>
                      <button onClick={(e) => {e.stopPropagation(); handleDeleteProject();}} className="w-full text-left px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
                         <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12.56 0c1.153 0 2.243.032 3.223.094C7.572 6.21 7.994 6.5 8.382 6.962a4.928 4.928 0 0 1 .664.986M14.74 9h-2.556M14.74 9L6.26 9m9.968-3.21c-.664.006-1.32.028-1.973.064M4.772 5.79c-.023.009-.045.017-.067.026M4.772 5.79L3 19.673C3 20.805 3.794 21.75 4.839 21.75H19.16c1.046 0 1.84-0.945 1.84-2.077L19.23 5.79m-14.456 0a48.108 48.108 0 0 0-3.478-.397m-12.56 0c1.153 0 2.243.032 3.223.094C7.572 6.21 7.994 6.5 8.382 6.962a4.928 4.928 0 0 1 .664.986" /></svg>
                         Delete Project
                      </button>
                  </div>
              )}
          </div>
        </div>

        <div className={`px-2.5 sm:px-3 pt-0.5 pb-1.5 border-t border-gray-200/50`}>
          {isEditingDescription && !isProjectCompletedOrCancelled ? (
            <textarea
              value={currentDescription}
              onChange={handleDescriptionChange}
              onBlur={handleDescriptionUpdate}
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
              className="text-xs text-gray-400 italic cursor-text hover:bg-gray-50 p-0.5 -m-0.5 rounded"
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
                        className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center"
                    >
                        {showCompletedTasks ? <EyeSlashIcon className="w-3.5 h-3.5 mr-1"/> : <EyeIcon className="w-3.5 h-3.5 mr-1"/>}
                        {showCompletedTasks ? 'Hide' : 'Show'} Completed
                    </button>
                )}
              </div>
              {!isProjectCompletedOrCancelled && (
                <button
                    onClick={(e) => { e.stopPropagation(); setShowAddTaskModal(true);}}
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

export default ProjectItem;