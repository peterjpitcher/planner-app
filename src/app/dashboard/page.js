'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { apiClient } from '@/lib/apiClient';
import ProjectList from '@/components/Projects/ProjectList';
import AddProjectModal from '@/components/Projects/AddProjectModal';
import SidebarFilters from '@/components/dashboard/SidebarFilters';
import MetricsBar from '@/components/dashboard/MetricsBar';
import { Button } from '@/components/ui/Button';
import { PlusCircle } from 'lucide-react';
import { differenceInCalendarDays, isPast, parseISO, subWeeks, compareDesc } from 'date-fns';
import { RocketLaunchIcon, FireIcon, SparklesIcon } from '@heroicons/react/24/outline';

const ButtonComponent = Button;

// Re-declaring utilities for safety in this full rewrite
const getPriorityValue = (priority) => {
  switch (priority) {
    case 'High': return 3;
    case 'Medium': return 2;
    case 'Low': return 1;
    default: return 0;
  }
};

const sortProjectsByPriorityThenDateDesc = (a, b) => {
  const priorityComparison = getPriorityValue(b.priority) - getPriorityValue(a.priority);
  if (priorityComparison !== 0) return priorityComparison;
  const dateA = a.due_date ? parseISO(a.due_date) : null;
  const dateB = b.due_date ? parseISO(b.due_date) : null;
  if (dateA === null && dateB === null) return 0;
  if (dateA === null) return 1;
  if (dateB === null) return -1;
  return compareDesc(dateA, dateB);
};

