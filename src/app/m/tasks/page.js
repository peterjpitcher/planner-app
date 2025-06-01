'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import MobileLayout from '@/components/Mobile/MobileLayout';
import MobileTaskListItem from '@/components/Mobile/MobileTaskListItem';
import AddTaskModal from '@/components/Tasks/AddTaskModal';
import { parseISO, startOfDay, addDays, endOfWeek, isPast, isSameDay, isWithinInterval, compareAsc } from 'date-fns';
import { FunnelIcon, XMarkIcon, PlusIcon } from '@heroicons/react/20/solid'; // For filter icons

const getPriorityValue = (priority) => {
  switch (priority) {
    case 'High': return 3;
    case 'Medium': return 2;
    case 'Low': return 1;
    default: return 0;
  }
};

const MobileTasksPage = () => {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [error, setError] = useState(null);
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);

  // State for filters
  const [selectedDueDateRange, setSelectedDueDateRange] = useState('All'); // All, Overdue, Today, Tomorrow, ThisWeek
  const [selectedPriority, setSelectedPriority] = useState('All');
  const [showFilters, setShowFilters] = useState(false);

  const dueDateRangeOptions = ['All', 'Overdue', 'Today', 'Tomorrow', 'This Week', 'No Due Date'];
  const priorityOptions = ['All', 'High', 'Medium', 'Low'];

  const fetchTasksAndProjects = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setIsLoadingProjects(true);
    setError(null);
    try {
      const { data: tasksData, error: tasksDbError } = await supabase
        .from('tasks')
        .select('*, projects(id, name)')
        .eq('user_id', user.id)
        .order('due_date', { ascending: true, nullsFirst: true })
        .order('priority', { ascending: false });
      if (tasksDbError) throw tasksDbError;
      setTasks(tasksData || []);

      const { data: projectsData, error: projectsDbError } = await supabase
        .from('projects')
        .select('id, name')
        .eq('user_id', user.id)
        .not('status', 'in', '("Completed", "Cancelled")')
        .order('name', { ascending: true });
      if (projectsDbError) throw projectsDbError;
      setProjects(projectsData || []);

    } catch (e) {
      console.error('Error fetching tasks or projects:', e);
      setError('Failed to load data.');
      setTasks([]);
      setProjects([]);
    } finally {
      setIsLoading(false);
      setIsLoadingProjects(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading && !user) router.push('/login');
    if (user) {
      fetchTasksAndProjects();
    }
  }, [user, authLoading, router, fetchTasksAndProjects]);

  const handleTaskAdded = (newTask) => {
    fetchTasksAndProjects();
    setShowAddTaskModal(false);
  };

  const handleTaskUpdatedFromSwipe = useCallback((updatedTask) => {
    setTasks(currentTasks => currentTasks.map(t => t.id === updatedTask.id ? updatedTask : t));
  }, []);

  const handleTaskDeletedFromSwipe = useCallback((deletedTaskId) => {
    setTasks(currentTasks => currentTasks.filter(t => t.id !== deletedTaskId));
  }, []);

  const filteredAndGroupedTasks = useMemo(() => {
    let processedTasks = tasks.filter(task => !task.is_completed);

    // Apply Priority Filter
    if (selectedPriority !== 'All') {
      processedTasks = processedTasks.filter(task => task.priority === selectedPriority);
    }

    // Apply Due Date Range Filter & Grouping
    const groups = { overdue: [], today: [], tomorrow: [], thisWeek: [], noDueDate: [] };
    const today = startOfDay(new Date());
    const tomorrow = startOfDay(addDays(today, 1));
    const dayAfterTomorrow = startOfDay(addDays(today, 2));
    const endOfThisWeek = endOfWeek(today, { weekStartsOn: 1 });

    processedTasks.forEach(task => {
      if (!task.due_date) {
        if (selectedDueDateRange === 'All' || selectedDueDateRange === 'No Due Date') groups.noDueDate.push(task);
        return;
      }
      let dueDate = typeof task.due_date === 'string' && task.due_date.match(/^\d{4}-\d{2}-\d{2}$/) ? startOfDay(new Date(task.due_date + 'T00:00:00')) : startOfDay(parseISO(task.due_date));
      
      if (isPast(dueDate) && !isSameDay(dueDate, today)) {
        if (selectedDueDateRange === 'All' || selectedDueDateRange === 'Overdue') groups.overdue.push(task);
      } else if (isSameDay(dueDate, today)) {
        if (selectedDueDateRange === 'All' || selectedDueDateRange === 'Today') groups.today.push(task);
      } else if (isSameDay(dueDate, tomorrow)) {
        if (selectedDueDateRange === 'All' || selectedDueDateRange === 'Tomorrow') groups.tomorrow.push(task);
      } else if (isWithinInterval(dueDate, { start: dayAfterTomorrow, end: endOfThisWeek })) {
        if (selectedDueDateRange === 'All' || selectedDueDateRange === 'This Week') groups.thisWeek.push(task);
      }
    });

    // Sort tasks within each group
    for (const groupName in groups) {
      groups[groupName].sort((a, b) => {
        const dateA = a.due_date ? parseISO(a.due_date) : null;
        const dateB = b.due_date ? parseISO(b.due_date) : null;
        if (dateA === null && dateB === null) return getPriorityValue(b.priority) - getPriorityValue(a.priority);
        if (dateA === null) return 1; if (dateB === null) return -1;
        const dateComparison = compareAsc(dateA, dateB);
        if (dateComparison !== 0) return dateComparison;
        return getPriorityValue(b.priority) - getPriorityValue(a.priority);
      });
    }
    return groups;
  }, [tasks, selectedDueDateRange, selectedPriority]);
  
  const groupOrder = ['overdue', 'today', 'tomorrow', 'thisWeek', 'noDueDate'];
  const groupLabels = { overdue: 'Overdue', today: 'Today', tomorrow: 'Tomorrow', thisWeek: 'This Week', noDueDate: 'No Due Date' };

  const clearFilters = () => {
    setSelectedDueDateRange('All');
    setSelectedPriority('All');
  };
  const activeFilterCount = (selectedDueDateRange !== 'All' ? 1 : 0) + (selectedPriority !== 'All' ? 1 : 0);

  if (authLoading || ((isLoading || isLoadingProjects) && tasks.length === 0 && projects.length === 0 && !error)) {
    return <MobileLayout title="My Tasks"><div className="text-center py-10"><p>Loading data...</p></div></MobileLayout>;
  }
  if (error) {
    return <MobileLayout title="Error"><div className="text-center py-10"><p className="text-red-500">{error}</p><button onClick={fetchTasksAndProjects} className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">Try Again</button></div></MobileLayout>;
  }

  const tasksToShowCount = groupOrder.reduce((acc, key) => acc + (filteredAndGroupedTasks[key]?.length || 0), 0);

  return (
    <MobileLayout title="My Tasks">
      <div className="p-2 relative">
        <button onClick={() => setShowFilters(!showFilters)} className="w-full mb-2 flex items-center justify-center px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-indigo-500">
          <FunnelIcon className={`h-4 w-4 mr-1.5 ${activeFilterCount > 0 ? 'text-indigo-600' : 'text-gray-400'}`} />
          Filters {activeFilterCount > 0 ? `(${activeFilterCount} applied)` : ''}
        </button>

        {showFilters && (
          <div className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="dueDateRangeFilter" className="block text-xs font-medium text-gray-600 mb-0.5">Due Date</label>
                <select id="dueDateRangeFilter" value={selectedDueDateRange} onChange={(e) => setSelectedDueDateRange(e.target.value)} className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 py-1.5 px-2">
                  {dueDateRangeOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="priorityFilter" className="block text-xs font-medium text-gray-600 mb-0.5">Priority</label>
                <select id="priorityFilter" value={selectedPriority} onChange={(e) => setSelectedPriority(e.target.value)} className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 py-1.5 px-2">
                  {priorityOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
            </div>
            {activeFilterCount > 0 && (
              <button onClick={clearFilters} className="w-full mt-2 text-xs text-indigo-600 hover:text-indigo-800 flex items-center justify-center py-1">
                <XMarkIcon className="h-3.5 w-3.5 mr-1" /> Clear All Filters
              </button>
            )}
          </div>
        )}
        
        {tasksToShowCount === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500">No tasks match your filters.</p>
            {tasks.length > 0 && activeFilterCount === 0 && !isLoading && <p className="text-sm text-gray-400">All tasks are hidden by current grouping or filters.</p>}
            {!isLoading && tasks.length === 0 && <p className="text-sm text-gray-400">You have no tasks yet.</p> }
          </div>
        ) : (
          <div className="space-y-0">
            {groupOrder.map(groupKey => (
              filteredAndGroupedTasks[groupKey] && filteredAndGroupedTasks[groupKey].length > 0 && (
                <div key={groupKey} className="pt-0">
                  <h4 className="text-xs font-semibold uppercase text-gray-500 px-2 py-2 bg-gray-100 border-t border-b border-gray-200 sticky top-0 z-10">
                    {groupLabels[groupKey]}
                  </h4>
                  <div className="divide-y divide-gray-100 px-1 pt-1">
                    {filteredAndGroupedTasks[groupKey].map(task => (
                      <MobileTaskListItem 
                        key={task.id} 
                        task={task} 
                        projectContext={task.projects}
                        onTaskUpdated={handleTaskUpdatedFromSwipe}
                        onTaskDeleted={handleTaskDeletedFromSwipe}
                      />
                    ))}
                  </div>
                </div>
              )
            ))}
          </div>
        )}
      </div>

      {!isLoadingProjects && (
        <button 
            onClick={() => setShowAddTaskModal(true)} 
            className="fixed bottom-20 right-4 bg-indigo-600 hover:bg-indigo-700 text-white p-3 rounded-full shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 z-20"
            title="Add New Task"
        >
            <PlusIcon className="h-6 w-6" />
        </button>
      )}

      {showAddTaskModal && (
        <AddTaskModal 
            isOpen={showAddTaskModal} 
            onClose={() => setShowAddTaskModal(false)} 
            onTaskAdded={handleTaskAdded}
            projects={projects}
        />
      )}
    </MobileLayout>
  );
};

export default MobileTasksPage; 