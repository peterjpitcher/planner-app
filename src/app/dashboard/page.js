'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import ProjectList from '@/components/Projects/ProjectList';
import AddProjectModal from '@/components/Projects/AddProjectModal';
import StandaloneTaskList from '@/components/Tasks/StandaloneTaskList';
import { EyeIcon, EyeSlashIcon, PlusCircleIcon, ExclamationTriangleIcon, InboxIcon, ClockIcon, CalendarDaysIcon, ArrowsPointingOutIcon, ArrowsPointingInIcon } from '@heroicons/react/24/outline';
import { differenceInCalendarDays, isPast, parseISO, subWeeks, compareAsc, compareDesc } from 'date-fns';
import Link from 'next/link';

export default function DashboardPage() {
  // All hooks must be called at the top level, before any conditional returns.
  const { user, session, loading, signOut } = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState([]);
  const [allUserTasks, setAllUserTasks] = useState([]);
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

  const getPriorityValue = useCallback((priority) => {
    switch (priority) {
      case 'High': return 3;
      case 'Medium': return 2;
      case 'Low': return 1;
      default: return 0; // No priority or undefined
    }
  }, []);

  const sortByDateAndPriority = useCallback((a, b) => {
    const dateA = a.due_date ? parseISO(a.due_date) : null;
    const dateB = b.due_date ? parseISO(b.due_date) : null;

    // Handle null dates: nulls should come last
    if (dateA === null && dateB !== null) return 1;
    if (dateA !== null && dateB === null) return -1;
    if (dateA !== null && dateB !== null) {
      const dateComparison = compareAsc(dateA, dateB);
      if (dateComparison !== 0) return dateComparison;
    }
    // If dates are the same or both are null, sort by priority (descending)
    return getPriorityValue(b.priority) - getPriorityValue(a.priority);
  }, [getPriorityValue]);

  // New sorting function for Projects: Priority (High-Low), then Due Date (Desc)
  const sortProjectsByPriorityThenDateDesc = useCallback((a, b) => {
    // Primary sort: Priority (High to Low)
    const priorityComparison = getPriorityValue(b.priority) - getPriorityValue(a.priority);
    if (priorityComparison !== 0) return priorityComparison;

    // Secondary sort: Due Date (Descending - recent first)
    const dateA = a.due_date ? parseISO(a.due_date) : null;
    const dateB = b.due_date ? parseISO(b.due_date) : null;

    if (dateA === null && dateB === null) return 0; // Both null, treat as equal for date
    if (dateA === null) return 1; // Null dates come after non-null dates
    if (dateB === null) return -1; // Non-null dates come before null dates

    return compareDesc(dateA, dateB); // Descending date order
  }, [getPriorityValue]);

  // New sorting function for Tasks: Due Date (Desc), then Priority (High-Low)
  const sortTasksByDateDescThenPriority = useCallback((a, b) => {
    // Primary sort: Due Date (Descending - recent first)
    const dateA = a.due_date ? parseISO(a.due_date) : null;
    const dateB = b.due_date ? parseISO(b.due_date) : null;

    if (dateA === null && dateB === null) {
      // If both dates are null, sort by priority
      return getPriorityValue(b.priority) - getPriorityValue(a.priority);
    }
    if (dateA === null) return 1; // Null dates come after non-null dates
    if (dateB === null) return -1; // Non-null dates come before null dates

    const dateComparison = compareDesc(dateA, dateB);
    if (dateComparison !== 0) return dateComparison;

    // Secondary sort: Priority (High to Low)
    return getPriorityValue(b.priority) - getPriorityValue(a.priority);
  }, [getPriorityValue]);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setIsLoadingData(true);
    try {
      let projectQueryBase = supabase.from('projects').select('*').eq('user_id', user.id);
      let finalProjectQuery = showCompletedProjects 
        ? projectQueryBase 
        : projectQueryBase.neq('status', 'Completed').neq('status', 'Cancelled');
      
      const { data: projectData, error: projectError } = await finalProjectQuery;
      if (projectError) throw projectError;

      const finalSortedProjects = (projectData || []).sort(sortProjectsByPriorityThenDateDesc);
      setProjects(finalSortedProjects);

      const { data: taskData, error: taskError } = await supabase.from('tasks').select('*').eq('user_id', user.id).eq('is_completed', false);
      if (taskError) throw taskError;
      const sortedTasks = (taskData || []).sort(sortTasksByDateDescThenPriority);
      setAllUserTasks(sortedTasks);
    } catch (error) {
      console.error('Error fetching data:', error);
      setProjects([]);
      setAllUserTasks([]);
    } finally {
      setIsLoadingData(false);
    }
  }, [user, showCompletedProjects, sortProjectsByPriorityThenDateDesc, sortTasksByDateDescThenPriority]);

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user, fetchData]);
  
  useEffect(() => {
    if (!loading && (!user || !session)) {
      router.replace('/login');
    }
  }, [user, session, loading, router]);

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
      console.error('Attempted to add invalid project', newProject);
      fetchData(); 
      return;
    }
    setProjects(prevProjects => {
      const updated = [newProject, ...prevProjects];
      return updated.sort(sortProjectsByPriorityThenDateDesc);
    });
    setShowAddProjectModal(false);
  }, [fetchData, sortProjectsByPriorityThenDateDesc]);
  
  const handleGenericDataRefreshNeeded = useCallback(() => {
    fetchData();
  }, [fetchData]);

  const handleProjectDataChange = useCallback((itemId, changedData, itemType = 'project', details) => {
    if (itemType === 'task_added') {
      const newTask = details?.task;
      console.log('[DashboardPage] newTask in handleProjectDataChange:', newTask);
      if (!newTask || !newTask.id) { 
        console.error('Task added event received without valid task data. Full details:', details, 'Item ID:', itemId, 'Changed Data:', changedData);
        fetchData(); 
        return;
      }
      setAllUserTasks(prevTasks => [newTask, ...prevTasks].sort(sortTasksByDateDescThenPriority));
      setProjects(prevProjects => 
        prevProjects.map(p => p.id === newTask.project_id ? { ...p, updated_at: new Date().toISOString() } : p).sort(sortProjectsByPriorityThenDateDesc)
      );
    } else if (itemType === 'task_updated') {
      const updatedTask = changedData;
      setAllUserTasks(prevTasks => prevTasks.map(t => t.id === updatedTask.id ? updatedTask : t).sort(sortTasksByDateDescThenPriority));
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
  }, [showCompletedProjects, fetchData, sortProjectsByPriorityThenDateDesc, sortTasksByDateDescThenPriority]);

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
  
  // Conditional return must be AFTER all hook definitions
  if (loading || isLoadingData) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-24">
        <p>Loading dashboard...</p>
      </div>
    );
  }
  
  const FilterButton = ({ filterKey, icon, label, count }) => {
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
  }; // FilterButton should also be defined before the main return if it uses hooks, or outside if it doesn't.
     // In this case, it's a simple component not using hooks, so its position is fine here as a helper within DashboardPage.

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
                <Link href="/completed-report" className="flex items-center px-3 py-2 bg-green-500 text-white text-xs sm:text-sm font-medium rounded-md hover:bg-green-600 transition-colors shadow-sm">
                    <CalendarDaysIcon className="h-4 w-4 sm:h-5 sm:w-5 mr-1.5" />
                    Completed Report
                </Link>
                <button 
                    onClick={() => setShowAddProjectModal(true)}
                    className="flex items-center px-3 py-2 bg-indigo-600 text-white text-xs sm:text-sm font-medium rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 shadow-sm">
                    <PlusCircleIcon className="h-4 w-4 sm:h-5 sm:w-5 mr-1.5" />
                    New Project
                </button>
                {user && (
                <button
                    onClick={async () => {
                    await signOut();
                    router.push('/login');
                    }}
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
                    onChange={(e) => setSelectedStakeholder(e.target.value)}>
                    <option value="All Stakeholders">All Stakeholders</option>
                    {uniqueStakeholders.map(stakeholder => (
                      <option key={stakeholder} value={stakeholder}>{stakeholder}</option>
                    ))}
                  </select>
                </div>
                
                <div className="flex md:justify-start items-center pt-5 space-x-3">
                    <button
                        onClick={() => { setShowCompletedProjects(prev => !prev); /* This will trigger re-fetch via fetchData dependency */ }}
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
                        onClick={() => setHideBillStakeholder(prev => !prev)}
                        className={`flex items-center text-sm p-2 rounded-md hover:bg-gray-100 ${hideBillStakeholder ? 'text-red-600 font-semibold' : 'text-gray-600'}`}
                        title={hideBillStakeholder ? "Show projects with Bill as stakeholder" : "Hide projects with Bill as stakeholder"}>
                        <EyeSlashIcon className="h-5 w-5 mr-1.5" />
                        {hideBillStakeholder ? 'Unhide Bill' : 'Hide Bill'}
                    </button>
                </div>
              </div>
              
              <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-200">
                <FilterButton filterKey="overdue" icon={<ExclamationTriangleIcon className="h-4 w-4"/>} label="Overdue" count={projectAnalysis.overdue.length} />
                <FilterButton filterKey="noTasks" icon={<InboxIcon className="h-4 w-4"/>} label="No Tasks" count={projectAnalysis.noTasks.length} />
                <FilterButton filterKey="untouched" icon={<ClockIcon className="h-4 w-4"/>} label="Untouched (2wk)" count={projectAnalysis.untouched.length} />
                <FilterButton filterKey="noDueDate" icon={<CalendarDaysIcon className="h-4 w-4"/>} label="No Due Date" count={projectAnalysis.noDueDate.length} />
              </div>
            </section>

            <section>
                <h2 className="text-xl font-semibold text-gray-700 mb-3">
                { selectedStakeholder !== 'All Stakeholders' || activeDashboardFilters.overdue || activeDashboardFilters.noTasks || activeDashboardFilters.untouched || activeDashboardFilters.noDueDate 
                    ? `Filtered Projects` 
                    : `Your Projects`
                }
                <span className="text-base font-normal text-gray-500 ml-2">({baseFilteredProjects.length} showing)</span>
                </h2>
                {isLoadingData ? (
                <p className="text-center py-10 text-gray-500">Loading projects...</p>
                ) : baseFilteredProjects.length > 0 ? (
                <ProjectList 
                  projects={baseFilteredProjects}
                  onProjectDataChange={handleProjectDataChange} 
                  onProjectDeleted={handleProjectDeleted} 
                  areAllTasksExpanded={areAllTasksExpanded}
                />
                ) : (
                <div className="text-center py-10 bg-white p-6 rounded-lg shadow">
                    <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                    </svg>
                    <h3 className="mt-2 text-sm font-medium text-gray-900">No projects match your filters</h3>
                    <p className="mt-1 text-sm text-gray-500">Try adjusting your filter criteria or add a new project.</p>
                    { (projects.length === 0 && selectedStakeholder === 'All Stakeholders' && !activeDashboardFilters.overdue && !activeDashboardFilters.noTasks && !activeDashboardFilters.untouched && !activeDashboardFilters.noDueDate) &&
                        <p className="mt-1 text-sm text-gray-500">You currently have no projects. Get started by adding one!</p>
                    }
                </div>
                )}
            </section>
          </div>

          {/* Right column: Standalone Task List */}
          <aside className="lg:w-1/3 lg:sticky lg:top-24 h-full lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
            {isLoadingData ? (
                <div className="bg-white shadow rounded-lg p-4 text-center">
                    <p className="text-sm text-gray-500">Loading tasks...</p>
                </div>
            ) : (
                <StandaloneTaskList 
                    allUserTasks={allUserTasks} 
                    projects={projects} 
                    onTaskUpdateNeeded={(updatedTask) => handleProjectDataChange(updatedTask.id, updatedTask, 'task_updated')}
                    hideBillStakeholder={hideBillStakeholder} 
                />
            )}
          </aside>
        </div>
      </div>

      {showAddProjectModal && (
        <AddProjectModal 
          isOpen={showAddProjectModal}
          onClose={() => setShowAddProjectModal(false)} 
          onProjectAdded={handleProjectAdded}
        />
      )}
    </div>
  );
} 