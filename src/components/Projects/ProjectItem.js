'use client';

import React, { useState, useEffect, useCallback, forwardRef } from 'react';
import { format, parseISO } from 'date-fns';
import { apiClient } from '@/lib/apiClient';
import { handleSupabaseError, handleError } from '@/lib/errorHandler';
import { EyeIcon, EyeSlashIcon, PlusCircleIcon } from '@heroicons/react/24/outline';
import TaskList from '@/components/Tasks/TaskList';
import NoteList from '@/components/Notes/NoteList';
import AddNoteForm from '@/components/Notes/AddNoteForm';
import ProjectNoteWorkspaceModal from '@/components/Notes/ProjectNoteWorkspaceModal';
import ProjectCompletionModal from './ProjectCompletionModal';
import ProjectHeader from './ProjectHeader';
import { useTargetProject } from '@/contexts/TargetProjectContext';
import { useSession } from 'next-auth/react';
import QuickTaskForm from '@/components/Tasks/QuickTaskForm';
import { DRAG_DATA_TYPES } from '@/lib/constants';
import { getPriorityClasses } from '@/lib/projectHelpers';
import { cn } from '@/lib/utils'; // Standard utility
import { compareTasksByWorkPriority } from '@/lib/taskScoring';

const getTodayISODate = () => format(new Date(), 'yyyy-MM-dd');
const chunkArray = (items, size) => {
  if (!Array.isArray(items) || size <= 0) return [];
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const ProjectItem = forwardRef((
  {
    project,
    tasks: propTasks,
    notes: propNotes,
    notesByTask,
    onTaskNoteAdded,
    onProjectNoteAdded,
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
  const isSourceProject = dragSourceProjectId !== null && project?.id === dragSourceProjectId;

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
        return compareTasksByWorkPriority(a, b);
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
  const totalTasksCount = tasks.length;
  const completedTasksCount = tasks.length - openTasksCount;

  const handleUpdateProject = async (updates) => {
    if (updates.status === 'Completed' && openTasksCount > 0) {
      setStatusToConfirm('Completed');
      setShowCompletionModal(true);
      return;
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
      throw err;
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
    if (onProjectNoteAdded && project?.id) {
      onProjectNoteAdded(project.id, newNote);
    }
    if (onProjectDataChange) onProjectDataChange(project.id, { updated_at: new Date().toISOString() }, 'project_details_changed');
  };

  const formatFieldValue = (value) => {
    if (value === null || value === undefined || value === '') return 'N/A';
    if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : 'N/A';
    if (value instanceof Date) return format(value, 'EEEE, MMM do, yyyy h:mm a');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  const formatNoteForCopy = (note, indent = '  ') => {
    if (!note) return '';
    const createdAt = note.created_at ? format(new Date(note.created_at), 'EEEE, MMM do, yyyy h:mm a') : 'N/A';
    const lines = [
      `${indent}- Note`,
      `${indent}  Id: ${note.id || 'N/A'}`,
      `${indent}  Created At: ${createdAt}`,
      `${indent}  Content: ${note.content || 'N/A'}`,
      `${indent}  Project ID: ${note.project_id || 'N/A'}`,
      `${indent}  Task ID: ${note.task_id || 'N/A'}`,
      `${indent}  User ID: ${note.user_id || 'N/A'}`
    ];
    return lines.join('\n');
  };

  const handleCopyProjectData = async () => {
    if (!project) return;
    setCopyStatus('Copying...');
    let projectDataText = `Project Summary:\n`;
    projectDataText += `Name: ${project.name}\n`;
    projectDataText += `Status: ${project.status}\n`;
    projectDataText += `Priority: ${project.priority}\n`;
    projectDataText += `Job: ${project.job || 'N/A'}\n`;
    projectDataText += `Due Date: ${project.due_date ? format(parseISO(project.due_date), 'EEEE, MMM do, yyyy') : 'N/A'}\n`;
    projectDataText += `Description: ${project.description || 'N/A'}\n`;
    projectDataText += `Stakeholders: ${project.stakeholders && project.stakeholders.length > 0 ? project.stakeholders.join(', ') : 'N/A'}\n`;

    projectDataText += `\nProject Fields:\n`;
    Object.keys(project)
      .sort()
      .forEach((key) => {
        projectDataText += `  ${key}: ${formatFieldValue(project[key])}\n`;
      });

    let projectNotesForCopy = [];
    try {
      const projectNotesMap = await apiClient.getProjectNotesBatch([project.id]);
      projectNotesForCopy = projectNotesMap?.[project.id] || [];
    } catch (err) {
      const errorMessage = handleSupabaseError(err, 'fetch');
      projectDataText += `\nProject Notes:\n  Error fetching project notes: ${errorMessage}\n`;
      setCopyStatus('Error!');
      setTimeout(() => setCopyStatus('Copy'), 2000);
      return;
    }

    if (projectNotesForCopy.length > 0) {
      projectDataText += `\nProject Notes:\n`;
      projectNotesForCopy.forEach(note => {
        projectDataText += `${formatNoteForCopy(note, '  ')}\n`;
      });
    } else {
      projectDataText += `\nProject Notes:\n  None\n`;
    }

    projectDataText += `\nTasks:\n`;

    try {
      const tasksByProject = await apiClient.getTasksBatch([project.id]);
      const tasksForCopy = tasksByProject?.[project.id] || [];
      const taskIds = tasksForCopy.map(task => task?.id).filter(Boolean);
      const noteBatches = taskIds.length > 0
        ? await Promise.all(
          chunkArray(taskIds, 200).map(ids => apiClient.getNotesBatch(ids))
        )
        : [];
      const notesByTaskForCopy = noteBatches.reduce((acc, batch) => {
        Object.entries(batch || {}).forEach(([taskId, notes]) => {
          acc[taskId] = notes || [];
        });
        return acc;
      }, {});

      if (tasksForCopy && tasksForCopy.length > 0) {
        tasksForCopy.forEach(taskItem => {
          projectDataText += `  - Task: ${taskItem.name || 'Untitled task'}\n`;
          const taskNotes = notesByTaskForCopy?.[taskItem.id] || [];
          const { notes: _ignoredNotes, ...taskFields } = taskItem || {};
          projectDataText += `    Fields:\n`;
          Object.keys(taskFields || {})
            .sort()
            .forEach((key) => {
              projectDataText += `      ${key}: ${formatFieldValue(taskFields[key])}\n`;
            });
          if (taskNotes && taskNotes.length > 0) {
            projectDataText += `    Notes:\n`;
            taskNotes.forEach(note => {
              projectDataText += `${formatNoteForCopy(note, '      ')}\n`;
            });
          } else {
            projectDataText += `    Notes: None\n`;
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
      } catch (err) {
        handleError(err, 'handleConfirmCompleteTasksAndProject', { showAlert: true });
        return;
      }
    }
    if (statusToConfirm) {
      try {
        await apiClient.updateProject(project.id, {
          status: statusToConfirm,
          updated_at: new Date().toISOString()
        });
        onProjectDataChange(project.id, { ...project, status: statusToConfirm }, 'project_status_changed');
      } catch (e) { }
      setStatusToConfirm(null);
    }
  };

  const submitQuickTask = async ({ name, dueDate, priority }) => {
    if (!project || !project.id) throw new Error('Project is not available.');
    if (!currentUser?.id) throw new Error('Sign in to add tasks.');
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error('Add a short name to create the task.');
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
    if (!project?.id || isSourceProject || !canAcceptTaskDrag(event)) return;
    event.preventDefault();
    setIsDragOverTarget(true);
  };

  const handleDragOver = (event) => {
    if (!project?.id || isSourceProject || !canAcceptTaskDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleDragLeave = (event) => {
    if (!project?.id) return;
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setIsDragOverTarget(false);
  };

  const handleDrop = async (event) => {
    if (!project?.id || isSourceProject || !canAcceptTaskDrag(event)) return;
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
    if (!taskId || previousProjectId === project.id) return;

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

  const shouldShowDropPreview = isDropMode;
  const dropStatusText = isDragOverTarget ? 'Release to assign' : 'Drop here to move task';
  const dropPreviewStatusText = isSourceProject
    ? 'Current project'
    : (isDragOverTarget ? 'Release to assign' : 'Drop to move');

  const containerProps = {
    ref,
    id: `project-item-${project.id}`,
    // Standard Card styling
    className: cn(
      "relative overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm transition-all duration-300",
      shouldShowDropPreview
        ? "border-primary/40 shadow-md"
        : "hover:shadow-md",
      shouldShowDropPreview && isSourceProject ? "border-border opacity-75" : "",
      isDragOverTarget ? "ring-2 ring-primary ring-offset-2" : "",
      isProjectCompletedOrCancelled ? "opacity-60 saturate-75" : ""
    ),
    onDragEnter: handleDragEnter,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
    'data-project-id': project.id,
  };

  if (shouldShowDropPreview) {
    return (
      <div {...containerProps}>
        <div className={cn(
          "flex min-h-[44px] items-center gap-3 px-4 py-2",
          isDragOverTarget ? "bg-primary/5" : ""
        )}>
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground" title={project.name}>
            {project.name || 'Unnamed Project'}
          </p>
          <span className={cn(
            "whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.08em]",
            isSourceProject ? "text-muted-foreground" : "text-primary/80"
          )}>
            {dropPreviewStatusText}
          </span>
        </div>
      </div>
    );
  }

  // Unassigned tasks view
  if (isUnassignedProject) {
    return (
      <div {...containerProps}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Unassigned Tasks</h3>
          {tasks.length > 0 && completedTasksCount > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowCompletedTasks(!showCompletedTasks); }}
              className="text-xs font-medium text-primary hover:underline hover:text-primary/80 transition-colors"
            >
              {showCompletedTasks ? 'Hide completed' : 'Show completed'}
            </button>
          )}
        </div>
        <div className="p-6">
          {isLoadingTasks ? (
            <div className="text-center py-4 text-xs text-muted-foreground animate-pulse">Loading tasks...</div>
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
            <div className="text-center py-8 rounded-lg border-2 border-dashed border-border/50 bg-background/50">
              <p className="text-sm text-muted-foreground">No unassigned tasks.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Standard Project
  return (
    <div {...containerProps}>
      {/* Sidebar color strip for priority/branding */}
      <div className={cn("absolute left-0 top-0 bottom-0 w-1", priorityStyles.bgClass)} />

      <div className="pl-1">
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
      </div>

      {showTasks && (
        <div className="px-6 pb-6 pt-2">

          <QuickTaskForm
            onSubmit={submitQuickTask}
            namePlaceholder="Add a task..."
            buttonLabel="Add"
            buttonIcon={PlusCircleIcon}
            priorityType="select"
            priorityOptions={[
              { value: 'Low', label: 'Low' },
              { value: 'Medium', label: 'Medium' },
              { value: 'High', label: 'High' },
            ]}
            defaultPriority="Medium"
            defaultDueDate={getTodayISODate()}
            className="mb-6 bg-muted/20 hover:bg-muted/30 border-none transition-colors"
          />

          {/* Tasks List Header */}
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Tasks
              </h4>
              <div className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {openTasksCount} open
              </div>
            </div>

            {tasks.length > 0 && completedTasksCount > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowCompletedTasks(!showCompletedTasks); }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                {showCompletedTasks ? <EyeSlashIcon className="w-3.5 h-3.5" /> : <EyeIcon className="w-3.5 h-3.5" />}
                {showCompletedTasks ? 'Hide Completed' : 'Show Completed'}
              </button>
            )}
          </div>

          {isLoadingTasks ? (
            <div className="text-center py-4 text-xs text-muted-foreground animate-pulse">Loading tasks...</div>
          ) : tasks.length > 0 ? (
            <TaskList
              tasks={tasks}
              notesByTask={notesByTask}
              isLoading={isLoadingTasks}
              onTaskUpdated={handleTaskUpdated}
              onTaskNoteAdded={onTaskNoteAdded}
              showCompletedTasks={showCompletedTasks}
              isProjectCompleted={isProjectCompletedOrCancelled}
              onTaskDragStateChange={onTaskDragStateChange}
            />
          ) : (
            <div className="text-center py-6 rounded-lg border border-dashed border-border bg-muted/10">
              <p className="text-xs text-muted-foreground">No tasks yet.</p>
            </div>
          )}
        </div>
      )}

      {/* Project Notes Section */}
      {showProjectNotes && (
        <div id={`project-notes-section-${project.id}`} className="border-t border-border bg-muted/10 px-6 py-5">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Project Notes</h4>
            <button
              type="button"
              onClick={() => setIsNoteWorkspaceOpen(true)}
              className="text-xs font-medium text-primary hover:underline hover:text-primary/80 transition-colors"
              disabled={isProjectCompletedOrCancelled}
            >
              Open Workspace
            </button>
          </div>
          <div className="mb-4">
            <AddNoteForm
              parentId={project.id}
              parentType="project"
              onNoteAdded={handleProjectNoteAdded}
              disabled={isProjectCompletedOrCancelled}
            />
          </div>

          {isLoadingProjectNotes ? (
            <p className="text-xs text-muted-foreground py-2 animate-pulse">Loading notes...</p>
          ) : projectNotes.length > 0 ? (
            <NoteList notes={projectNotes} />
          ) : (
            <p className="touch-target-sm text-xs text-primary hover:text-primary/80 flex items-center">No notes yet.</p>
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
    prev.notes === next.notes &&
    prev.notesByTask === next.notesByTask &&
    prev.isDropMode === next.isDropMode &&
    prev.dragSourceProjectId === next.dragSourceProjectId;
});
