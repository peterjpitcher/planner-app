// src/components/Projects/ProjectScreen.jsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ArrowsPointingInIcon, ArrowsPointingOutIcon } from '@heroicons/react/20/solid';

import { apiClient } from '@/lib/apiClient';
import { ACTIVE_STATES, CLOSED_STATES, PROJECT_STATUS, STATE } from '@/lib/constants';
import { cn } from '@/lib/styleUtils';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import TaskCard from '@/components/shared/TaskCard';
import QuickTaskInput from '@/components/shared/QuickTaskInput';
import NotesPanel from '@/components/shared/NotesPanel';
import AttachmentsPanel from '@/components/shared/AttachmentsPanel';
import { STATE_GROUPS } from './ProjectWorkspace';

/**
 * One project, full window, for writing notes and adding tasks during a call.
 *
 * It is shown to other people over a screen share, so the rule for everything
 * here is that nothing may name or lead to any other work:
 *
 * - AppShell renders /focus/* with no chrome (no sidebar, header, tab bar,
 *   quick capture or planning prompt).
 * - It loads this project alone (GET /api/projects/[id]), never the list.
 * - There are no links. Task cards hide their project link, and Close closes
 *   the tab rather than navigating back into the planner, which would put the
 *   project list on the shared screen.
 */
export default function ProjectScreen({ projectId }) {
  const sensors = useSensors(useSensor(PointerSensor));
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loadState, setLoadState] = useState('loading'); // loading | ready | error
  const [actionError, setActionError] = useState(null);
  const [closeBlocked, setCloseBlocked] = useState(false);
  const [canFillScreen, setCanFillScreen] = useState(false);
  const [fillsScreen, setFillsScreen] = useState(false);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoadState('loading');
    try {
      const [projectData, taskData] = await Promise.all([
        apiClient.getProject(projectId),
        apiClient.getAllTasks(projectId, { states: ACTIVE_STATES.join(',') }),
      ]);
      setProject(projectData);
      setTasks(taskData);
      setLoadState('ready');
    } catch {
      // Deliberately generic: say nothing about why, or what else exists.
      if (!silent) setLoadState('error');
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  // The browser tab shows the project's name, so the shared tab is easy to
  // find in a call's share picker. Until it loads, or if it cannot, the page's
  // plain "Project" title stays.
  useDocumentTitle(loadState === 'ready' ? project?.name : null);

  useEffect(() => {
    setCanFillScreen(Boolean(document.fullscreenEnabled));
    const onChange = () => setFillsScreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const tasksByState = useMemo(() => {
    const grouped = {};
    for (const task of tasks) {
      const state = task.state || STATE.BACKLOG;
      if (!grouped[state]) grouped[state] = [];
      grouped[state].push(task);
    }
    return grouped;
  }, [tasks]);

  // Every change is shown straight away and put back by reloading if the save
  // fails, with the failure on screen rather than silently reverted.
  const save = useCallback(async (request, message) => {
    setActionError(null);
    try {
      await request();
    } catch (err) {
      setActionError(err?.message || message);
      load({ silent: true });
    }
  }, [load]);

  const handleTaskAdded = useCallback((newTask) => {
    if (newTask?.id) setTasks((prev) => [...prev, newTask]);
  }, []);

  const removeTask = useCallback((taskId) => {
    setTasks((prev) => prev.filter((task) => task.id !== taskId));
  }, []);

  const handleComplete = useCallback((taskId) => {
    removeTask(taskId);
    save(() => apiClient.updateTask(taskId, { state: STATE.DONE }), 'Could not complete the task. It has been put back.');
  }, [removeTask, save]);

  const handleMove = useCallback((taskId, targetState, targetSection) => {
    const updates = { state: targetState };
    if (targetSection) updates.today_section = targetSection;
    if (targetState === STATE.TODAY && !targetSection) updates.today_section = 'good_to_do';

    if (CLOSED_STATES.includes(targetState)) {
      removeTask(taskId);
    } else {
      setTasks((prev) => prev.map((task) => (task.id === taskId ? { ...task, ...updates } : task)));
    }
    save(() => apiClient.updateTask(taskId, updates), 'Could not move the task. It has been put back.');
  }, [removeTask, save]);

  const handleUpdate = useCallback((taskId, updates) => {
    const leavesProject = Object.prototype.hasOwnProperty.call(updates, 'project_id')
      && updates.project_id !== projectId;
    if (leavesProject) {
      removeTask(taskId);
    } else {
      setTasks((prev) => prev.map((task) => (task.id === taskId ? { ...task, ...updates } : task)));
    }
    save(() => apiClient.updateTask(taskId, updates), 'Could not save the task. Your change was undone.');
  }, [projectId, removeTask, save]);

  const handleDelete = useCallback((taskId) => {
    removeTask(taskId);
    save(() => apiClient.deleteTask(taskId), 'Could not delete the task. It has been restored.');
  }, [removeTask, save]);

  async function toggleFillScreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Refused or unsupported: the screen already fills the browser window.
    }
  }

  function closeScreen() {
    window.close();
    // Browsers only let a page close a tab that a script opened. If this one
    // stays open, say so; never navigate into the planner from here.
    setCloseBlocked(true);
  }

  const isReadOnly = project
    && (project.status === PROJECT_STATUS.COMPLETED || project.status === PROJECT_STATUS.CANCELLED);

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          {loadState === 'ready' && project ? (
            <>
              <h1 className="truncate text-lg font-bold text-gray-900">{project.name}</h1>
              {project.customer_name && (
                <p className="truncate text-sm text-gray-500">{project.customer_name}</p>
              )}
            </>
          ) : (
            <h1 className="text-lg font-bold text-gray-900">Project</h1>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {closeBlocked && (
            <span className="hidden text-xs text-gray-500 sm:inline">Close this tab to finish</span>
          )}
          {canFillScreen && (
            <button
              type="button"
              onClick={toggleFillScreen}
              aria-label={fillsScreen ? 'Exit full screen' : 'Full screen'}
              title={fillsScreen ? 'Exit full screen' : 'Full screen'}
              className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            >
              {fillsScreen
                ? <ArrowsPointingInIcon className="h-5 w-5" aria-hidden="true" />
                : <ArrowsPointingOutIcon className="h-5 w-5" aria-hidden="true" />}
            </button>
          )}
          <button
            type="button"
            onClick={closeScreen}
            className="rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </header>

      {loadState === 'loading' && (
        <p className="py-16 text-center text-sm text-gray-400">Loading…</p>
      )}

      {loadState === 'error' && (
        <div className="py-16 text-center">
          <p role="alert" className="text-sm text-red-600">This project could not be loaded.</p>
          <button
            type="button"
            onClick={() => load()}
            className="mt-2 text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            Try again
          </button>
        </div>
      )}

      {loadState === 'ready' && project && (
        <main className="flex flex-1 flex-col gap-8 px-4 py-4 sm:px-6 lg:flex-row">
          <section className="min-w-0 lg:flex-[3]">
            <NotesPanel
              projectId={project.id}
              disabled={isReadOnly}
              allowFullScreen={false}
              composerRows={14}
              autoTasks
              onTaskPickedUp={handleTaskAdded}
              onTaskUndone={removeTask}
            />
          </section>

          <section className="min-w-0 space-y-8 lg:flex-[2]">
            <div>
              <h2 className="mb-3 text-sm font-semibold text-gray-700">Tasks ({tasks.length})</h2>

              {actionError && (
                <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                  {actionError}
                </p>
              )}

              {!isReadOnly && (
                <div className="mb-3">
                  <QuickTaskInput mode="single" projectId={project.id} onTaskAdded={handleTaskAdded} />
                </div>
              )}

              {tasks.length === 0 ? (
                <p className="py-4 text-center text-xs italic text-gray-400">No open tasks.</p>
              ) : (
                <div className="space-y-4">
                  {STATE_GROUPS.map(({ key, label, labelClass }) => {
                    const groupTasks = tasksByState[key] || [];
                    if (groupTasks.length === 0) return null;
                    return (
                      <div key={key}>
                        <p className={cn('mb-1.5 text-[10px] font-bold uppercase tracking-wide', labelClass)}>
                          {label}
                        </p>
                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={() => {}}>
                          <SortableContext items={groupTasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
                            <div className="flex flex-col gap-1.5">
                              {groupTasks.map((task) => (
                                <TaskCard
                                  key={task.id}
                                  task={task}
                                  isDragging={false}
                                  showProject={false}
                                  onComplete={handleComplete}
                                  onMove={handleMove}
                                  onUpdate={handleUpdate}
                                  onDelete={handleDelete}
                                />
                              ))}
                            </div>
                          </SortableContext>
                        </DndContext>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <AttachmentsPanel parentType="project" parentId={project.id} disabled={isReadOnly} />
          </section>
        </main>
      )}
    </div>
  );
}
