'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { apiClient } from '@/lib/apiClient';
import ProjectList from '@/components/Projects/ProjectList';
import AddProjectModal from '@/components/Projects/AddProjectModal';
import StandaloneTaskList from '@/components/Tasks/StandaloneTaskList';
import { EyeIcon, EyeSlashIcon, PlusCircleIcon, ExclamationTriangleIcon, InboxIcon, ClockIcon, CalendarDaysIcon, ArrowsPointingOutIcon, ArrowsPointingInIcon } from '@heroicons/react/24/outline';
import { differenceInCalendarDays, isPast, parseISO, subWeeks, compareAsc, compareDesc } from 'date-fns';
import Link from 'next/link';
import { ProjectListSkeleton, TaskListSkeleton } from '@/components/ui/LoadingStates';
import { EmptyProjects, EmptyFilteredResults } from '@/components/ui/EmptyStates';

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

// Extract FilterButton component outside to prevent recreation on every render
const FilterButton = ({ filterKey, icon, label, count, activeDashboardFilters, toggleDashboardFilter }) => {
  const isActive = activeDashboardFilters[filterKey];
  const hasItems = count > 0;
  return (
    <button
      onClick={() => toggleDashboardFilter(filterKey)}
      className={`flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors
        ${isActive ? 'bg-indigo-600 text-white border-indigo-600 ring-2 ring-indigo-300' 
          : hasItems ? 'bg-red-100 text-red-700 border-red-300 hover:bg-red-200' 
          : 'bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200'}
        ${!hasItems && !isActive ? 'opacity-60 cursor-not-allowed' : ''}`}
      disabled={!hasItems && !isActive}
      title={isActive ? `Deactivate '${label}' filter` : `Activate '${label}' filter (${count} items)`}>
      {icon}<span>{label}</span>
      <span className={`px-1.5 py-0.5 rounded-full text-xs ml-1 ${isActive ? 'bg-white text-indigo-600' : hasItems ? 'bg-red-200 text-red-800' : 'bg-gray-200 text-gray-600'}`}>{count}</span>
    </button>
  );
};

