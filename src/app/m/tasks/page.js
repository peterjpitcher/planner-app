'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import MobileLayout from '@/components/Mobile/MobileLayout';
import MobileTaskListItem from '@/components/Mobile/MobileTaskListItem';
import { parseISO, startOfDay, addDays, endOfWeek, isPast, isSameDay, isWithinInterval, compareAsc } from 'date-fns';
import { FunnelIcon, XMarkIcon } from '@heroicons/react/20/solid'; // For filter icons

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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // State for filters
  const [selectedDueDateRange, setSelectedDueDateRange] = useState('All'); // All, Overdue, Today, Tomorrow, ThisWeek
  const [selectedPriority, setSelectedPriority] = useState('All');
  const [showFilters, setShowFilters] = useState(false);

  const dueDateRangeOptions = ['All', 'Overdue', 'Today', 'Tomorrow', 'This Week', 'No Due Date'];
  const priorityOptions = ['All', 'High', 'Medium', 'Low'];

  const fetchTasks = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: dbError } = await supabase
        .from('tasks')
        .select('*, projects(id, name)')
        .eq('user_id', user.id)
        // Fetch all tasks, client-side filtering will handle completion status and ranges
        .order('due_date', { ascending: true, nullsFirst: true })
        .order('priority', { ascending: false });
      if (dbError) throw dbError;
      setTasks(data || []);
    } catch (e) {
      console.error('Error fetching tasks:', e);
      setError('Failed to load tasks.');
      setTasks([]);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading && !user) router.push('/login');
    if (user) fetchTasks();
  }, [user, authLoading, router, fetchTasks]);

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
      } else if (selectedDueDateRange === 'All') { // Catch tasks outside these specific ranges if 'All' is selected
        // This logic might need refinement if we want a general 'Future' bucket when 'All' is chosen
        // For now, if 'All' is selected for due date, they are included if they didn't fit above.
        // A better approach might be to simply not group if date filter is 'All' and priority is 'All'
        // or have more explicit groups. For now, this primarily handles specific date filters.
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

  // Loading and Error states (remain the same)
  if (authLoading || (isLoading && tasks.length === 0 && !error)) {
    return <MobileLayout title="My Tasks"><div className="text-center py-10"><p>Loading tasks...</p></div></MobileLayout>;
  }
  if (error) {
    return <MobileLayout title="Error"><div className="text-center py-10"><p className="text-red-500">{error}</p><button onClick={fetchTasks} className="mt-4 btn-primary">Try Again</button></div></MobileLayout>;
  }

  const tasksToShowCount = groupOrder.reduce((acc, key) => acc + (filteredAndGroupedTasks[key]?.length || 0), 0);

  return (
    <MobileLayout title="My Tasks">
      <div className="p-2">
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
            {tasks.length > 0 && activeFilterCount === 0 && <p className="text-sm text-gray-400">All tasks are hidden by current grouping or filters.</p>}
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
    </MobileLayout>
  );
};

export default MobileTasksPage; 