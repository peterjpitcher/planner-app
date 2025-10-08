'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { apiClient } from '@/lib/apiClient';
import ProjectList from '@/components/Projects/ProjectList';
import AddProjectModal from '@/components/Projects/AddProjectModal';
import AppShell from '@/components/layout/AppShell';
import SidebarFilters from '@/components/dashboard/SidebarFilters';
import MetricsBar from '@/components/dashboard/MetricsBar';
import TasksPanel from '@/components/dashboard/TasksPanel';
import { ProjectListSkeleton } from '@/components/ui/LoadingStates';
import { EmptyProjects, EmptyFilteredResults } from '@/components/ui/EmptyStates';
import { differenceInCalendarDays, isPast, parseISO, subWeeks, compareAsc, compareDesc } from 'date-fns';
import { PlusCircleIcon, CalendarDaysIcon, RocketLaunchIcon, FireIcon, SparklesIcon, ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline';

// Utility functions that don't need to be recreated
const getPriorityValue = (priority) => {
  switch (priority) {
    case 'High': return 3;
    case 'Medium': return 2;
    case 'Low': return 1;
    default: return 0;
  }
};

const sortProjectsByPriorityThenDateDesc = (a, b) => {
  // Primary sort: Priority (High to Low)
  const priorityComparison = getPriorityValue(b.priority) - getPriorityValue(a.priority);
  if (priorityComparison !== 0) return priorityComparison;

  // Secondary sort: Due Date (Descending - recent first)
  const dateA = a.due_date ? parseISO(a.due_date) : null;
  const dateB = b.due_date ? parseISO(b.due_date) : null;

  if (dateA === null && dateB === null) return 0;
  if (dateA === null) return 1;
  if (dateB === null) return -1;

  return compareDesc(dateA, dateB);
};

const sortTasksByDateDescThenPriority = (a, b) => {
  // Primary sort: Due Date (Descending - recent first)
  const dateA = a.due_date ? parseISO(a.due_date) : null;
  const dateB = b.due_date ? parseISO(b.due_date) : null;

  if (dateA === null && dateB === null) {
    return getPriorityValue(b.priority) - getPriorityValue(a.priority);
  }
  if (dateA === null) return 1;
  if (dateB === null) return -1;

  const dateComparison = compareDesc(dateA, dateB);
  if (dateComparison !== 0) return dateComparison;

  return getPriorityValue(b.priority) - getPriorityValue(a.priority);
};

const createDefaultDashboardFilters = () => ({
  overdue: false,
  noTasks: false,
  untouched: false,
  noDueDate: false,
});

const DASHBOARD_FILTER_LABELS = {
  overdue: 'Overdue projects',
  noTasks: 'Needs tasks',
  untouched: 'Untouched 14d',
  noDueDate: 'Missing due dates',
};

export default function DashboardPage() {
  // All hooks must be called at the top level, before any conditional returns.
  const { data: session, status } = useSession();
  const user = session?.user;
  const userId = user?.id;
  const loading = status === 'loading';
  const router = useRouter();
  const [projects, setProjects] = useState([]);
  const [allUserTasks, setAllUserTasks] = useState([]);
  const [tasksByProject, setTasksByProject] = useState({});
  const [notesByTask, setNotesByTask] = useState({});
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [showCompletedProjects, setShowCompletedProjects] = useState(false);
  const [areAllTasksExpanded, setAreAllTasksExpanded] = useState(true);
  const [showAddProjectModal, setShowAddProjectModal] = useState(false);
  const [selectedStakeholder, setSelectedStakeholder] = useState('All Stakeholders');
  const [activeDashboardFilters, setActiveDashboardFilters] = useState(() => createDefaultDashboardFilters());
  const [hideBillStakeholder, setHideBillStakeholder] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setIsLoadingData(true);
    try {
      // Fetch projects using API
      const projectData = await apiClient.getProjects(showCompletedProjects);
      
      const finalSortedProjects = (projectData || []).sort(sortProjectsByPriorityThenDateDesc);
      setProjects(finalSortedProjects);

      // Batch fetch tasks for all projects
      if (finalSortedProjects.length > 0) {
        const projectIds = finalSortedProjects.map(p => p.id);
        const batchedTasks = await apiClient.getTasksBatch(projectIds);
        setTasksByProject(batchedTasks || {});
        
        // Flatten tasks for allUserTasks
        const allTasks = [];
        Object.values(batchedTasks || {}).forEach(tasks => {
          allTasks.push(...tasks);
        });
        const sortedTasks = allTasks.sort(sortTasksByDateDescThenPriority);
        setAllUserTasks(sortedTasks);
        
        // Batch fetch notes for all tasks
        if (allTasks.length > 0) {
          const taskIds = allTasks.map(t => t.id);
          const batchedNotes = await apiClient.getNotesBatch(taskIds);
          setNotesByTask(batchedNotes || {});
        } else {
          setNotesByTask({});
        }
      } else {
        setTasksByProject({});
        setAllUserTasks([]);
        setNotesByTask({});
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      setProjects([]);
      setAllUserTasks([]);
      setTasksByProject({});
      setNotesByTask({});
    } finally {
      setIsLoadingData(false);
    }
  }, [user, showCompletedProjects]);

  useEffect(() => {
    if (status === 'authenticated' && user) {
      fetchData();
    }
  }, [status, user, fetchData]);
  
  useEffect(() => {
    // Only redirect if we're sure the user is unauthenticated
    if (status === 'unauthenticated') {
      console.log('Dashboard: User is unauthenticated, redirecting to login');
      router.push('/login');
    }
  }, [status, router]);

  const twoWeeksAgo = useMemo(() => subWeeks(new Date(), 2), []);

  const projectAnalysis = useMemo(() => {
    const overdue = [], noTasks = [], untouched = [], noDueDate = [];
    projects.forEach(p => {
      if (p.due_date && isPast(parseISO(p.due_date)) && p.status !== 'Completed' && p.status !== 'Cancelled') overdue.push(p.id);
      const tasksForProject = allUserTasks.filter(t => t.project_id === p.id);
      if (tasksForProject.length === 0) noTasks.push(p.id);
      const projectLastUpdated = parseISO(p.updated_at);
      let projectIsUntouched = projectLastUpdated < twoWeeksAgo;
      if (projectIsUntouched && tasksForProject.length > 0) {
        if (tasksForProject.some(t => parseISO(t.updated_at) >= twoWeeksAgo)) projectIsUntouched = false;
      }
      if (projectIsUntouched) untouched.push(p.id);
      let projectOrTaskHasNoDueDate = !p.due_date;
      if (!projectOrTaskHasNoDueDate && tasksForProject.some(t => !t.due_date)) projectOrTaskHasNoDueDate = true;
      if (projectOrTaskHasNoDueDate) noDueDate.push(p.id);
    });
    return { overdue, noTasks, untouched, noDueDate };
  }, [projects, allUserTasks, twoWeeksAgo]);

  const baseFilteredProjects = useMemo(() => {
    let tempProjects = [...projects];
    if (selectedStakeholder !== 'All Stakeholders') {
      tempProjects = tempProjects.filter(p => p.stakeholders && p.stakeholders.includes(selectedStakeholder));
    }
    if (hideBillStakeholder) {
      tempProjects = tempProjects.filter(p => !p.stakeholders || !p.stakeholders.includes('Bill'));
    }
    if (activeDashboardFilters.overdue) tempProjects = tempProjects.filter(p => projectAnalysis.overdue.includes(p.id));
    if (activeDashboardFilters.noTasks) tempProjects = tempProjects.filter(p => projectAnalysis.noTasks.includes(p.id));
    if (activeDashboardFilters.untouched) tempProjects = tempProjects.filter(p => projectAnalysis.untouched.includes(p.id));
    if (activeDashboardFilters.noDueDate) tempProjects = tempProjects.filter(p => projectAnalysis.noDueDate.includes(p.id));
    return tempProjects;
  }, [projects, selectedStakeholder, activeDashboardFilters, projectAnalysis, hideBillStakeholder]);

  const handleProjectAdded = useCallback((newProject) => {
    if (!newProject || !newProject.id) {
      fetchData(); 
      return;
    }
    setProjects(prevProjects => {
      const updated = [newProject, ...prevProjects];
      return updated.sort(sortProjectsByPriorityThenDateDesc);
    });
    setShowAddProjectModal(false);
  }, [fetchData]);
  
  const handleGenericDataRefreshNeeded = useCallback(() => {
    fetchData();
  }, [fetchData]);

  const handleProjectDataChange = useCallback((itemId, changedData, itemType = 'project', details) => {
    if (itemType === 'task_added') {
      const newTask = details?.task;
      if (!newTask || !newTask.id) { 
        fetchData(); 
        return;
      }
      // Update both allUserTasks and tasksByProject
      setAllUserTasks(prevTasks => [newTask, ...prevTasks].sort(sortTasksByDateDescThenPriority));
      setTasksByProject(prev => ({
        ...prev,
        [newTask.project_id]: [newTask, ...(prev[newTask.project_id] || [])].sort((a, b) => {
          if (a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1;
          const dateA = a.due_date ? new Date(a.due_date) : null;
          const dateB = b.due_date ? new Date(b.due_date) : null;
          if (dateA && dateB) return dateA - dateB;
          if (dateA) return -1;
          if (dateB) return 1;
          const priorityOrder = { 'High': 0, 'Medium': 1, 'Low': 2 };
          return (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3);
        })
      }));
      setProjects(prevProjects => 
        prevProjects.map(p => p.id === newTask.project_id ? { ...p, updated_at: new Date().toISOString() } : p).sort(sortProjectsByPriorityThenDateDesc)
      );
    } else if (itemType === 'task_updated') {
      const updatedTask = changedData;
      // Update both allUserTasks and tasksByProject
      setAllUserTasks(prevTasks => prevTasks.map(t => t.id === updatedTask.id ? updatedTask : t).sort(sortTasksByDateDescThenPriority));
      setTasksByProject(prev => ({
        ...prev,
        [updatedTask.project_id]: (prev[updatedTask.project_id] || []).map(t => t.id === updatedTask.id ? updatedTask : t).sort((a, b) => {
          if (a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1;
          const dateA = a.due_date ? new Date(a.due_date) : null;
          const dateB = b.due_date ? new Date(b.due_date) : null;
          if (dateA && dateB) return dateA - dateB;
          if (dateA) return -1;
          if (dateB) return 1;
          const priorityOrder = { 'High': 0, 'Medium': 1, 'Low': 2 };
          return (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3);
        })
      }));
      setProjects(prevProjects => 
        prevProjects.map(p => p.id === updatedTask.project_id ? { ...p, updated_at: new Date().toISOString() } : p).sort(sortProjectsByPriorityThenDateDesc)
      );
    } else if (itemType === 'project_status_changed' || itemType === 'project_details_changed') {
      const updatedProjectPartial = changedData;
      setProjects(prevProjects => 
        prevProjects.map(p => p.id === itemId ? { ...p, ...updatedProjectPartial, updated_at: new Date().toISOString() } : p)
        .filter(p => showCompletedProjects || (p.status !== 'Completed' && p.status !== 'Cancelled'))
         .sort(sortProjectsByPriorityThenDateDesc)
      );
    } else {
      fetchData(); 
    }
  }, [showCompletedProjects, fetchData]);

  const handleProjectDeleted = useCallback((deletedProjectId) => {
    setProjects(prevProjects => prevProjects.filter(p => p.id !== deletedProjectId));
    setAllUserTasks(prevTasks => prevTasks.filter(t => t.project_id !== deletedProjectId));
  }, []);

  const toggleExpandAllTasks = useCallback(() => {
    setAreAllTasksExpanded(prev => !prev);
  }, []);

  const uniqueStakeholders = useMemo(() => Array.from(
    new Set(projects.flatMap(p => p.stakeholders || []).filter(sh => sh && sh.trim() !== ''))
  ).sort(), [projects]);

  const toggleDashboardFilter = useCallback((filterName) => {
    setActiveDashboardFilters(prev => ({ ...prev, [filterName]: !prev[filterName] }));
  }, []);

  // Memoize select change handler
  const handleStakeholderChange = useCallback((e) => {
    setSelectedStakeholder(e.target.value);
  }, []);

  // Memoize button click handlers
  const handleShowAddProjectModal = useCallback(() => setShowAddProjectModal(true), []);
  const handleHideAddProjectModal = useCallback(() => setShowAddProjectModal(false), []);
  const handleToggleCompletedProjects = useCallback(() => setShowCompletedProjects(prev => !prev), []);
  const handleToggleHideBill = useCallback(() => setHideBillStakeholder(prev => !prev), []);
  const handleResetFilters = useCallback(() => {
    setSelectedStakeholder('All Stakeholders');
    setActiveDashboardFilters(createDefaultDashboardFilters());
    setHideBillStakeholder(false);
  }, []);
  const handleSignOut = useCallback(async () => {
    const currentUrl = window.location.origin;
    await signOut({ callbackUrl: `${currentUrl}/login` });
  }, []);

  // Memoize task update handler
  const handleTaskUpdate = useCallback((updatedTask) => {
    handleProjectDataChange(updatedTask.id, updatedTask, 'task_updated');
  }, [handleProjectDataChange]);

  // Memoize project update handler
  const handleProjectUpdate = useCallback((updatedProject) => {
    setProjects(prevProjects => 
      prevProjects.map(p => p.id === updatedProject.id ? updatedProject : p)
    );
  }, []);
  const handleQuickTaskAdd = useCallback(async ({ name, dueDate, priority }) => {
    if (!userId) {
      throw new Error('You must be signed in to add tasks.');
    }
    const newTaskPayload = {
      name: name.trim(),
      due_date: dueDate,
      project_id: null,
      user_id: userId,
      priority: priority || 'Medium',
    };
    const createdTask = await apiClient.createTask(newTaskPayload);
    handleProjectDataChange(createdTask.id, createdTask, 'task_added', { task: createdTask });
    return createdTask;
  }, [userId, handleProjectDataChange]);

  // Memoize active filter check
  const hasActiveFilters = useMemo(() => {
    return selectedStakeholder !== 'All Stakeholders' || 
           activeDashboardFilters.overdue || 
           activeDashboardFilters.noTasks || 
           activeDashboardFilters.untouched || 
           activeDashboardFilters.noDueDate ||
           hideBillStakeholder;
  }, [selectedStakeholder, activeDashboardFilters, hideBillStakeholder]);

  // Memoize project title
  const projectSectionTitle = useMemo(() => {
    return hasActiveFilters ? 'Filtered Projects' : 'Your Projects';
  }, [hasActiveFilters]);
  const activeProjectsCount = useMemo(() => {
    return projects.filter(p => p.status !== 'Completed' && p.status !== 'Cancelled').length;
  }, [projects]);
  const openTasksCount = useMemo(() => {
    return allUserTasks.filter(task => !task.is_completed).length;
  }, [allUserTasks]);
  const upcomingTasksCount = useMemo(() => {
    const now = new Date();
    return allUserTasks.filter(task => {
      if (task.is_completed || !task.due_date) return false;
      const dueDate = parseISO(task.due_date);
      if (isPast(dueDate) && differenceInCalendarDays(dueDate, now) < 0) return false;
      const daysDiff = differenceInCalendarDays(dueDate, now);
      return daysDiff >= 0 && daysDiff <= 7;
    }).length;
  }, [allUserTasks]);
  const metrics = useMemo(() => ([
    {
      id: 'active-projects',
      label: 'Active projects',
      value: activeProjectsCount,
      helper: `${projects.length} total in workspace`,
      icon: RocketLaunchIcon,
      glow: 'bg-indigo-500/25',
    },
    {
      id: 'overdue-projects',
      label: 'Needs attention',
      value: projectAnalysis.overdue.length,
      helper: 'Projects overdue or blocked',
      icon: FireIcon,
      glow: 'bg-red-500/25',
    },
    {
      id: 'upcoming-tasks',
      label: 'Next 7 days',
      value: upcomingTasksCount,
      helper: `${openTasksCount} open tasks`,
      icon: SparklesIcon,
      glow: 'bg-emerald-400/25',
    },
  ]), [activeProjectsCount, projects.length, projectAnalysis.overdue.length, upcomingTasksCount, openTasksCount]);
  const appliedFilters = useMemo(() => {
    const filters = [];
    if (selectedStakeholder !== 'All Stakeholders') {
      filters.push({ id: `stakeholder:${selectedStakeholder}`, label: `Stakeholder: ${selectedStakeholder}` });
    }
    if (hideBillStakeholder) {
      filters.push({ id: 'hide-bill', label: 'Bill hidden' });
    }
    Object.entries(activeDashboardFilters).forEach(([key, value]) => {
      if (value) {
        filters.push({ id: `focus:${key}`, label: DASHBOARD_FILTER_LABELS[key] || key });
      }
    });
    return filters;
  }, [selectedStakeholder, hideBillStakeholder, activeDashboardFilters]);
  const workspaceSubtitle = useMemo(() => {
    if (hasActiveFilters) {
      return 'Filter stack engaged — review the prioritized view and clear filters when finished.';
    }
    return 'Welcome back. Everything is synced to live data; scan metrics below to spot emerging bottlenecks.';
  }, [hasActiveFilters]);
  const shellActions = useMemo(() => ([
    {
      key: 'report',
      label: 'Completed Report',
      href: '/completed-report',
      icon: CalendarDaysIcon,
      variant: 'secondary',
    },
    {
      key: 'new-project',
      label: 'New Project',
      onClick: handleShowAddProjectModal,
      icon: PlusCircleIcon,
      variant: 'primary',
    },
    {
      key: 'sign-out',
      label: 'Sign Out',
      onClick: handleSignOut,
      icon: ArrowRightOnRectangleIcon,
      variant: 'destructive',
    },
  ]), [handleShowAddProjectModal, handleSignOut]);
  
  // Conditional return must be AFTER all hook definitions
  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-24">
        <p>Loading dashboard...</p>
      </div>
    );
  }
  
  // If authenticated but no user data yet, show loading
  if (status === 'authenticated' && !user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-24">
        <p>Loading user data...</p>
      </div>
    );
  }
  
  // Don't render dashboard if not authenticated
  if (status === 'unauthenticated') {
    return null;
  }

  return (
    <>
      <AppShell
        user={user}
        title="Planner Command Center"
        subtitle={workspaceSubtitle}
        actions={shellActions}
        sidebar={
          <SidebarFilters
            uniqueStakeholders={uniqueStakeholders}
            selectedStakeholder={selectedStakeholder}
            onStakeholderChange={handleStakeholderChange}
            showCompletedProjects={showCompletedProjects}
            onToggleCompleted={handleToggleCompletedProjects}
            areAllTasksExpanded={areAllTasksExpanded}
            onToggleExpandTasks={toggleExpandAllTasks}
            hideBillStakeholder={hideBillStakeholder}
            onToggleHideBill={handleToggleHideBill}
            activeDashboardFilters={activeDashboardFilters}
            onToggleDashboardFilter={toggleDashboardFilter}
            projectAnalysis={projectAnalysis}
          />
        }
        sideContent={
          <TasksPanel
            isLoading={isLoadingData}
            tasks={allUserTasks}
            projects={projects}
            onTaskUpdate={handleTaskUpdate}
            hideBillStakeholder={hideBillStakeholder}
            onQuickAdd={handleQuickTaskAdd}
          />
        }
      >
        <MetricsBar metrics={metrics} />

        {appliedFilters.length > 0 && (
          <div className="glass-panel flex flex-wrap items-center gap-3 rounded-3xl border border-[#0496c7]/25 px-5 py-4 text-sm text-[#052a3b]">
            <span className="text-xs uppercase tracking-[0.2em] text-[#036586]/80">Active filters</span>
            <div className="flex flex-wrap items-center gap-2">
              {appliedFilters.map(filter => (
                <span
                  key={filter.id}
                  className="rounded-full bg-[#0496c7]/15 px-3 py-1 text-xs font-semibold text-[#036586] shadow-inner shadow-[#0496c7]/25"
                >
                  {filter.label}
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={handleResetFilters}
              className="ml-auto inline-flex items-center rounded-full border border-[#0496c7]/30 bg-white px-4 py-1.5 text-xs font-medium text-[#036586] transition hover:border-[#0496c7]/50 hover:bg-[#0496c7]/10"
            >
              Clear all
            </button>
          </div>
        )}

        <section className="card-surface mt-8 overflow-hidden border border-[#0496c7]/20 bg-white/90 text-[#052a3b] shadow-[0_28px_60px_-32px_rgba(4,150,199,0.35)]">
          <div className="border-b border-[#0496c7]/20 bg-white px-6 py-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-[#036586]/80">Projects</p>
                <h2 className="mt-2 text-2xl font-semibold text-[#052a3b]">{projectSectionTitle}</h2>
                <p className="mt-2 text-sm text-[#2f617a]">
                  {hasActiveFilters
                    ? `Showing ${baseFilteredProjects.length} project${baseFilteredProjects.length === 1 ? '' : 's'} that match your current filters.`
                    : `Monitoring ${baseFilteredProjects.length} project${baseFilteredProjects.length === 1 ? '' : 's'} in flight.`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="rounded-full border border-[#0496c7]/30 bg-[#0496c7]/12 px-4 py-2 text-xs font-semibold tracking-wide text-[#036586]">
                  {baseFilteredProjects.length} showing
                </div>
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="inline-flex items-center rounded-full border border-[#0496c7]/25 px-4 py-2 text-xs font-medium text-[#036586] transition hover:border-[#0496c7]/45 hover:text-[#0496c7]"
                  >
                    Reset filters
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="bg-white px-2 py-6 sm:px-4 md:px-6">
            {isLoadingData ? (
              <ProjectListSkeleton />
            ) : baseFilteredProjects.length > 0 ? (
              <ProjectList
                projects={baseFilteredProjects}
                tasksByProject={tasksByProject}
                notesByTask={notesByTask}
                onProjectDataChange={handleProjectDataChange}
                onProjectDeleted={handleProjectDeleted}
                onProjectUpdated={handleProjectUpdate}
                areAllTasksExpanded={areAllTasksExpanded}
              />
            ) : hasActiveFilters ? (
              <EmptyFilteredResults />
            ) : (
              <EmptyProjects />
            )}
          </div>
        </section>
      </AppShell>

      {showAddProjectModal && (
        <AddProjectModal
          isOpen={showAddProjectModal}
          onClose={handleHideAddProjectModal}
          onProjectAdded={handleProjectAdded}
        />
      )}
    </>
  );
} 
