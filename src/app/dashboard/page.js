'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import ProjectList from '@/components/Projects/ProjectList';
import AddProjectModal from '@/components/Projects/AddProjectModal';
import StandaloneTaskList from '@/components/Tasks/StandaloneTaskList';
import { EyeIcon, EyeSlashIcon, PlusCircleIcon, ExclamationTriangleIcon, InboxIcon, ClockIcon, CalendarDaysIcon, ArrowsPointingOutIcon, ArrowsPointingInIcon } from '@heroicons/react/24/outline';
import { differenceInCalendarDays, isPast, parseISO, subWeeks, compareAsc } from 'date-fns';

export default function DashboardPage() {
  const { user, session, loading, signOut } = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState([]);
  const [allUserTasks, setAllUserTasks] = useState([]);
  const [isLoadingData, setIsLoadingData] = useState(true); // Combined loading state
  const [showCompletedProjects, setShowCompletedProjects] = useState(false);
  const [areAllTasksExpanded, setAreAllTasksExpanded] = useState(true); // New state for expand/collapse all
  const [showAddProjectModal, setShowAddProjectModal] = useState(false);
  const [selectedStakeholder, setSelectedStakeholder] = useState('All Stakeholders');
  
  const [activeDashboardFilters, setActiveDashboardFilters] = useState({
    overdue: false,
    noTasks: false,
    untouched: false,
    noDueDate: false,
  });

  const getPriorityValue = (priority) => {
    switch (priority) {
      case 'High': return 1;
      case 'Medium': return 2;
      case 'Low': return 3;
      default: return 4; // Other/undefined priorities last
    }
  };

  useEffect(() => {
    if (!loading && (!user || !session)) {
      router.replace('/login');
    }
  }, [user, session, loading, router]);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setIsLoadingData(true);
    try {
      // Fetch projects
      let projectQueryBase = supabase
        .from('projects')
        .select('*')
        .eq('user_id', user.id);

      let finalProjectQuery;
      if (showCompletedProjects) {
        // Fetch all projects (Completed, Cancelled, and others)
        finalProjectQuery = projectQueryBase;
      } else {
        // Fetch only projects that are NOT Completed and NOT Cancelled
        finalProjectQuery = projectQueryBase
          .neq('status', 'Completed')
          .neq('status', 'Cancelled');
      }

      // Apply ordering to the determined query
      finalProjectQuery = finalProjectQuery.order('due_date', { ascending: true, nullsFirst: false });

      const { data: projectData, error: projectError } = await finalProjectQuery;
      if (projectError) throw projectError;

      // Client-side sort for secondary priority sorting if due dates are the same
      const finalSortedProjects = (projectData || []).sort((a, b) => {
        const dateA = a.due_date ? parseISO(a.due_date) : null;
        const dateB = b.due_date ? parseISO(b.due_date) : null;
        
        // Handle cases where one due date is null and the other isn't (respecting nullsFirst: false logic from DB)
        if (dateA === null && dateB !== null) return 1; // a (null) comes after b (not null)
        if (dateA !== null && dateB === null) return -1; // a (not null) comes before b (null)

        // If both are null or both are not null and dates are different, use compareAsc
        if (dateA && dateB && dateA.getTime() !== dateB.getTime()) {
          // This should ideally be covered by DB sort, but as a fallback or for exact same date values
          // This part might be redundant if DB sort is perfect for due_date including time.
          // Let's assume due_date is just a date, so different dates are handled by DB.
        }

        // If due dates are effectively the same (both null or same date value), then sort by priority
        const priorityA = getPriorityValue(a.priority);
        const priorityB = getPriorityValue(b.priority);
        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }
        return 0; // Keep original order if due dates and priorities are identical
      });
      setProjects(finalSortedProjects);

      // Fetch all user tasks
      const { data: taskData, error: taskError } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', user.id);
      if (taskError) throw taskError;
      setAllUserTasks(taskData || []);

    } catch (error) {
      console.error('Error fetching data:', error);
      setProjects([]);
      setAllUserTasks([]);
    } finally {
      setIsLoadingData(false);
    }
  }, [user, showCompletedProjects]); // showCompletedProjects is a dependency for re-fetching

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user, fetchData]); // fetchData includes showCompletedProjects, so it's covered

  const twoWeeksAgo = useMemo(() => subWeeks(new Date(), 2), []);

  const projectAnalysis = useMemo(() => {
    const overdue = [];
    const noTasks = [];
    const untouched = [];
    const noDueDate = [];

    projects.forEach(p => {
      // Overdue check
      if (p.due_date && isPast(parseISO(p.due_date)) && p.status !== 'Completed' && p.status !== 'Cancelled') {
        overdue.push(p.id);
      }

      const tasksForProject = allUserTasks.filter(t => t.project_id === p.id);
      // No tasks check
      if (tasksForProject.length === 0) {
        noTasks.push(p.id);
      }

      // Untouched check
      const projectLastUpdated = parseISO(p.updated_at);
      let projectIsUntouched = projectLastUpdated < twoWeeksAgo;
      if (projectIsUntouched && tasksForProject.length > 0) {
        const anyRecentTask = tasksForProject.some(t => parseISO(t.updated_at) >= twoWeeksAgo);
        if (anyRecentTask) {
          projectIsUntouched = false; 
        }
      }
      if (projectIsUntouched) {
        untouched.push(p.id);
      }

      // No Due Date check (project itself OR any of its tasks)
      let projectOrTaskHasNoDueDate = !p.due_date;
      if (!projectOrTaskHasNoDueDate) { // If project has a due date, check tasks
        if (tasksForProject.some(t => !t.due_date)) {
          projectOrTaskHasNoDueDate = true;
        }
      }
      if (projectOrTaskHasNoDueDate) {
        noDueDate.push(p.id);
      }
    });
    return { overdue, noTasks, untouched, noDueDate };
  }, [projects, allUserTasks, twoWeeksAgo]);

  const baseFilteredProjects = useMemo(() => {
    let tempProjects = [...projects];
    if (selectedStakeholder !== 'All Stakeholders') {
      tempProjects = tempProjects.filter(p => p.stakeholders && p.stakeholders.includes(selectedStakeholder));
    }
    if (activeDashboardFilters.overdue) {
      tempProjects = tempProjects.filter(p => projectAnalysis.overdue.includes(p.id));
    }
    if (activeDashboardFilters.noTasks) {
      tempProjects = tempProjects.filter(p => projectAnalysis.noTasks.includes(p.id));
    }
    if (activeDashboardFilters.untouched) {
      tempProjects = tempProjects.filter(p => projectAnalysis.untouched.includes(p.id));
    }
    if (activeDashboardFilters.noDueDate) {
      tempProjects = tempProjects.filter(p => projectAnalysis.noDueDate.includes(p.id));
    }
    return tempProjects;
  }, [projects, selectedStakeholder, activeDashboardFilters, projectAnalysis]);

  if (loading || isLoadingData) { // Use combined loading state
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-24">
        <p>Loading dashboard...</p>
      </div>
    );
  }
  
  const handleProjectDataChanged = () => { // Renamed from handleProjectAdded for generic refresh
    fetchData();
  };

  const toggleExpandAllTasks = () => {
    setAreAllTasksExpanded(prev => !prev);
  };

  const uniqueStakeholders = Array.from(
    new Set(projects.flatMap(p => p.stakeholders || []).filter(sh => sh && sh.trim() !== ''))
  ).sort();

  const toggleDashboardFilter = (filterName) => {
    setActiveDashboardFilters(prev => ({ ...prev, [filterName]: !prev[filterName] }));
  };
  
  const FilterButton = ({ filterKey, icon, label, count }) => {
    const isActive = activeDashboardFilters[filterKey];
    const hasItems = count > 0;
    return (
      <button
        onClick={() => toggleDashboardFilter(filterKey)}
        className={`flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors
          ${isActive 
            ? 'bg-indigo-600 text-white border-indigo-600 ring-2 ring-indigo-300' 
            : hasItems 
              ? 'bg-red-100 text-red-700 border-red-300 hover:bg-red-200' 
              : 'bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200'
          }
          ${!hasItems && !isActive ? 'opacity-60 cursor-not-allowed' : ''}
        `}
        disabled={!hasItems && !isActive}
        title={isActive ? `Deactivate '${label}' filter` : `Activate '${label}' filter (${count} items)`}
      >
        {icon}
        <span>{label}</span>
        <span className={`px-1.5 py-0.5 rounded-full text-xs ml-1 ${isActive ? 'bg-white text-indigo-600' : hasItems ? 'bg-red-200 text-red-800' : 'bg-gray-200 text-gray-600'}`}>{count}</span>
      </button>
    );
  };

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
                <button 
                    onClick={() => setShowAddProjectModal(true)}
                    className="flex items-center px-3 py-2 bg-indigo-600 text-white text-xs sm:text-sm font-medium rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 shadow-sm"
                >
                    <PlusCircleIcon className="h-4 w-4 sm:h-5 sm:w-5 mr-1.5" />
                    New Project
                </button>
                {user && (
                <button
                    onClick={async () => {
                    await signOut();
                    router.push('/login');
                    }}
                    className="px-3 py-2 bg-red-500 text-white text-xs sm:text-sm font-medium rounded-md hover:bg-red-600 transition-colors shadow-sm"
                >
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
                    onChange={(e) => setSelectedStakeholder(e.target.value)}
                  >
                    <option value="All Stakeholders">All Stakeholders</option>
                    {uniqueStakeholders.map(stakeholder => (
                      <option key={stakeholder} value={stakeholder}>{stakeholder}</option>
                    ))}
                  </select>
                </div>
                
                <div className="flex md:justify-start items-center pt-5 space-x-3">
                    <button
                        onClick={() => { setShowCompletedProjects(prev => !prev); }}
                        className="flex items-center text-sm text-gray-600 hover:text-indigo-600 p-2 rounded-md hover:bg-gray-100"
                        title={showCompletedProjects ? "Hide completed/cancelled projects" : "Show completed/cancelled projects"}
                    >
                        {showCompletedProjects ? <EyeSlashIcon className="h-5 w-5 mr-1.5" /> : <EyeIcon className="h-5 w-5 mr-1.5" />}
                        {showCompletedProjects ? 'Hide Completed/Cancelled' : 'Show Completed/Cancelled'}
                    </button>
                    <button
                        onClick={toggleExpandAllTasks}
                        className="flex items-center text-sm text-gray-600 hover:text-indigo-600 p-2 rounded-md hover:bg-gray-100"
                        title={areAllTasksExpanded ? "Collapse all project task lists" : "Expand all project task lists"}
                    >
                        {areAllTasksExpanded ? <ArrowsPointingInIcon className="h-5 w-5 mr-1.5" /> : <ArrowsPointingOutIcon className="h-5 w-5 mr-1.5" />}
                        {areAllTasksExpanded ? 'Collapse All Tasks' : 'Expand All Tasks'}
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
                  onProjectDataChange={handleProjectDataChanged} 
                  onProjectDeleted={handleProjectDataChanged} 
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
                    onTaskUpdateNeeded={handleProjectDataChanged} 
                />
            )}
          </aside>
        </div>
      </div>

      {showAddProjectModal && (
        <AddProjectModal 
          isOpen={showAddProjectModal}
          onClose={() => setShowAddProjectModal(false)} 
          onProjectAdded={handleProjectDataChanged}
        />
      )}
    </div>
  );
} 