export default function DashboardPage() {
  // All hooks must be called at the top level, before any conditional returns.
  const { data: session, status } = useSession();
  const user = session?.user;
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
  const [activeDashboardFilters, setActiveDashboardFilters] = useState({
    overdue: false,
    noTasks: false,
    untouched: false,
    noDueDate: false,
  });
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
    <div className="flex flex-col min-h-screen bg-gray-100">
      {/* Header stays full width */}
      <header className="w-full bg-white shadow-sm sticky top-0 z-20">
        <div className="w-full flex flex-col sm:flex-row justify-between sm:items-center py-3 px-4 border-b border-gray-200">
            <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Dashboard</h1>
                {user && <p className="text-xs sm:text-sm text-gray-600">Welcome, {user.email}!</p>}
            </div>
            <div className="flex items-center space-x-3 mt-3 sm:mt-0">
                <Link
                  href="/completed-report"
                  className="flex items-center px-3 py-2 bg-green-500 text-white text-xs sm:text-sm font-medium rounded-md hover:bg-green-600 transition-colors shadow-sm">
                  <CalendarDaysIcon className="h-4 w-4 sm:h-5 sm:w-5 mr-1.5" />
                  Completed Report
                </Link>
                <button 
                    onClick={handleShowAddProjectModal}
                    className="flex items-center px-3 py-2 bg-indigo-600 text-white text-xs sm:text-sm font-medium rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 shadow-sm">
                    <PlusCircleIcon className="h-4 w-4 sm:h-5 sm:w-5 mr-1.5" />
                    New Project
                </button>
                {user && (
                <button
                    onClick={handleSignOut}
                    className="px-3 py-2 bg-red-500 text-white text-xs sm:text-sm font-medium rounded-md hover:bg-red-600 transition-colors shadow-sm">
                    Sign Out
                </button>
                )}
            </div>
        </div>
      </header>
      
      {/* Main content area with two columns */}
      <div className="flex-grow w-full py-6 px-4">
        <div className="lg:flex lg:gap-6">
          {/* Left column: Filters and Project List */}
          <div className="lg:w-2/3 mb-6 lg:mb-0 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
            <section className="bg-white p-4 rounded-lg shadow mb-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 items-end">
                <div>
                  <label htmlFor="stakeholder-filter" className="block text-sm font-medium text-gray-700 mb-1">Filter by Stakeholder:</label>
                  <select 
                    id="stakeholder-filter" 
                    name="stakeholder-filter"
                    className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md shadow-sm"
                    value={selectedStakeholder}
                    onChange={handleStakeholderChange}>
                    <option value="All Stakeholders">All Stakeholders</option>
                    {uniqueStakeholders.map(stakeholder => (
                      <option key={stakeholder} value={stakeholder}>{stakeholder}</option>
                    ))}
                  </select>
                </div>
                
                <div className="flex md:justify-start items-center pt-5 space-x-3">
                    <button
                        onClick={handleToggleCompletedProjects}
                        className="flex items-center text-sm text-gray-600 hover:text-indigo-600 p-2 rounded-md hover:bg-gray-100"
                        title={showCompletedProjects ? "Hide completed/cancelled projects" : "Show completed/cancelled projects"}>
                        {showCompletedProjects ? <EyeSlashIcon className="h-5 w-5 mr-1.5" /> : <EyeIcon className="h-5 w-5 mr-1.5" />}
                        {showCompletedProjects ? 'Hide Completed/Cancelled' : 'Show Completed/Cancelled'}
                    </button>
                    <button
                        onClick={toggleExpandAllTasks}
                        className="flex items-center text-sm text-gray-600 hover:text-indigo-600 p-2 rounded-md hover:bg-gray-100"
                        title={areAllTasksExpanded ? "Collapse all project task lists" : "Expand all project task lists"}>
                        {areAllTasksExpanded ? <ArrowsPointingInIcon className="h-5 w-5 mr-1.5" /> : <ArrowsPointingOutIcon className="h-5 w-5 mr-1.5" />}
                        {areAllTasksExpanded ? 'Collapse All Tasks' : 'Expand All Tasks'}
                    </button>
                    <button
                        onClick={handleToggleHideBill}
                        className={`flex items-center text-sm p-2 rounded-md hover:bg-gray-100 ${hideBillStakeholder ? 'text-red-600 font-semibold' : 'text-gray-600'}`}
                        title={hideBillStakeholder ? "Show projects with Bill as stakeholder" : "Hide projects with Bill as stakeholder"}>
                        <EyeSlashIcon className="h-5 w-5 mr-1.5" />
                        {hideBillStakeholder ? 'Unhide Bill' : 'Hide Bill'}
                    </button>
                </div>
              </div>
              
              <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-200">
                <FilterButton filterKey="overdue" icon={<ExclamationTriangleIcon className="h-4 w-4"/>} label="Overdue" count={projectAnalysis.overdue.length} activeDashboardFilters={activeDashboardFilters} toggleDashboardFilter={toggleDashboardFilter} />
                <FilterButton filterKey="noTasks" icon={<InboxIcon className="h-4 w-4"/>} label="No Tasks" count={projectAnalysis.noTasks.length} activeDashboardFilters={activeDashboardFilters} toggleDashboardFilter={toggleDashboardFilter} />
                <FilterButton filterKey="untouched" icon={<ClockIcon className="h-4 w-4"/>} label="Untouched (2wk)" count={projectAnalysis.untouched.length} activeDashboardFilters={activeDashboardFilters} toggleDashboardFilter={toggleDashboardFilter} />
                <FilterButton filterKey="noDueDate" icon={<CalendarDaysIcon className="h-4 w-4"/>} label="No Due Date" count={projectAnalysis.noDueDate.length} activeDashboardFilters={activeDashboardFilters} toggleDashboardFilter={toggleDashboardFilter} />
              </div>
            </section>

            <section>
                <h2 className="text-xl font-semibold text-gray-700 mb-3">
                {projectSectionTitle}
                <span className="text-base font-normal text-gray-500 ml-2">({baseFilteredProjects.length} showing)</span>
                </h2>
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
                ) : (
                  // Check if filters are active
                  hasActiveFilters ? (
                    <EmptyFilteredResults />
                  ) : (
                    <EmptyProjects />
                  )
                )}
            </section>
          </div>

          {/* Right column: Standalone Task List */}
          <aside className="lg:w-1/3 lg:sticky lg:top-24 h-full lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
            {isLoadingData ? (
                <TaskListSkeleton />
            ) : (
                <StandaloneTaskList 
                    allUserTasks={allUserTasks} 
                    projects={projects} 
                    onTaskUpdateNeeded={handleTaskUpdate}
                    hideBillStakeholder={hideBillStakeholder} 
                />
            )}
          </aside>
        </div>
      </div>
      {showAddProjectModal && (
        <AddProjectModal 
          isOpen={showAddProjectModal}
          onClose={handleHideAddProjectModal} 
          onProjectAdded={handleProjectAdded}
        />
      )}
    </div>
  );
} 