const sortTasksByDateDescThenPriority = (a, b) => {
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

const ALL_JOBS = 'All Jobs';
const NO_JOB = 'No Job';
const normalizeJob = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const matchesSelectedJob = (jobValue, selectedJob) => {
  if (selectedJob === ALL_JOBS) return true;
  const normalizedJob = normalizeJob(jobValue);
  if (selectedJob === NO_JOB) return !normalizedJob;
  return normalizedJob === selectedJob;
};

const DASHBOARD_FILTER_TYPES = {
  PROJECT: 'project',
  TASK: 'task',
};

const hasAnyActiveFocusFilter = (filters = {}) => Boolean(
  filters.overdue || filters.noTasks || filters.untouched || filters.noDueDate
);

function filterDashboardItems({
  type,
  projects = [],
  tasks = [],
  selectedStakeholder = 'All Stakeholders',
  activeDashboardFilters = {},
  projectAnalysis = {},
}) {
  const normalizedType = type === DASHBOARD_FILTER_TYPES.TASK ? DASHBOARD_FILTER_TYPES.TASK : DASHBOARD_FILTER_TYPES.PROJECT;
  const { overdue = [], noTasks = [], untouched = [], noDueDate = [] } = projectAnalysis || {};

  const applyProjectFilters = (inputProjects) => {
    let filtered = [...inputProjects];
    if (selectedStakeholder !== 'All Stakeholders') {
      filtered = filtered.filter(project => Array.isArray(project.stakeholders) && project.stakeholders.includes(selectedStakeholder));
    }
    if (activeDashboardFilters.overdue) {
      const ids = new Set(overdue);
      filtered = filtered.filter(project => ids.has(project.id));
    }
    if (activeDashboardFilters.noTasks) {
      const ids = new Set(noTasks);
      filtered = filtered.filter(project => ids.has(project.id));
    }
    if (activeDashboardFilters.untouched) {
      const ids = new Set(untouched);
      filtered = filtered.filter(project => ids.has(project.id));
    }
    if (activeDashboardFilters.noDueDate) {
      const ids = new Set(noDueDate);
      filtered = filtered.filter(project => ids.has(project.id));
    }
    return filtered;
  };

  if (normalizedType === DASHBOARD_FILTER_TYPES.TASK) {
    const baseFiltersActive = selectedStakeholder !== 'All Stakeholders' || hasAnyActiveFocusFilter(activeDashboardFilters);
    if (!baseFiltersActive) return tasks;
    const filteredProjects = applyProjectFilters(projects);
    const allowedProjectIds = new Set(filteredProjects.map(p => p.id));
    const focusFiltersActive = hasAnyActiveFocusFilter(activeDashboardFilters);
    return tasks.filter(task => {
      if (!task?.project_id) {
        if (selectedStakeholder !== 'All Stakeholders') return false;
        if (focusFiltersActive) return false;
        return true;
      }
      return allowedProjectIds.has(task.project_id);
    });
  }
  return applyProjectFilters(projects);
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const user = session?.user;
  const loading = status === 'loading';
  const router = useRouter();

  // State
  const [projects, setProjects] = useState([]);
  const [allUserTasks, setAllUserTasks] = useState([]);
  const [tasksByProject, setTasksByProject] = useState({});
  const [notesByTask, setNotesByTask] = useState({});
  const [projectNotes, setProjectNotes] = useState({});
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [taskDragState, setTaskDragState] = useState({ active: false, sourceProjectId: null });
  const [showCompletedProjects, setShowCompletedProjects] = useState(false);
  const [areAllTasksExpanded, setAreAllTasksExpanded] = useState(true);
  const [selectedJob, setSelectedJob] = useState(ALL_JOBS);
  const [selectedStakeholder, setSelectedStakeholder] = useState('All Stakeholders');
  const [activeDashboardFilters, setActiveDashboardFilters] = useState(() => createDefaultDashboardFilters());
  const [isAddProjectModalOpen, setIsAddProjectModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Fetch logic
  const fetchData = useCallback(async () => {
    if (!user) return;
    setIsLoadingData(true);
    try {
      const projectData = await apiClient.getProjects(showCompletedProjects);
      const finalSortedProjects = (projectData || []).sort(sortProjectsByPriorityThenDateDesc);
      setProjects(finalSortedProjects);

      if (finalSortedProjects.length > 0) {
        const projectIds = finalSortedProjects.map(p => p.id);
        const batchedTasks = await apiClient.getTasksBatch(projectIds);
        setTasksByProject(batchedTasks || {});
        const batchedProjectNotes = await apiClient.getProjectNotesBatch(projectIds);
        setProjectNotes(batchedProjectNotes || {});

        const allTasks = [];
        Object.values(batchedTasks || {}).forEach(tasks => allTasks.push(...tasks));
        setAllUserTasks(allTasks.sort(sortTasksByDateDescThenPriority));

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
        setProjectNotes({});
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      setProjects([]);
      setAllUserTasks([]);
      setTasksByProject({});
      setNotesByTask({});
      setProjectNotes({});
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
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  // Derived State
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

  const baseFilteredProjects = useMemo(() => filterDashboardItems({
    type: DASHBOARD_FILTER_TYPES.PROJECT,
    projects,
    selectedStakeholder,
    activeDashboardFilters,
    projectAnalysis,
  }), [projects, selectedStakeholder, activeDashboardFilters, projectAnalysis]);

  const jobFilteredProjects = useMemo(() => {
    if (selectedJob === ALL_JOBS) return baseFilteredProjects;

    const unassignedProject = baseFilteredProjects.find(project => project?.name?.toLowerCase() === 'unassigned');
    const otherProjects = baseFilteredProjects.filter(project => project?.name?.toLowerCase() !== 'unassigned');
    const filteredOtherProjects = otherProjects.filter(project => matchesSelectedJob(project?.job, selectedJob));

    if (!unassignedProject) {
      return filteredOtherProjects;
    }

    const unassignedTasks = tasksByProject?.[unassignedProject.id] || [];
    const hasMatchingUnassignedTasks = unassignedTasks.some(task => matchesSelectedJob(task?.job, selectedJob));
    return hasMatchingUnassignedTasks ? [unassignedProject, ...filteredOtherProjects] : filteredOtherProjects;
  }, [baseFilteredProjects, selectedJob, tasksByProject]);

  const searchedProjects = useMemo(() => {
    if (!searchTerm.trim()) return jobFilteredProjects;
    const lowerSearch = searchTerm.toLowerCase();
    return jobFilteredProjects.filter(project => {
      if (project.name?.toLowerCase().includes(lowerSearch) || project.description?.toLowerCase().includes(lowerSearch)) return true;
      if (project.stakeholders?.some(s => s.toLowerCase().includes(lowerSearch))) return true;
      const pNotes = projectNotes[project.id] || [];
      if (pNotes.some(n => n.content?.toLowerCase().includes(lowerSearch))) return true;
      const pTasks = tasksByProject[project.id] || [];
      return pTasks.some(task => {
        if (task.name?.toLowerCase().includes(lowerSearch) || task.description?.toLowerCase().includes(lowerSearch)) return true;
        const tNotes = notesByTask[task.id] || [];
        return tNotes.some(n => n.content?.toLowerCase().includes(lowerSearch));
      });
    });
  }, [jobFilteredProjects, searchTerm, projectNotes, tasksByProject, notesByTask]);

  // Handlers
  const handleProjectDataChange = useCallback((itemId, changedData, itemType = 'project', details) => {
    if (itemType === 'task_added' || itemType === 'task_updated') {
      fetchData();
    } else {
      fetchData();
    }
  }, [fetchData]);

  const handleProjectDeleted = useCallback((deletedProjectId) => {
    setProjects(prev => prev.filter(p => p.id !== deletedProjectId));
    fetchData();
  }, [fetchData]);

  const handleProjectAdded = useCallback((newProject) => {
    fetchData();
  }, [fetchData]);

  const handleToggleCompletedProjects = useCallback(() => setShowCompletedProjects(prev => !prev), []);
  const handleResetFilters = useCallback(() => {
    setSelectedJob(ALL_JOBS);
    setSelectedStakeholder('All Stakeholders');
    setActiveDashboardFilters(createDefaultDashboardFilters());
    setSearchTerm('');
  }, []);

  const handleTaskUpdate = useCallback((updatedTask) => {
    fetchData();
  }, [fetchData]);

  const handleTaskDragStateChange = useCallback((isDragging, sourceProjectId = null) => {
    setTaskDragState({ active: isDragging, sourceProjectId: sourceProjectId || null });
  }, []);

  const handleProjectUpdate = useCallback((updatedProject) => {
    fetchData();
  }, [fetchData]);

  const toggleExpandAllTasks = useCallback(() => setAreAllTasksExpanded(prev => !prev), []);
  const toggleDashboardFilter = useCallback((filterName) => {
    setActiveDashboardFilters(prev => ({ ...prev, [filterName]: !prev[filterName] }));
  }, []);
  const handleJobChange = useCallback((e) => setSelectedJob(e.target.value), []);
  const handleStakeholderChange = useCallback((e) => setSelectedStakeholder(e.target.value), []);

  const uniqueJobs = useMemo(() => {
    const jobs = new Set();
    projects.forEach(project => {
      const job = normalizeJob(project?.job);
      if (job) jobs.add(job);
    });
    const unassignedProject = projects.find(project => project?.name?.toLowerCase() === 'unassigned');
    if (unassignedProject?.id) {
      (tasksByProject?.[unassignedProject.id] || []).forEach(task => {
        const job = normalizeJob(task?.job);
        if (job) jobs.add(job);
      });
    }
    return Array.from(jobs).sort();
  }, [projects, tasksByProject]);

  const uniqueStakeholders = useMemo(() => Array.from(
    new Set(projects.flatMap(p => p.stakeholders || []).filter(sh => sh && sh.trim() !== ''))
  ).sort(), [projects]);

  const filteredTasksByProject = useMemo(() => {
    if (selectedJob === ALL_JOBS) return tasksByProject;
    const unassignedProject = projects.find(project => project?.name?.toLowerCase() === 'unassigned');
    if (!unassignedProject?.id) return tasksByProject;
    const unassignedTasks = tasksByProject?.[unassignedProject.id] || [];
    const filteredUnassignedTasks = unassignedTasks.filter(task => matchesSelectedJob(task?.job, selectedJob));
    return { ...tasksByProject, [unassignedProject.id]: filteredUnassignedTasks };
  }, [selectedJob, tasksByProject, projects]);

  const activeProjectsCount = useMemo(() => projects.filter(p => p.status !== 'Completed' && p.status !== 'Cancelled').length, [projects]);
  const openTasksCount = useMemo(() => allUserTasks.filter(task => !task.is_completed).length, [allUserTasks]);
  const upcomingTasksCount = useMemo(() => {
    const now = new Date();
    return allUserTasks.filter(task => {
      if (task.is_completed || !task.due_date) return false;
      const dueDate = parseISO(task.due_date);
      const daysDiff = differenceInCalendarDays(dueDate, now);
      return daysDiff >= 0 && daysDiff <= 7;
    }).length;
  }, [allUserTasks]);

  const metrics = useMemo(() => ([
    {
      id: 'active-projects',
      label: 'Active projects',
      value: activeProjectsCount,
      helper: `${projects.length} total`,
      icon: RocketLaunchIcon,
      glow: 'bg-indigo-500/10',
    },
    {
      id: 'overdue-projects',
      label: 'Needs attention',
      value: projectAnalysis.overdue.length,
      helper: 'Overdue/Blocked',
      icon: FireIcon,
      glow: 'bg-red-500/10',
    },
    {
      id: 'upcoming-tasks',
      label: 'Next 7 days',
      value: upcomingTasksCount,
      helper: `${openTasksCount} open tasks`,
      icon: SparklesIcon,
      glow: 'bg-emerald-400/10',
    },
  ]), [activeProjectsCount, projects.length, projectAnalysis, upcomingTasksCount, openTasksCount]);

  if (loading || (status === 'authenticated' && !user)) {
    return <div className="p-8">Loading...</div>;
  }
  if (status === 'unauthenticated') return null;

  return (
    <>
      <div className="flex flex-col gap-4 mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Planner Command Center</h1>
            <p className="text-muted-foreground mt-1">
              {hasAnyActiveFocusFilter(activeDashboardFilters) || selectedStakeholder !== 'All Stakeholders'
                ? 'Filter stack engaged — review the prioritized view.'
                : 'Welcome back. Everything is synced to live data.'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <ButtonComponent onClick={() => setIsAddProjectModalOpen(true)}>
              <PlusCircle className="w-4 h-4 mr-2" />
              New Project
            </ButtonComponent>
          </div>
        </div>

        <MetricsBar metrics={metrics} />
      </div>

      {/* Main Content Layout: 3-column Grid for Wide Screens */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-8 items-start">

        {/* Column 1: Projects (Flex Grow) */}
        <div className="w-full space-y-6">
          <ProjectList
            projects={searchedProjects}
            tasksByProject={filteredTasksByProject}
            notesByProject={projectNotes}
            notesByTask={notesByTask}
            isLoading={isLoadingData}
            onProjectDataChange={handleProjectDataChange}
            onProjectDeleted={handleProjectDeleted}
            onTaskUpdate={handleTaskUpdate}
            onTaskDragStateChange={handleTaskDragStateChange}
            isTaskDragActive={taskDragState.active}
            dragSourceProjectId={taskDragState.sourceProjectId}
            onProjectUpdate={handleProjectUpdate}
            areAllTasksExpanded={areAllTasksExpanded}
          />
        </div>

        {/* Column 2: Filters (Sticky) */}
        <div className="w-full shrink-0 xl:sticky xl:top-20 space-y-6">
          <SidebarFilters
            uniqueJobs={uniqueJobs}
            selectedJob={selectedJob}
            onJobChange={handleJobChange}
            uniqueStakeholders={uniqueStakeholders}
            selectedStakeholder={selectedStakeholder}
            onStakeholderChange={handleStakeholderChange}
            showCompletedProjects={showCompletedProjects}
            onToggleCompleted={handleToggleCompletedProjects}
            areAllTasksExpanded={areAllTasksExpanded}
            onToggleExpandTasks={toggleExpandAllTasks}
            activeDashboardFilters={activeDashboardFilters}
            onToggleDashboardFilter={toggleDashboardFilter}
            projectAnalysis={projectAnalysis}
          />
        </div>
      </div>

      <AddProjectModal
        isOpen={isAddProjectModalOpen}
        onClose={() => setIsAddProjectModalOpen(false)}
        onProjectAdded={handleProjectAdded}
      />
    </>
  );
}
