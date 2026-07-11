'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { apiClient } from '@/lib/apiClient';
import { createLatestGuard } from '@/lib/requestCache';
import { cn } from '@/lib/styleUtils';
import { STATE } from '@/lib/constants';
import {
  computeAttentionCounts,
  deriveAreas,
  getVisibleProjects,
  matchesFilter,
} from '@/lib/projectFilters';
import TaskDetailDrawer from '@/components/shared/TaskDetailDrawer';
import CreateProjectModal from './CreateProjectModal';
import ProjectSidebar from './ProjectSidebar';
import ProjectDashboard from './ProjectDashboard';
import ProjectWorkspace from './ProjectWorkspace';
import ProjectRadar from './ProjectRadar';

function ProjectsViewSkeleton() {
  return (
    <div className="flex h-full animate-pulse">
      <div className="w-full shrink-0 border-r border-gray-200 bg-gray-50/50 p-3 space-y-3 md:w-[280px]">
        <div className="h-9 rounded-md bg-gray-200" />
        <div className="flex gap-1.5">{[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-6 w-14 rounded-full bg-gray-200" />)}</div>
        <div className="h-8 rounded-md bg-gray-200" />
        <div className="space-y-2 pt-2">{[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 rounded-lg bg-gray-200" />)}</div>
      </div>
      <div className="hidden flex-1 p-6 space-y-4 md:block">
        <div className="grid grid-cols-4 gap-3">{[1, 2, 3, 4].map((i) => <div key={i} className="h-20 rounded-lg bg-gray-100" />)}</div>
        <div className="h-64 rounded-lg bg-gray-100" />
      </div>
    </div>
  );
}

export default function ProjectsView() {
  const searchParams = useSearchParams();

  // Core data
  const [projects, setProjects] = useState([]);
  const [tasksByProject, setTasksByProject] = useState({});
  const [unassignedTasks, setUnassignedTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Selection & filters
  const [selectedProjectId, setSelectedProjectId] = useState(searchParams.get('id') || null);
  // Mobile list/detail toggle (FF-016): below md, the sidebar list and the
  // workspace/dashboard detail are mutually exclusive full-width panes. Starts
  // open when a deep link already points at a project so it renders directly.
  const [mobileDetailOpen, setMobileDetailOpen] = useState(() => !!searchParams.get('id'));
  const [activeFilter, setActiveFilter] = useState('all');
  const [selectedArea, setSelectedArea] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);

  // ---- Data fetching ----
  // Capture initial URL id once — subsequent selection changes update state directly
  const initialUrlId = useRef(searchParams.get('id'));

  // Latest-wins guard + debounce timer for background refetches
  const loadGuardRef = useRef(createLatestGuard());
  const refetchTimerRef = useRef(null);
  // Gate silent refetches until the first load has completed, so a background
  // refetch can never supersede the in-flight initial load (R2).
  const hasLoadedRef = useRef(false);

  // loadData({ silent }): silent refetches revalidate in the background without
  // flipping the view to the skeleton or blanking it on transient failure.
  const loadData = useCallback(async ({ silent = false } = {}) => {
    const token = loadGuardRef.current.begin();
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const [allProjects, allTasks] = await Promise.all([
        apiClient.getAllProjects(true),
        apiClient.getAllTasks(null, { states: 'today,this_week,backlog,waiting' }),
      ]);

      // Ignore out-of-order responses — a newer refetch has superseded this one
      if (loadGuardRef.current.isStale(token)) return;

      const byProject = {};
      const unassigned = [];
      for (const task of allTasks) {
        if (task.project_id) {
          if (!byProject[task.project_id]) byProject[task.project_id] = [];
          byProject[task.project_id].push(task);
        } else {
          unassigned.push(task);
        }
      }

      setProjects(allProjects);
      setTasksByProject(byProject);
      setUnassignedTasks(unassigned);

      // Validate URL-based selection (initial load only)
      const urlId = initialUrlId.current;
      if (urlId) {
        initialUrlId.current = null; // Only apply once
        const found = allProjects.find((p) => p.id === urlId);
        if (found) {
          setSelectedProjectId(urlId);
          if (found.status === 'Completed' || found.status === 'Cancelled') {
            setShowCompleted(true);
          }
        } else {
          setSelectedProjectId(null);
          window.history.replaceState(null, '', '/projects');
        }
      }
    } catch (err) {
      // Silent refetch failures keep the current view rather than blanking it
      if (!silent) setError(err.message || 'Failed to load projects.');
    } finally {
      if (!silent) setLoading(false);
      hasLoadedRef.current = true;
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Refetch quietly when a task mutates (e.g. QuickCapture on /projects), planning
  // completes, or the tab regains focus (cross-tab / multi-device). Bursts are
  // debounced into a single refetch (FF-008 / FF-053).
  useEffect(() => {
    const scheduleRefetch = () => {
      // Never let a silent background refetch supersede the very first load — a
      // superseded initial load skips its setState and can leave an empty view
      // with no spinner/error (R2).
      if (!hasLoadedRef.current) return;
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      refetchTimerRef.current = setTimeout(() => { loadData({ silent: true }); }, 200);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') scheduleRefetch();
    };
    window.addEventListener('planning-complete', scheduleRefetch);
    window.addEventListener('tasks-changed', scheduleRefetch);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      window.removeEventListener('planning-complete', scheduleRefetch);
      window.removeEventListener('tasks-changed', scheduleRefetch);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadData]);

  // ---- Derived state (memoised) ----
  const areas = useMemo(() => deriveAreas(projects), [projects]);

  const attentionCounts = useMemo(
    () => computeAttentionCounts(projects, tasksByProject),
    [projects, tasksByProject]
  );

  const visibleProjects = useMemo(() => {
    const filtered = getVisibleProjects(projects, tasksByProject, { showCompleted, activeFilter, selectedArea });
    if (!searchQuery.trim()) return filtered;
    const q = searchQuery.trim().toLowerCase();
    return filtered.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, tasksByProject, showCompleted, activeFilter, selectedArea, searchQuery]);

  // For dashboard table: respects area and showCompleted but NOT active filter pill
  const dashboardProjects = useMemo(
    () => getVisibleProjects(projects, tasksByProject, { showCompleted, activeFilter: 'all', selectedArea }),
    [projects, tasksByProject, showCompleted, selectedArea]
  );

  const completedCount = useMemo(
    () => projects.filter((p) => p.status === 'Completed' || p.status === 'Cancelled').length,
    [projects]
  );

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  const selectedProjectTasks = useMemo(
    () => tasksByProject[selectedProjectId] || [],
    [tasksByProject, selectedProjectId]
  );

  // Refs for stable callbacks that need current values
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const tasksByProjectRef = useRef(tasksByProject);
  tasksByProjectRef.current = tasksByProject;
  const unassignedTasksRef = useRef(unassignedTasks);
  unassignedTasksRef.current = unassignedTasks;
  const selectedProjectIdRef = useRef(selectedProjectId);
  selectedProjectIdRef.current = selectedProjectId;

  // ---- Selection handlers (stable refs for memo) ----
  const selectProject = useCallback((projectId) => {
    setSelectedProjectId(projectId);
    setSelectedTask(null);
    const url = projectId ? `/projects?id=${projectId}` : '/projects';
    window.history.replaceState(null, '', url);
  }, []);

  // Explicit "view detail" navigation (project row, Unassigned entry, Dashboard
  // link, project creation) also opens the mobile detail pane. Kept separate
  // from selectProject so the defensive deselect in handleFilterChange below
  // doesn't yank a browsing user on mobile into the detail view (FF-016).
  const openProjectDetail = useCallback((projectId) => {
    selectProject(projectId);
    setMobileDetailOpen(true);
  }, [selectProject]);

  const showDashboard = useCallback(() => {
    openProjectDetail(null);
  }, [openProjectDetail]);

  const showProjectsList = useCallback(() => {
    setMobileDetailOpen(false);
  }, []);

  const openCreateModal = useCallback(() => setIsCreateOpen(true), []);

  const handleFilterChange = useCallback((filter) => {
    setActiveFilter(filter);
    const prevId = selectedProjectIdRef.current;
    if (prevId && filter !== 'all') {
      const project = projectsRef.current.find((p) => p.id === prevId);
      if (project && !matchesFilter(project, filter, tasksByProjectRef.current[prevId] || [])) {
        selectProject(null);
      }
    }
  }, [selectProject]);

  // ---- Project mutation handlers ----
  const handleUpdateProject = useCallback(async (projectId, updates) => {
    // Optimistic update
    setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, ...updates } : p)));
    try {
      await apiClient.updateProject(projectId, updates);
    } catch {
      loadData({ silent: true }); // Revert on failure without a skeleton flash
    }
  }, [loadData]);

  const handleDeleteProject = useCallback(async (projectId) => {
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    if (selectedProjectId === projectId) selectProject(null);
    try {
      await apiClient.deleteProject(projectId);
    } catch {
      loadData({ silent: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadData, selectedProjectId]);

  const handleProjectCreated = useCallback((newProject) => {
    setIsCreateOpen(false);
    openProjectDetail(newProject.id);
    loadData(); // Full reload to get the new project with server-generated fields
  }, [loadData, openProjectDetail]);

  // ---- Task mutation handlers ----
  const handleTaskAdded = useCallback((newTask, projectId) => {
    if (!newTask?.id) return;
    if (projectId) {
      setTasksByProject((prev) => ({
        ...prev,
        [projectId]: [...(prev[projectId] || []), newTask],
      }));
    } else {
      setUnassignedTasks((prev) => [...prev, newTask]);
    }
  }, []);

  const handleCompleteTask = useCallback(async (taskId) => {
    // Toggle completion from state, not a dropped column. Completing removes the
    // task from the visible (non-done) lists; un-completing restores it to
    // Today / Good to Do (FF-005).
    let task = null;
    for (const tasks of Object.values(tasksByProjectRef.current)) {
      const found = tasks.find((t) => t.id === taskId);
      if (found) { task = found; break; }
    }
    if (!task) task = unassignedTasksRef.current.find((t) => t.id === taskId) || null;

    const wasCompleted = task ? (task.state === STATE.DONE || !!task.completed_at) : false;
    const updates = wasCompleted
      ? { state: STATE.TODAY, today_section: 'good_to_do' }
      : { state: STATE.DONE };

    if (!wasCompleted) {
      setTasksByProject((prev) => {
        const next = { ...prev };
        for (const [pid, tasks] of Object.entries(next)) {
          next[pid] = tasks.filter((t) => t.id !== taskId);
        }
        return next;
      });
      setUnassignedTasks((prev) => prev.filter((t) => t.id !== taskId));
    }

    try {
      await apiClient.updateTask(taskId, updates);
    } catch {
      loadData({ silent: true });
    }
  }, [loadData]);

  const handleMoveTask = useCallback(async (taskId, targetState, targetSection) => {
    const updates = { state: targetState };
    if (targetSection) updates.today_section = targetSection;
    if (targetState === STATE.TODAY && !targetSection) updates.today_section = 'good_to_do';

    // Optimistic: update state in local data
    const updateInList = (tasks) => tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t));
    setTasksByProject((groups) => {
      const next = { ...groups };
      for (const [pid, tasks] of Object.entries(next)) {
        next[pid] = updateInList(tasks);
      }
      return next;
    });
    // Also update unassigned tasks — a project-less task can still change state
    setUnassignedTasks((prev) => updateInList(prev));

    try {
      await apiClient.updateTask(taskId, updates);
    } catch {
      loadData({ silent: true });
    }
  }, [loadData]);

  const handleUpdateTask = useCallback(async (taskId, updates) => {
    // Project reassignment must regroup the task under its new project (or unassigned),
    // not just edit it in place under the old grouping key (FF-008).
    const reassigning = Object.prototype.hasOwnProperty.call(updates, 'project_id');

    if (reassigning) {
      // Locate the current task from refs so we can move it whole
      let current = null;
      for (const tasks of Object.values(tasksByProjectRef.current)) {
        const found = tasks.find((t) => t.id === taskId);
        if (found) { current = found; break; }
      }
      if (!current) current = unassignedTasksRef.current.find((t) => t.id === taskId) || null;
      const merged = current ? { ...current, ...updates } : null;
      const newProjectId = updates.project_id || null;

      setTasksByProject((prev) => {
        const next = {};
        for (const [pid, tasks] of Object.entries(prev)) {
          next[pid] = tasks.filter((t) => t.id !== taskId);
        }
        if (merged && newProjectId) {
          next[newProjectId] = [...(next[newProjectId] || []), merged];
        }
        return next;
      });
      setUnassignedTasks((prev) => {
        const kept = prev.filter((t) => t.id !== taskId);
        return merged && !newProjectId ? [...kept, merged] : kept;
      });
    } else {
      const updateInList = (tasks) => tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t));
      setTasksByProject((prev) => {
        const next = { ...prev };
        for (const [pid, tasks] of Object.entries(next)) {
          next[pid] = updateInList(tasks);
        }
        return next;
      });
      setUnassignedTasks((prev) => updateInList(prev));
    }

    setSelectedTask((prev) => (prev && prev.id === taskId ? { ...prev, ...updates } : prev));
    try {
      await apiClient.updateTask(taskId, updates);
    } catch {
      loadData({ silent: true });
    }
  }, [loadData]);

  const handleDeleteTask = useCallback(async (taskId) => {
    setTasksByProject((prev) => {
      const next = { ...prev };
      for (const [pid, tasks] of Object.entries(next)) {
        next[pid] = tasks.filter((t) => t.id !== taskId);
      }
      return next;
    });
    setUnassignedTasks((prev) => prev.filter((t) => t.id !== taskId));
    setSelectedTask((prev) => (prev && prev.id === taskId ? null : prev));
    try {
      await apiClient.deleteTask(taskId);
    } catch {
      loadData({ silent: true });
    }
  }, [loadData]);

  const handleTaskClick = useCallback((taskId) => {
    for (const tasks of Object.values(tasksByProject)) {
      const found = tasks.find((t) => t.id === taskId);
      if (found) { setSelectedTask(found); return; }
    }
    const found = unassignedTasks.find((t) => t.id === taskId);
    if (found) setSelectedTask(found);
  }, [tasksByProject, unassignedTasks]);

  // ---- Render ----
  if (loading) return <ProjectsViewSkeleton />;

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-red-600">{error}</p>
          <button type="button" onClick={loadData} className="mt-2 text-sm font-medium text-indigo-600 hover:text-indigo-700">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const isUnassignedSelected = selectedProjectId === '__unassigned__';

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Wave 5 project-altitude radar — surfaces active projects with no
          scheduled next action. Hoisted above the list/detail row so it is
          visible on the mobile projects list too, not just the detail pane.
          Reuses the existing selection handler; self-hides when healthy. */}
      <ProjectRadar onSelectProject={openProjectDetail} />

      <div className="flex flex-1 min-h-0">
      <ProjectSidebar
        projects={visibleProjects}
        tasksByProject={tasksByProject}
        selectedProjectId={selectedProjectId}
        onSelectProject={openProjectDetail}
        onShowDashboard={showDashboard}
        onCreateProject={openCreateModal}
        activeFilter={activeFilter}
        onFilterChange={handleFilterChange}
        selectedArea={selectedArea}
        onAreaChange={setSelectedArea}
        areas={areas}
        attentionCounts={attentionCounts}
        showCompleted={showCompleted}
        onToggleCompleted={setShowCompleted}
        completedCount={completedCount}
        unassignedCount={unassignedTasks.length}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        hideOnMobile={mobileDetailOpen}
      />

      <main
        className={cn(
          'flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5',
          mobileDetailOpen ? 'block' : 'hidden md:block'
        )}
      >
        {/* Mobile-only back control (FF-016) — desktop always shows both panes */}
        <button
          type="button"
          onClick={showProjectsList}
          className="mb-3 flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700 md:hidden"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to projects
        </button>

        {isUnassignedSelected ? (
          <ProjectWorkspace
            project={null}
            tasks={unassignedTasks}
            onTaskAdded={handleTaskAdded}
            onCompleteTask={handleCompleteTask}
            onMoveTask={handleMoveTask}
            onUpdateTask={handleUpdateTask}
            onDeleteTask={handleDeleteTask}
            onTaskClick={handleTaskClick}
          />
        ) : selectedProject ? (
          <ProjectWorkspace
            project={selectedProject}
            tasks={selectedProjectTasks}
            onUpdateProject={handleUpdateProject}
            onDeleteProject={handleDeleteProject}
            onTaskAdded={handleTaskAdded}
            onCompleteTask={handleCompleteTask}
            onMoveTask={handleMoveTask}
            onUpdateTask={handleUpdateTask}
            onDeleteTask={handleDeleteTask}
            onTaskClick={handleTaskClick}
          />
        ) : (
          <ProjectDashboard
            attentionCounts={attentionCounts}
            projects={dashboardProjects}
            tasksByProject={tasksByProject}
            onFilterClick={(filter) => { setActiveFilter(filter); }}
            onSelectProject={openProjectDetail}
          />
        )}
      </main>
      </div>

      {/* Task detail drawer */}
      <TaskDetailDrawer
        task={selectedTask}
        isOpen={!!selectedTask}
        onClose={() => setSelectedTask(null)}
        onUpdate={handleUpdateTask}
        onDelete={handleDeleteTask}
      />

      {/* Create project modal */}
      <CreateProjectModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={handleProjectCreated}
      />
    </div>
  );
}
