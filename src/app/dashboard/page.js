'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { apiClient } from '@/lib/apiClient';
import ProjectList from '@/components/projects/ProjectList';
import AddProjectModal from '@/components/projects/AddProjectModal';
import AppShell from '@/components/layout/AppShell';
import SidebarFilters from '@/components/dashboard/SidebarFilters';
import MetricsBar from '@/components/dashboard/MetricsBar';
import TasksPanel from '@/components/dashboard/TasksPanel';
import { ProjectListSkeleton } from '@/components/ui/LoadingStates';
import { EmptyProjects, EmptyFilteredResults } from '@/components/ui/EmptyStates';
import { differenceInCalendarDays, isPast, parseISO, subWeeks, compareDesc } from 'date-fns';
import { RocketLaunchIcon, FireIcon, SparklesIcon, PlusCircleIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';

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

const sortTasksForProjectCard = (tasks) => {
  const priorityOrder = { High: 0, Medium: 1, Low: 2 };
  return [...tasks].sort((a, b) => {
    if (a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1;
    const dateA = a.due_date ? new Date(a.due_date) : null;
    const dateB = b.due_date ? new Date(b.due_date) : null;
    if (dateA && dateB) return dateA - dateB;
    if (dateA) return -1;
    if (dateB) return 1;
    return (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3);
  });
};

const createDefaultDashboardFilters = () => ({
  overdue: false,
  noTasks: false,
  untouched: false,
  noDueDate: false,
});

const BILL_NAME_REGEX = /\bbill\b/i;

const mentionsBillStakeholder = (stakeholders) => {
  if (!Array.isArray(stakeholders)) return false;
  return stakeholders.some((stakeholder) => typeof stakeholder === 'string' && BILL_NAME_REGEX.test(stakeholder));
};

const DASHBOARD_FILTER_LABELS = {
  overdue: 'Overdue projects',
  noTasks: 'Needs tasks',
  untouched: 'Untouched 14d',
  noDueDate: 'Missing due dates',
};

const DASHBOARD_FILTER_TYPES = {
  PROJECT: 'project',
  TASK: 'task',
};

const hasAnyActiveFocusFilter = (filters = {}) => Boolean(
  filters.overdue ||
  filters.noTasks ||
  filters.untouched ||
  filters.noDueDate
);

function filterDashboardItems({
  type,
  projects = [],
  tasks = [],
  selectedStakeholder = 'All Stakeholders',
  hideBillStakeholder = false,
  activeDashboardFilters = {},
  projectAnalysis = {},
}) {
  const normalizedType = type === DASHBOARD_FILTER_TYPES.TASK
    ? DASHBOARD_FILTER_TYPES.TASK
    : DASHBOARD_FILTER_TYPES.PROJECT;

  const { overdue = [], noTasks = [], untouched = [], noDueDate = [] } = projectAnalysis || {};

  const applyProjectFilters = (inputProjects) => {
    let filtered = [...inputProjects];

    if (selectedStakeholder !== 'All Stakeholders') {
      filtered = filtered.filter(
        (project) => Array.isArray(project.stakeholders) && project.stakeholders.includes(selectedStakeholder)
      );
    }

    if (hideBillStakeholder) {
      filtered = filtered.filter((project) => !mentionsBillStakeholder(project.stakeholders));
    }

    if (activeDashboardFilters.overdue) {
      const overdueIds = new Set(overdue);
      filtered = filtered.filter((project) => overdueIds.has(project.id));
    }

    if (activeDashboardFilters.noTasks) {
      const noTasksIds = new Set(noTasks);
      filtered = filtered.filter((project) => noTasksIds.has(project.id));
    }

    if (activeDashboardFilters.untouched) {
      const untouchedIds = new Set(untouched);
      filtered = filtered.filter((project) => untouchedIds.has(project.id));
    }

    if (activeDashboardFilters.noDueDate) {
      const missingDueDateIds = new Set(noDueDate);
      filtered = filtered.filter((project) => missingDueDateIds.has(project.id));
    }

    return filtered;
  };

  if (normalizedType === DASHBOARD_FILTER_TYPES.TASK) {
    const baseFiltersActive =
      selectedStakeholder !== 'All Stakeholders' ||
      hideBillStakeholder ||
      hasAnyActiveFocusFilter(activeDashboardFilters);

    if (!baseFiltersActive) {
      return tasks;
    }

    const filteredProjects = applyProjectFilters(projects);
    const allowedProjectIds = new Set(filteredProjects.map((project) => project.id));
    const focusFiltersActive = hasAnyActiveFocusFilter(activeDashboardFilters);

    return tasks.filter((task) => {
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
  const [projectNotes, setProjectNotes] = useState({});
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [taskDragState, setTaskDragState] = useState({ active: false, sourceProjectId: null });
  const [showCompletedProjects, setShowCompletedProjects] = useState(false);
  const [areAllTasksExpanded, setAreAllTasksExpanded] = useState(true);
  const [selectedStakeholder, setSelectedStakeholder] = useState('All Stakeholders');
  const [activeDashboardFilters, setActiveDashboardFilters] = useState(() => createDefaultDashboardFilters());
  const [hideBillStakeholder, setHideBillStakeholder] = useState(false);
  const [isAddProjectModalOpen, setIsAddProjectModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

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

        // Fetch tasks
        const batchedTasks = await apiClient.getTasksBatch(projectIds);
        setTasksByProject(batchedTasks || {});

        // Fetch project notes
        const batchedProjectNotes = await apiClient.getProjectNotesBatch(projectIds);
        setProjectNotes(batchedProjectNotes || {});

        // Flatten tasks for allUserTasks
        const allTasks = [];
        const now = new Date();
        Object.values(batchedTasks || {}).forEach(tasks => {
          allTasks.push(...tasks);
        });
        const tasksDueTodayOrEarlier = allTasks.filter(task => {
          if (!task?.due_date) return false;
          const dueDate = parseISO(task.due_date);
          return differenceInCalendarDays(dueDate, now) <= 0;
        });
        const sortedTasks = tasksDueTodayOrEarlier.sort(sortTasksByDateDescThenPriority);
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

  const baseFilteredProjects = useMemo(() => filterDashboardItems({
    type: DASHBOARD_FILTER_TYPES.PROJECT,
    projects,
    selectedStakeholder,
    hideBillStakeholder,
    activeDashboardFilters,
    projectAnalysis,
  }), [projects, selectedStakeholder, hideBillStakeholder, activeDashboardFilters, projectAnalysis]);

  const searchedProjects = useMemo(() => {
    if (!searchTerm.trim()) return baseFilteredProjects;

    const lowerSearch = searchTerm.toLowerCase();

    return baseFilteredProjects.filter(project => {
      // 1. Check project details
      if (
        project.name?.toLowerCase().includes(lowerSearch) ||
        project.description?.toLowerCase().includes(lowerSearch)
      ) return true;

      // 2. Check project stakeholders
      if (project.stakeholders?.some(s => s.toLowerCase().includes(lowerSearch))) return true;

      // 3. Check project notes
      const pNotes = projectNotes[project.id] || [];
      if (pNotes.some(n => n.content?.toLowerCase().includes(lowerSearch))) return true;

      // 4. Check tasks and task notes
      const pTasks = tasksByProject[project.id] || [];
      return pTasks.some(task => {
        if (
          task.name?.toLowerCase().includes(lowerSearch) ||
          task.description?.toLowerCase().includes(lowerSearch)
        ) return true;

        const tNotes = notesByTask[task.id] || [];
        return tNotes.some(n => n.content?.toLowerCase().includes(lowerSearch));
      });
    });
  }, [baseFilteredProjects, searchTerm, projectNotes, tasksByProject, notesByTask]);

  const filteredTasksForDashboard = useMemo(() => filterDashboardItems({
    type: DASHBOARD_FILTER_TYPES.TASK,
    projects,
    tasks: allUserTasks,
    selectedStakeholder,
    hideBillStakeholder,
    activeDashboardFilters,
    projectAnalysis,
  }), [projects, allUserTasks, selectedStakeholder, hideBillStakeholder, activeDashboardFilters, projectAnalysis]);

  const handleProjectDataChange = useCallback((itemId, changedData, itemType = 'project', details) => {
    if (itemType === 'task_added') {
      const newTask = details?.task || changedData;
      if (!newTask?.id || !newTask.project_id) {
        fetchData();
        return;
      }

      const relatedProject = details?.project || newTask.projects;
      const projectId = newTask.project_id;
      const nowIso = new Date().toISOString();

      setAllUserTasks(prevTasks => {
        const withoutTask = prevTasks.filter(t => t.id !== newTask.id);
        return [newTask, ...withoutTask].sort(sortTasksByDateDescThenPriority);
      });

      setTasksByProject(prev => {
        const next = { ...prev };
        const existingList = next[projectId] || [];
        const filtered = existingList.filter(t => t.id !== newTask.id);
        next[projectId] = sortTasksForProjectCard([newTask, ...filtered]);
        return next;
      });

      let shouldRefetchProjects = false;
      setProjects(prevProjects => {
        const projectExists = prevProjects.some(p => p.id === projectId);
        if (!projectExists) {
          if (relatedProject?.id) {
            const newProjectEntry = {
              ...relatedProject,
              updated_at: nowIso,
              status: relatedProject.status || 'Open',
              priority: relatedProject.priority || 'Medium',
              stakeholders: relatedProject.stakeholders || [],
            };
            const updatedList = [newProjectEntry, ...prevProjects];
            return updatedList.sort((a, b) => {
              const aIsUnassigned = a.name?.toLowerCase() === 'unassigned';
              const bIsUnassigned = b.name?.toLowerCase() === 'unassigned';
              if (aIsUnassigned && !bIsUnassigned) return -1;
              if (!aIsUnassigned && bIsUnassigned) return 1;
              return sortProjectsByPriorityThenDateDesc(a, b);
            });
          }
          shouldRefetchProjects = true;
          return prevProjects;
        }

        const updatedProjects = prevProjects.map(p => p.id === projectId ? { ...p, updated_at: nowIso } : p);
        return updatedProjects.sort((a, b) => {
          const aIsUnassigned = a.name?.toLowerCase() === 'unassigned';
          const bIsUnassigned = b.name?.toLowerCase() === 'unassigned';
          if (aIsUnassigned && !bIsUnassigned) return -1;
          if (!aIsUnassigned && bIsUnassigned) return 1;
          return sortProjectsByPriorityThenDateDesc(a, b);
        });
      });

      if (shouldRefetchProjects) {
        fetchData();
      }
    } else if (itemType === 'task_updated') {
      const updatedTask = changedData;
      if (!updatedTask?.id || !updatedTask.project_id) {
        fetchData();
        return;
      }

      const relatedProject = details?.project || updatedTask.projects;
      const previousProjectIdFromDetails = details?.previousProjectId;
      const nowIso = new Date().toISOString();

      setAllUserTasks(prevTasks => prevTasks
        .map(t => t.id === updatedTask.id ? updatedTask : t)
        .sort(sortTasksByDateDescThenPriority));

      setTasksByProject(prev => {
        const next = { ...prev };
        let previousProjectId = previousProjectIdFromDetails;

        if (!previousProjectId) {
          previousProjectId = Object.keys(prev).find(projectId =>
            (prev[projectId] || []).some(t => t.id === updatedTask.id)
          );
        }

        if (previousProjectId && previousProjectId !== updatedTask.project_id) {
          next[previousProjectId] = (next[previousProjectId] || []).filter(t => t.id !== updatedTask.id);
        }

        const existingList = next[updatedTask.project_id] || [];
        const filtered = existingList.filter(t => t.id !== updatedTask.id);
        next[updatedTask.project_id] = sortTasksForProjectCard([...filtered, updatedTask]);
        return next;
      });

      let shouldRefetchProjects = false;
      setProjects(prevProjects => {
        let nextProjects = prevProjects;
        const projectExists = prevProjects.some(p => p.id === updatedTask.project_id);

        if (!projectExists) {
          if (relatedProject?.id) {
            const newProjectEntry = {
              ...relatedProject,
              updated_at: nowIso,
              status: relatedProject.status || 'Open',
              priority: relatedProject.priority || 'Medium',
              stakeholders: relatedProject.stakeholders || [],
            };
            const updatedList = [newProjectEntry, ...prevProjects];
            nextProjects = updatedList.sort((a, b) => {
              const aIsUnassigned = a.name?.toLowerCase() === 'unassigned';
              const bIsUnassigned = b.name?.toLowerCase() === 'unassigned';
              if (aIsUnassigned && !bIsUnassigned) return -1;
              if (!aIsUnassigned && bIsUnassigned) return 1;
              return sortProjectsByPriorityThenDateDesc(a, b);
            });
          } else {
            shouldRefetchProjects = true;
            nextProjects = prevProjects;
          }
        } else {
          nextProjects = prevProjects.map(p =>
            p.id === updatedTask.project_id ? { ...p, updated_at: nowIso } : p
          ).sort((a, b) => {
            const aIsUnassigned = a.name?.toLowerCase() === 'unassigned';
            const bIsUnassigned = b.name?.toLowerCase() === 'unassigned';
            if (aIsUnassigned && !bIsUnassigned) return -1;
            if (!aIsUnassigned && bIsUnassigned) return 1;
            return sortProjectsByPriorityThenDateDesc(a, b);
          });
        }

        if (previousProjectIdFromDetails && previousProjectIdFromDetails !== updatedTask.project_id) {
          nextProjects = nextProjects.map(p =>
            p.id === previousProjectIdFromDetails ? { ...p, updated_at: nowIso } : p
          ).sort((a, b) => {
            const aIsUnassigned = a.name?.toLowerCase() === 'unassigned';
            const bIsUnassigned = b.name?.toLowerCase() === 'unassigned';
            if (aIsUnassigned && !bIsUnassigned) return -1;
            if (!aIsUnassigned && bIsUnassigned) return 1;
            return sortProjectsByPriorityThenDateDesc(a, b);
          });
        }

        return nextProjects;
      });

      if (shouldRefetchProjects) {
        fetchData();
      }
    } else if (itemType === 'project_status_changed' || itemType === 'project_details_changed') {
      const updatedProjectPartial = changedData;
      setProjects(prevProjects =>
        prevProjects
          .map(p => p.id === itemId ? { ...p, ...updatedProjectPartial, updated_at: new Date().toISOString() } : p)
          .filter(p => showCompletedProjects || (p.status !== 'Completed' && p.status !== 'Cancelled'))
          .sort((a, b) => {
            const aIsUnassigned = a.name?.toLowerCase() === 'unassigned';
            const bIsUnassigned = b.name?.toLowerCase() === 'unassigned';
            if (aIsUnassigned && !bIsUnassigned) return -1;
            if (!aIsUnassigned && bIsUnassigned) return 1;
            return sortProjectsByPriorityThenDateDesc(a, b);
          })
      );
    } else {
      fetchData();
    }
  }, [showCompletedProjects, fetchData]);

  const handleProjectDeleted = useCallback((deletedProjectId) => {
    setProjects(prevProjects => prevProjects
      .filter(p => p.id !== deletedProjectId)
      .sort((a, b) => {
        const aIsUnassigned = a.name?.toLowerCase() === 'unassigned';
        const bIsUnassigned = b.name?.toLowerCase() === 'unassigned';
        if (aIsUnassigned && !bIsUnassigned) return -1;
        if (!aIsUnassigned && bIsUnassigned) return 1;
        return sortProjectsByPriorityThenDateDesc(a, b);
      })
    );
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
  const handleToggleCompletedProjects = useCallback(() => setShowCompletedProjects(prev => !prev), []);
  const handleToggleHideBill = useCallback(() => setHideBillStakeholder(prev => !prev), []);
  const handleResetFilters = useCallback(() => {
    setSelectedStakeholder('All Stakeholders');
    setActiveDashboardFilters(createDefaultDashboardFilters());
    setHideBillStakeholder(false);
    setSearchTerm('');
  }, []);
  const handleSignOut = useCallback(async () => {
    try {
      await signOut({ callbackUrl: '/login' });
    } catch (error) {
      console.error('Error signing out:', error);
    }
  }, []);

  // Memoize task update handler
  const handleTaskUpdate = useCallback((updatedTask) => {
    handleProjectDataChange(updatedTask.id, updatedTask, 'task_updated');
  }, [handleProjectDataChange]);

  const handleTaskDragStateChange = useCallback((isDragging, sourceProjectId = null) => {
    if (isDragging) {
      setTaskDragState({ active: true, sourceProjectId: sourceProjectId || null });
    } else {
      setTaskDragState({ active: false, sourceProjectId: null });
    }
  }, []);

  const isTaskDragActive = taskDragState.active;
  const dragSourceProjectId = taskDragState.sourceProjectId;

  // Memoize project update handler
  const handleProjectUpdate = useCallback((updatedProject) => {
    setProjects(prevProjects =>
      prevProjects
        .map(p => p.id === updatedProject.id ? updatedProject : p)
        .sort((a, b) => {
          const aIsUnassigned = a.name?.toLowerCase() === 'unassigned';
          const bIsUnassigned = b.name?.toLowerCase() === 'unassigned';
          if (aIsUnassigned && !bIsUnassigned) return -1;
          if (!aIsUnassigned && bIsUnassigned) return 1;
          return sortProjectsByPriorityThenDateDesc(a, b);
        })
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
    handleProjectDataChange(createdTask.id, createdTask, 'task_added', {
      task: createdTask,
      project: createdTask.projects
    });
    return createdTask;
  }, [userId, handleProjectDataChange]);

  const handleProjectAdded = useCallback((newProject) => {
    if (!newProject?.id) {
      fetchData();
      return;
    }

    const normalizedProject = {
      ...newProject,
      stakeholders: Array.isArray(newProject.stakeholders) ? newProject.stakeholders : [],
      priority: newProject.priority || 'Medium',
      status: newProject.status || 'Open',
      updated_at: newProject.updated_at || new Date().toISOString(),
    };

    setProjects(prevProjects => {
      const withoutDuplicate = prevProjects.filter(p => p.id !== normalizedProject.id);
      const updatedList = [...withoutDuplicate, normalizedProject]
        .filter(p => showCompletedProjects || (p.status !== 'Completed' && p.status !== 'Cancelled'))
        .sort((a, b) => {
          const aIsUnassigned = a.name?.toLowerCase() === 'unassigned';
          const bIsUnassigned = b.name?.toLowerCase() === 'unassigned';
          if (aIsUnassigned && !bIsUnassigned) return -1;
          if (!aIsUnassigned && bIsUnassigned) return 1;
          return sortProjectsByPriorityThenDateDesc(a, b);
        });
      return updatedList;
    });

    setTasksByProject(prev => ({
      ...prev,
      [normalizedProject.id]: prev?.[normalizedProject.id] || [],
    }));

    fetchData();
  }, [fetchData, showCompletedProjects]);

  // Memoize active filter check
  const hasActiveFilters = useMemo(() => {
    return selectedStakeholder !== 'All Stakeholders' ||
      activeDashboardFilters.overdue ||
      activeDashboardFilters.noTasks ||
      activeDashboardFilters.untouched ||
      activeDashboardFilters.noDueDate ||
      hideBillStakeholder ||
      searchTerm.trim().length > 0;
  }, [selectedStakeholder, activeDashboardFilters, hideBillStakeholder, searchTerm]);

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
      filters.push({ id: 'gmi-only', label: 'GMI tasks only' });
    }
    Object.entries(activeDashboardFilters).forEach(([key, value]) => {
      if (value) {
        filters.push({ id: `focus:${key}`, label: DASHBOARD_FILTER_LABELS[key] || key });
      }
    });
    if (searchTerm) {
      filters.push({ id: 'search', label: `Search: "${searchTerm}"` });
    }
    return filters;
  }, [selectedStakeholder, hideBillStakeholder, activeDashboardFilters, searchTerm]);
  const workspaceSubtitle = useMemo(() => {
    if (hasActiveFilters) {
      return 'Filter stack engaged — review the prioritized view and clear filters when finished.';
    }
    return 'Welcome back. Everything is synced to live data; scan metrics below to spot emerging bottlenecks.';
  }, [hasActiveFilters]);
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
      <AddProjectModal
        isOpen={isAddProjectModalOpen}
        onClose={() => setIsAddProjectModalOpen(false)}
        onProjectAdded={handleProjectAdded}
      />
      <AppShell
        user={user}
        title="Planner Command Center"
        subtitle={workspaceSubtitle}
        actions={[
          {
            key: 'new-project',
            label: 'New Project',
            icon: PlusCircleIcon,
            onClick: () => setIsAddProjectModalOpen(true),
          },
        ]}
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
            tasks={filteredTasksForDashboard}
            projects={baseFilteredProjects}
            onTaskUpdate={handleTaskUpdate}
            hideBillStakeholder={hideBillStakeholder}
            onQuickAdd={handleQuickTaskAdd}
            onTaskDragStateChange={handleTaskDragStateChange}
          />
        }
      >
        <div className="hidden md:flex md:flex-col md:gap-8">
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

          <section className="card-surface overflow-hidden border border-[#0496c7]/20 bg-white/90 text-[#052a3b] shadow-[0_28px_60px_-32px_rgba(4,150,199,0.35)]">
            <div className="border-b border-[#0496c7]/20 bg-white p-4 sm:p-6">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-[#036586]/80">Projects</p>
                    <h2 className="mt-2 text-2xl font-semibold text-[#052a3b]">{projectSectionTitle}</h2>
                    <p className="mt-2 text-sm text-[#2f617a]">
                      {hasActiveFilters
                        ? `Showing ${searchedProjects.length} project${searchedProjects.length === 1 ? '' : 's'} that match your current filters.`
                        : `Monitoring ${searchedProjects.length} project${searchedProjects.length === 1 ? '' : 's'} in flight.`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="rounded-full border border-[#0496c7]/30 bg-[#0496c7]/12 px-4 py-2 text-xs font-semibold tracking-wide text-[#036586]">
                      {searchedProjects.length} showing
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

                {/* Search Input */}
                <div className="relative mt-2">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <MagnifyingGlassIcon className="h-5 w-5 text-[#036586]/50" aria-hidden="true" />
                  </div>
                  <input
                    type="text"
                    name="search"
                    id="search"
                    className="block w-full rounded-xl border border-[#0496c7]/20 bg-white/50 py-2.5 pl-10 pr-3 text-sm text-[#052a3b] placeholder-[#2f617a]/50 shadow-inner shadow-[#0496c7]/5 focus:border-[#0496c7]/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0496c7]/20 sm:text-sm"
                    placeholder="Type to filter projects by name, task, or note..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="bg-white p-4 sm:p-6">
              {isLoadingData ? (
                <ProjectListSkeleton />
              ) : searchedProjects.length > 0 ? (
                <ProjectList
                  projects={searchedProjects}
                  tasksByProject={tasksByProject}
                  notesByTask={notesByTask}
                  projectNotes={projectNotes}
                  onProjectDataChange={handleProjectDataChange}
                  onProjectDeleted={handleProjectDeleted}
                  onProjectUpdated={handleProjectUpdate}
                  areAllTasksExpanded={areAllTasksExpanded}
                  isTaskDragActive={isTaskDragActive}
                  dragSourceProjectId={dragSourceProjectId}
                  onTaskDragStateChange={handleTaskDragStateChange}
                />
              ) : hasActiveFilters ? (
                <EmptyFilteredResults />
              ) : (
                <EmptyProjects onCreateProject={() => setIsAddProjectModalOpen(true)} />
              )}
            </div>
          </section>
        </div>
      </AppShell>

      <div className="px-4 pb-10 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={handleSignOut}
          className="w-full rounded-xl border border-[#0496c7]/25 bg-white/90 px-4 py-3 text-sm font-semibold text-[#036586] shadow-[0_12px_30px_-20px_rgba(4,150,199,0.4)] transition hover:border-[#0496c7]/40 hover:bg-[#0496c7]/12 hover:text-[#0496c7]"
        >
          Sign Out
        </button>
      </div>
    </>
  );
} 
