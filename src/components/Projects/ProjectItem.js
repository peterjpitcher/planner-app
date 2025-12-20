'use client';

import React, { useState, useEffect, useCallback, forwardRef } from 'react';
import { format } from 'date-fns';
import { apiClient } from '@/lib/apiClient';
import { handleSupabaseError, handleError } from '@/lib/errorHandler';
import { EyeIcon, EyeSlashIcon, PlusCircleIcon } from '@heroicons/react/24/outline';
import TaskList from '@/components/tasks/TaskList';
import NoteList from '@/components/notes/NoteList';
import AddNoteForm from '@/components/notes/AddNoteForm';
import ProjectNoteWorkspaceModal from '@/components/notes/ProjectNoteWorkspaceModal';
import ProjectCompletionModal from './ProjectCompletionModal';
import ProjectHeader from './ProjectHeader';
import { useTargetProject } from '@/contexts/TargetProjectContext';
import { useSession } from 'next-auth/react';
import QuickTaskForm from '@/components/tasks/QuickTaskForm';
import { DRAG_DATA_TYPES } from '@/lib/constants';
import { getPriorityClasses } from '@/lib/projectHelpers';

const getTodayISODate = () => format(new Date(), 'yyyy-MM-dd');

const ProjectItem = forwardRef((
  {
    project,
    tasks: propTasks,
    notes: propNotes,
    notesByTask,
    onProjectDataChange,
    onProjectDeleted,
    areAllTasksExpanded,
    isDropMode = false,
    dragSourceProjectId = null,
    onTaskDragStateChange = () => { },
  },
  ref
) => {
  const { data: session } = useSession();
  const currentUser = session?.user;

  // Task State
  const [tasks, setTasks] = useState(propTasks || []);
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);
  const [showTasks, setShowTasks] = useState(areAllTasksExpanded !== undefined ? areAllTasksExpanded : true);
  const [showCompletedTasks, setShowCompletedTasks] = useState(false);

  // Note State
  const [showProjectNotes, setShowProjectNotes] = useState(false);
  const [projectNotes, setProjectNotes] = useState(propNotes || []);
  const [isLoadingProjectNotes, setIsLoadingProjectNotes] = useState(false);
  const [isNoteWorkspaceOpen, setIsNoteWorkspaceOpen] = useState(false);

  // Modal State
  const [copyStatus, setCopyStatus] = useState('Copy');
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [statusToConfirm, setStatusToConfirm] = useState(null);
  const [isDragOverTarget, setIsDragOverTarget] = useState(false);

  const { setTargetProjectId } = useTargetProject();
  const isUnassignedProject = project?.name?.toLowerCase() === 'unassigned';
  const isProjectCompletedOrCancelled = project?.status === 'Completed' || project?.status === 'Cancelled';

  useEffect(() => {
    if (areAllTasksExpanded !== undefined) {
      setShowTasks(areAllTasksExpanded);
    }
  }, [areAllTasksExpanded]);

  // Update tasks when propTasks changes
  useEffect(() => {
    if (propTasks) {
      const sortedTasks = [...propTasks].sort((a, b) => {
        if (a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1;
        const dateA = a.due_date ? new Date(a.due_date) : null;
        const dateB = b.due_date ? new Date(b.due_date) : null;
        if (dateA && dateB) return dateA - dateB;
        if (dateA) return -1;
        if (dateB) return 1;
        const priorityOrder = { 'High': 0, 'Medium': 1, 'Low': 2 };
        return (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3);
      });
      setTasks(sortedTasks);
    }
  }, [propTasks]);

  // Update notes when propNotes changes
  useEffect(() => {
    if (propNotes) {
      const sortedNotes = [...propNotes].sort((a, b) =>
        new Date(b.created_at) - new Date(a.created_at)
      );
      setProjectNotes(sortedNotes);
    }
  }, [propNotes]);

  const fetchProjectNotes = useCallback(async () => {
    if (!project || !project.id) return;
    // If we already have notes from props and they are not empty, avoid re-fetching unless forced
    // But for now, let's allow re-fetch to ensure latest data if needed, or just rely on props.
    // Since Dashboard fetches all notes, we might just want to rely on that to avoid double fetch.
    // However, opening the notes section implies user wants to see notes, so maybe a fresh fetch isn't bad.
    // Let's keep it but optimized.
    if (propNotes && propNotes.length > 0) return;

    setIsLoadingProjectNotes(true);
    try {
      const data = await apiClient.getNotes(project.id);
      const sortedNotes = (data || []).sort((a, b) =>
        new Date(b.created_at) - new Date(a.created_at)
      );
      setProjectNotes(sortedNotes);
    } catch (err) {
      handleError(err, 'fetchProjectNotes');
      setProjectNotes([]);
    } finally {
      setIsLoadingProjectNotes(false);
    }
  }, [project, propNotes]);

  useEffect(() => {
    if (showProjectNotes && project && project.id) fetchProjectNotes();
  }, [showProjectNotes, project, fetchProjectNotes]);

  useEffect(() => {
    if (isNoteWorkspaceOpen && project && project.id) {
      fetchProjectNotes();
    }
  }, [isNoteWorkspaceOpen, project, fetchProjectNotes]);

  if (!project) return null;

  const priorityStyles = getPriorityClasses(project.priority);

  const openTasks = tasks.filter(task => !task.is_completed);
  const openTasksCount = openTasks.length;
  const completedTasksCount = tasks.length - openTasksCount;

  const handleUpdateProject = async (updates) => {
    // Intercept status change for completion modal
    if (updates.status === 'Completed' && openTasksCount > 0) {
      setStatusToConfirm('Completed');
      setShowCompletionModal(true);
      return; // Don't update yet
    }

    try {
      const data = await apiClient.updateProject(project.id, {
        ...updates,
        updated_at: new Date().toISOString()
      });

      if (onProjectDataChange && data) {
        onProjectDataChange(project.id, data, 'project_details_changed');
      }
    } catch (err) {
      handleError(err, 'handleUpdateProject', { showAlert: true });
      throw err; // Re-throw so child can revert state
    }
  };

  const handleTaskAdded = (newTask) => {
    const newTasks = [newTask, ...tasks].sort((a, b) => {
      if (a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1;
      return 0;
    });
    setTasks(newTasks);
    onProjectDataChange(project.id, { ...project, updated_at: new Date().toISOString() }, 'task_added', { task: newTask });
  };

  const handleTaskUpdated = (updatedTask) => {
    const updatedTasks = tasks.map(t => t.id === updatedTask.id ? updatedTask : t)
      .sort((a, b) => {
        if (a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1;
        return 0;
      });
    setTasks(updatedTasks);

    if (onProjectDataChange && project && updatedTask) {
      onProjectDataChange(project.id, updatedTask, 'task_updated');
    }

    if (updatedTask.is_completed && project) {
      const allTasksForProjectNowComplete = updatedTasks.every(t => t.is_completed);
      if (allTasksForProjectNowComplete && updatedTasks.length > 0 && !isProjectCompletedOrCancelled) {
        setTargetProjectId(project.id);
      }
    }
  };

  const completeOpenTaskFromWorkspace = async (taskId) => {
    if (!taskId) return;
    try {
      const updatedTask = await apiClient.updateTask(taskId, {
        is_completed: true,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      if (updatedTask) {
        handleTaskUpdated(updatedTask);
      }
    } catch (err) {
      handleError(err, 'completeOpenTaskFromWorkspace', { showAlert: true });
      throw err;
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
    if (onProjectDataChange) onProjectDataChange(project.id, { updated_at: new Date().toISOString() }, 'project_details_changed');
  };

  const formatNoteForCopy = (note) => {
    if (!note) return '';
    return `  - Note (${format(new Date(note.created_at), 'EEEE, MMM do, yyyy h:mm a')}): ${note.content}`;
  };

  const handleCopyProjectData = async () => {
    if (!project) return;
    setCopyStatus('Copying...');
    let projectDataText = `Project Name: ${project.name}\n`;
    projectDataText += `Status: ${project.status}\n`;
    projectDataText += `Priority: ${project.priority}\n`;
    projectDataText += `Due Date: ${project.due_date ? format(new Date(project.due_date), 'EEEE, MMM do, yyyy') : 'N/A'}\n`;
    projectDataText += `Description: ${project.description || 'N/A'}\n`;
    projectDataText += `Stakeholders: ${project.stakeholders && project.stakeholders.length > 0 ? project.stakeholders.join(', ') : 'N/A'}\n`;

    if (projectNotes.length > 0) {
      projectDataText += `\nProject Notes:\n`;
      projectNotes.forEach(note => {
        projectDataText += `${formatNoteForCopy(note)}\n`;
      });
    }

    projectDataText += `\nTasks:\n`;

    try {
      const tasksWithDetails = await apiClient.getTasks(project.id);
      const tasksWithNotes = await Promise.all(
        tasksWithDetails.map(async (task) => {
          try {
            const notes = await apiClient.getNotes(null, task.id);
            return { ...task, notes: notes || [] };
          } catch (err) {
            return { ...task, notes: [] };
          }
        })
      );

      if (tasksWithNotes && tasksWithNotes.length > 0) {
        tasksWithNotes.forEach(taskItem => {
          projectDataText += `  - Task: ${taskItem.name}\n`;
          projectDataText += `    Description: ${taskItem.description || 'N/A'}\n`;
          projectDataText += `    Due Date: ${taskItem.due_date ? format(new Date(taskItem.due_date), 'EEEE, MMM do, yyyy') : 'N/A'}\n`;
          projectDataText += `    Priority: ${taskItem.priority || 'N/A'}\n`;
          projectDataText += `    Completed: ${taskItem.is_completed ? 'Yes' : 'No'}\n`;
          if (taskItem.completed_at && taskItem.is_completed) {
            projectDataText += `    Completed At: ${format(new Date(taskItem.completed_at), 'EEEE, MMM do, yyyy h:mm a')}\n`;
          }
          if (taskItem.notes && taskItem.notes.length > 0) {
            projectDataText += `    Task Notes:\n`;
            taskItem.notes.forEach(note => {
              projectDataText += `    ${formatNoteForCopy(note)}\n`;
            });
          }
          projectDataText += `\n`;
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

  const handleConfirmCompleteTasksAndProject = async () => {
    setShowCompletionModal(false);
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
        // Force reload tasks? Usually not needed if we trust the loop
      } catch (err) {
        handleError(err, 'handleConfirmCompleteTasksAndProject', {
          showAlert: true,
          fallbackMessage: 'Could not complete all open tasks. Project status not changed.'
        });
        return;
      }
    }
    if (statusToConfirm) {
      try {
        await apiClient.updateProject(project.id, {
          status: statusToConfirm,
          updated_at: new Date().toISOString()
        });
        // Update via parent callback
        onProjectDataChange(project.id, { ...project, status: statusToConfirm }, 'project_status_changed');
      } catch (e) {
        // ignore
      }
      setStatusToConfirm(null);
    }
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

  const canAcceptTaskDrag = (event) => {
    const types = Array.from(event.dataTransfer?.types || []);
    if (!types.length) return false;
    return types.includes(DRAG_DATA_TYPES.TASK) || types.includes('application/json') || types.includes('text/plain');
  };

  const handleDragEnter = (event) => {
    if (!project?.id || !canAcceptTaskDrag(event)) return;
    event.preventDefault();
    setIsDragOverTarget(true);
  };

  const handleDragOver = (event) => {
    if (!project?.id || !canAcceptTaskDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleDragLeave = (event) => {
    if (!project?.id) return;
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setIsDragOverTarget(false);
  };

  const handleDrop = async (event) => {
    if (!project?.id || !canAcceptTaskDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setIsDragOverTarget(false);

    let rawData = '';
    try {
      rawData = event.dataTransfer.getData(DRAG_DATA_TYPES.TASK);
    } catch (err) {
      rawData = '';
    }
    if (!rawData) {
      rawData = event.dataTransfer.getData('application/json') || event.dataTransfer.getData('text/plain');
    }
    if (!rawData) return;

    let payload;
    try {
      payload = JSON.parse(rawData);
    } catch (parseError) {
      return;
    }

    const { taskId, previousProjectId } = payload || {};
    if (!taskId || previousProjectId === project.id) {
      return;
    }

    try {
      const updatedTask = await apiClient.updateTask(taskId, { project_id: project.id });
      if (onProjectDataChange && updatedTask) {
        onProjectDataChange(project.id, updatedTask, 'task_updated', {
          previousProjectId,
          project,
        });
      }
    } catch (err) {
      handleError(err, 'taskReassignment');
    } finally {
      if (onTaskDragStateChange) {
        onTaskDragStateChange(false, null);
      }
    }
  };

  const isSourceProject = dragSourceProjectId !== null && project?.id === dragSourceProjectId;
  const shouldShowDropPreview = isDropMode && !isSourceProject;

  const projectCardStyle = isUnassignedProject
    ? 'border-[#0496c7]/25 bg-white/95 shadow-[0_24px_60px_-32px_rgba(4,150,199,0.35)]'
    : priorityStyles.cardOuterClass;

  const baseShadow = shouldShowDropPreview ? 'shadow-[0_20px_50px_-32px_rgba(4,150,199,0.4)]' : 'shadow-[0_28px_60px_-32px_rgba(4,150,199,0.35)]';
  const hoverClass = shouldShowDropPreview || isUnassignedProject ? '' : 'transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_40px_70px_-28px_rgba(4,150,199,0.45)]';
  const paddingClass = shouldShowDropPreview ? 'p-4 sm:p-6' : 'p-4 sm:p-6';
  const containerClassName = `relative overflow-hidden rounded-3xl border bg-white/80 ${paddingClass} ${baseShadow} ${hoverClass} ${projectCardStyle} ${isProjectCompletedOrCancelled ? 'opacity-60 saturate-75' : ''} ${isDragOverTarget ? 'ring-2 ring-indigo-300 ring-offset-2' : ''}`;
  const totalTasksCount = tasks.length;
  const dropStatusText = isDragOverTarget ? 'Release to assign' : 'Drop here to move task';

  const containerProps = {
    ref,
    id: `project-item-${project.id}`,
    className: containerClassName,
    onDragEnter: handleDragEnter,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
    'data-project-id': project.id,
  };

  if (shouldShowDropPreview) {
    // Keep simplified drop preview
    return (
      <div {...containerProps}>
        <span className={`pointer-events-none absolute inset-x-3 top-2 h-[6px] rounded-full bg-gradient-to-r ${priorityStyles.ribbonClass}`} />
        <div className={`pointer-events-none absolute -top-10 right-0 h-32 w-32 rounded-full ${priorityStyles.glowClass} blur-3xl`} />
        <div className="relative z-10">
          <div className="rounded-2xl bg-white/75 p-4 sm:p-6 shadow-inner shadow-slate-200/40 transition-colors">
            {/* Minimal Drop Content */}
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">{project.name || 'Unnamed Project'}</p>
                <p className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${isDragOverTarget ? 'text-emerald-500' : 'text-[#036586]/70'}`}>
                  {dropStatusText}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isUnassignedProject) {
    return (
      <div {...containerProps}>
        <div className="rounded-3xl border border-[#0496c7]/20 bg-white/95 shadow-[0_24px_60px_-32px_rgba(4,150,199,0.35)]">
          <div className="flex items-center justify-between px-4 py-3 sm:px-6 border-b border-[#0496c7]/15">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[#036586]">Unassigned Tasks</h3>
            {tasks.length > 0 && completedTasksCount > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowCompletedTasks(!showCompletedTasks); }}
                className="touch-target-sm text-2xs font-semibold text-[#036586] hover:text-[#0496c7]"
              >
                {showCompletedTasks ? 'Hide completed' : 'Show completed'}
              </button>
            )}
          </div>
          <div className="p-4 sm:p-6">
            {isLoadingTasks ? (
              <div className="flex items-center justify-center rounded-2xl border border-[#0496c7]/20 bg-white/85 py-4 text-xs text-[#036586] shadow-inner shadow-[#0496c7]/10">
                Loading tasks…
              </div>
            ) : tasks.length > 0 ? (
              <TaskList
                tasks={tasks}
                notesByTask={notesByTask}
                isLoading={isLoadingTasks}
                onTaskUpdated={handleTaskUpdated}
                showCompletedTasks={showCompletedTasks}
                isProjectCompleted={false}
                onTaskDragStateChange={onTaskDragStateChange}
              />
            ) : (
              <div className="rounded-2xl border border-dashed border-[#0496c7]/25 bg-[#0496c7]/5 px-3 py-4 text-sm text-[#036586]/80 text-center">
                No unassigned tasks. Add one from the flight board.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div {...containerProps}>
      <span className={`pointer-events-none absolute inset-x-3 top-2 h-[6px] rounded-full bg-gradient-to-r ${priorityStyles.ribbonClass}`} />
      <div className={`pointer-events-none absolute -top-10 right-0 h-32 w-32 rounded-full ${priorityStyles.glowClass} blur-3xl`} />

      <ProjectHeader
        project={project}
        isExpanded={showTasks}
        onToggleExpand={() => setShowTasks(!showTasks)}
        onUpdate={handleUpdateProject}
        onDelete={handleDeleteProject}
        onCopy={handleCopyProjectData}
        onToggleNotes={() => setShowProjectNotes(!showProjectNotes)}
        showNotes={showProjectNotes}
        notesCount={projectNotes.length}
        isLoadingNotes={isLoadingProjectNotes}
        onOpenWorkspace={() => setIsNoteWorkspaceOpen(true)}
        openTasksCount={openTasksCount}
        totalTasksCount={totalTasksCount}
        isDragOverTarget={isDragOverTarget}
        dropStatusText={dropStatusText}
      />

      {showTasks && (
        <div className="mt-3 relative z-10">
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
        <div className="border-t border-gray-200 bg-gray-50/50 relative z-10">
          <div className="px-4 py-3 sm:px-6 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-semibold text-slate-600">
                Tasks ({openTasksCount} open, {completedTasksCount} completed)
              </h4>
              {tasks.length > 0 && completedTasksCount > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowCompletedTasks(!showCompletedTasks); }}
                  className="touch-target-sm text-xs text-indigo-600 hover:text-indigo-800 flex items-center"
                >
                  {showCompletedTasks ? <EyeSlashIcon className="w-3.5 h-3.5 mr-1" /> : <EyeIcon className="w-3.5 h-3.5 mr-1" />}
                  {showCompletedTasks ? 'Hide' : 'Show'} Completed
                </button>
              )}
            </div>
          </div>
          <div className="px-4 pb-4 sm:px-6 sm:pb-6">
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
                onTaskDragStateChange={onTaskDragStateChange}
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
        <div id={`project-notes-section-${project.id}`} className="border-t border-gray-200 px-4 py-4 sm:px-6 relative z-10">
          <div className="mb-1.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h4 className="text-xs font-semibold text-slate-600">Project Notes</h4>
            <button
              type="button"
              onClick={() => setIsNoteWorkspaceOpen(true)}
              className="inline-flex items-center justify-center rounded-lg border border-[#0496c7]/30 px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-[#036586] shadow-sm transition hover:border-[#0496c7] hover:bg-[#0496c7]/10 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400 disabled:hover:bg-transparent"
              disabled={isProjectCompletedOrCancelled}
            >
              Open Notes Workspace
            </button>
          </div>
          <AddNoteForm
            parentId={project.id}
            parentType="project"
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
        onClose={() => { setShowCompletionModal(false); setStatusToConfirm(null); }}
        onConfirmCompleteTasks={handleConfirmCompleteTasksAndProject}
        projectName={project.name}
        openTasksCount={openTasksCount}
      />
      <ProjectNoteWorkspaceModal
        isOpen={isNoteWorkspaceOpen}
        onClose={() => setIsNoteWorkspaceOpen(false)}
        project={project}
        notes={projectNotes}
        onNoteSaved={(note) => handleProjectNoteAdded(note)}
        onTaskSubmit={submitQuickTask}
        onTaskComplete={completeOpenTaskFromWorkspace}
        isLoadingNotes={isLoadingProjectNotes}
        noteCreationDisabled={isProjectCompletedOrCancelled}
        openTasks={openTasks}
      />
    </div>
  );
});

ProjectItem.displayName = 'ProjectItem';

export default React.memo(ProjectItem, (prev, next) => {
  return prev.project === next.project &&
    prev.areAllTasksExpanded === next.areAllTasksExpanded &&
    prev.tasks === next.tasks &&
    prev.isDropMode === next.isDropMode &&
    prev.dragSourceProjectId === next.dragSourceProjectId;
});