'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
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

function ProjectsViewSkeleton() {
  return (
    <div className="flex h-full animate-pulse">
      <div className="w-[280px] shrink-0 border-r border-gray-200 bg-gray-50/50 p-3 space-y-3">
        <div className="h-9 rounded-md bg-gray-200" />
        <div className="flex gap-1.5">{[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-6 w-14 rounded-full bg-gray-200" />)}</div>
        <div className="h-8 rounded-md bg-gray-200" />
        <div className="space-y-2 pt-2">{[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 rounded-lg bg-gray-200" />)}</div>
      </div>
      <div className="flex-1 p-6 space-y-4">
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
  const [activeFilter, setActiveFilter] = useState('all');
  const [selectedArea, setSelectedArea] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);

  // ---- Data fetching ----
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [allProjects, allTasks] = await Promise.all([
        apiClient.getAllProjects(true),
        apiClient.getAllTasks(null, { states: 'today,this_week,backlog,waiting' }),
      ]);

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

      // Validate URL-based selection
      const urlId = searchParams.get('id');
      if (urlId) {
        const found = allProjects.find((p) => p.id === urlId);
        if (found) {
          setSelectedProjectId(urlId);
          // Auto-show completed if the project is completed
          if (found.status === 'Completed' || found.status === 'Cancelled') {
            setShowCompleted(true);
          }
        } else {
          // Invalid or inaccessible project — clear from URL
          setSelectedProjectId(null);
          window.history.replaceState(null, '', '/projects');
        }
      }
    } catch (err) {
      setError(err.message || 'Failed to load projects.');
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => { loadData(); }, [loadData]);

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
  const selectedProjectIdRef = useRef(selectedProjectId);
  selectedProjectIdRef.current = selectedProjectId;

  // ---- Selection handlers (stable refs for memo) ----
  const selectProject = useCallback((projectId) => {
    setSelectedProjectId(projectId);
    setSelectedTask(null);
    const url = projectId ? `/projects?id=${projectId}` : '/projects';
    window.history.replaceState(null, '', url);
  }, []);

  const showDashboard = useCallback(() => {
    selectProject(null);
  }, [selectProject]);

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
      loadData(); // Revert on failure
    }
  }, [loadData]);

  const handleDeleteProject = useCallback(async (projectId) => {
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    if (selectedProjectId === projectId) selectProject(null);
    try {
      await apiClient.deleteProject(projectId);
    } catch {
      loadData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadData, selectedProjectId]);

  const handleProjectCreated = useCallback(() => {
    setIsCreateOpen(false);
    loadData(); // Full reload to get the new project with server-generated fields
  }, [loadData]);

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
    setTasksByProject((prev) => {
      const next = { ...prev };
      for (const [pid, tasks] of Object.entries(next)) {
        next[pid] = tasks.filter((t) => t.id !== taskId);
      }
      return next;
    });
    setUnassignedTasks((prev) => prev.filter((t) => t.id !== taskId));
    try {
      await apiClient.updateTask(taskId, { state: 'done' });
    } catch {
      loadData();
    }
  }, [loadData]);

  const handleMoveTask = useCallback(async (taskId, targetState, targetSection) => {
    const updates = { state: targetState };
    if (targetSection) updates.today_section = targetSection;
    if (targetState === STATE.TODAY && !targetSection) updates.today_section = 'good_to_do';

    // Optimistic: update state in local data
    const updateInGroups = (groups) => {
      const next = { ...groups };
      for (const [pid, tasks] of Object.entries(next)) {
        next[pid] = tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t));
      }
      return next;
    };
    setTasksByProject(updateInGroups);

    try {
      await apiClient.updateTask(taskId, updates);
    } catch {
      loadData();
    }
  }, [loadData]);

  const handleUpdateTask = useCallback(async (taskId, updates) => {
    const updateInList = (tasks) => tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t));
    setTasksByProject((prev) => {
      const next = { ...prev };
      for (const [pid, tasks] of Object.entries(next)) {
        next[pid] = updateInList(tasks);
      }
      return next;
    });
    setUnassignedTasks((prev) => updateInList(prev));
    setSelectedTask((prev) => (prev && prev.id === taskId ? { ...prev, ...updates } : prev));
    try {
      await apiClient.updateTask(taskId, updates);
    } catch {
      loadData();
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
      loadData();
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

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      <ProjectSidebar
        projects={visibleProjects}
        tasksByProject={tasksByProject}
        selectedProjectId={selectedProjectId}
        onSelectProject={selectProject}
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
      />

      <main className="flex-1 overflow-y-auto px-6 py-5">
        {selectedProject ? (
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
            onSelectProject={selectProject}
          />
        )}
      </main>

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
