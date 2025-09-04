'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useApiClient } from '@/hooks/useApiClient';
import { handleError } from '@/lib/errorHandler';
import { format, isToday, isTomorrow, isPast, differenceInDays, startOfToday, addDays } from 'date-fns';
import { CheckCircleIcon, ExclamationCircleIcon, ClockIcon } from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleIconSolid } from '@heroicons/react/24/solid';

const UpcomingTasksList = ({ className = '' }) => {
  const apiClient = useApiClient();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all | overdue | today | week | fortnight
  const [optimisticUpdates, setOptimisticUpdates] = useState({});

  // Fetch upcoming tasks
  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      // Determine days parameter based on filter
      let days = 14;
      let includeOverdue = true;
      
      if (filter === 'today') {
        days = 0;
        includeOverdue = false;
      } else if (filter === 'week') {
        days = 7;
      } else if (filter === 'overdue') {
        // For overdue, we still need to fetch them via the range
        days = 0;
        includeOverdue = true;
      }

      const params = {
        range: 'upcoming',
        days,
        includeOverdue,
        includeCompleted: false,
        limit: 100
      };

      const response = await apiClient.tasks.list(params);
      
      // Apply client-side filtering for specific views
      let filteredTasks = response.data || [];
      
      if (filter === 'overdue') {
        filteredTasks = filteredTasks.filter(task => 
          task.due_date && isPast(new Date(task.due_date)) && !isToday(new Date(task.due_date))
        );
      }

      setTasks(filteredTasks);
    } catch (error) {
      handleError(error, 'Failed to load upcoming tasks');
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [apiClient, filter]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Handle task completion toggle
  const handleToggleComplete = async (task) => {
    const taskId = task.id;
    const newStatus = !task.is_completed;
    
    // Optimistic update
    setOptimisticUpdates(prev => ({ ...prev, [taskId]: newStatus }));
    setTasks(prev => prev.map(t => 
      t.id === taskId ? { ...t, is_completed: newStatus } : t
    ));

    try {
      await apiClient.tasks.update(taskId, {
        is_completed: newStatus,
        completed_at: newStatus ? new Date().toISOString() : null
      });
      
      // Remove completed task from list after a short delay
      if (newStatus) {
        setTimeout(() => {
          setTasks(prev => prev.filter(t => t.id !== taskId));
        }, 500);
      }
    } catch (error) {
      // Rollback on error
      setTasks(prev => prev.map(t => 
        t.id === taskId ? { ...t, is_completed: !newStatus } : t
      ));
      handleError(error, 'Failed to update task');
    } finally {
      setOptimisticUpdates(prev => {
        const updated = { ...prev };
        delete updated[taskId];
        return updated;
      });
    }
  };

  // Group tasks by time period
  const groupTasks = (taskList) => {
    const groups = {
      overdue: [],
      today: [],
      tomorrow: [],
      thisWeek: [],
      later: []
    };

    const today = startOfToday();
    
    taskList.forEach(task => {
      if (!task.due_date) return; // Skip tasks without due dates
      
      const dueDate = new Date(task.due_date);
      const daysUntil = differenceInDays(dueDate, today);
      
      if (daysUntil < 0) {
        groups.overdue.push(task);
      } else if (isToday(dueDate)) {
        groups.today.push(task);
      } else if (isTomorrow(dueDate)) {
        groups.tomorrow.push(task);
      } else if (daysUntil <= 7) {
        groups.thisWeek.push(task);
      } else {
        groups.later.push(task);
      }
    });

    return groups;
  };

  // Get priority color
  const getPriorityColor = (priority) => {
    switch (priority?.toLowerCase()) {
      case 'high': return 'text-red-500';
      case 'medium': return 'text-yellow-500';
      case 'low': return 'text-green-500';
      default: return 'text-gray-400';
    }
  };

  // Format relative date
  const formatRelativeDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    
    if (isToday(date)) return 'Today';
    if (isTomorrow(date)) return 'Tomorrow';
    
    const daysUntil = differenceInDays(date, startOfToday());
    if (daysUntil < 0) return `${Math.abs(daysUntil)} days overdue`;
    if (daysUntil <= 7) return format(date, 'EEEE'); // Day name
    
    return format(date, 'MMM d');
  };

  const groupedTasks = groupTasks(tasks);
  const hasAnyTasks = Object.values(groupedTasks).some(group => group.length > 0);

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <h1 className="text-lg font-semibold text-gray-900">Upcoming Tasks</h1>
        
        {/* Filter chips */}
        <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
          {[
            { value: 'all', label: 'All' },
            { value: 'overdue', label: 'Overdue' },
            { value: 'today', label: 'Today' },
            { value: 'week', label: 'Next 7' },
            { value: 'fortnight', label: 'Next 14' }
          ].map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`px-3 py-1 text-sm rounded-full whitespace-nowrap transition-colors ${
                filter === value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          </div>
        ) : !hasAnyTasks ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-500">
            <ClockIcon className="h-8 w-8 mb-2" />
            <p>No upcoming tasks</p>
            <p className="text-sm text-gray-400 mt-1">Tasks will appear here as you add them</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {/* Overdue Section */}
            {groupedTasks.overdue.length > 0 && (
              <div>
                <div className="px-4 py-2 bg-red-50 text-red-700 font-medium text-sm sticky top-0">
                  Overdue ({groupedTasks.overdue.length})
                </div>
                {groupedTasks.overdue.map(task => (
                  <TaskItem 
                    key={task.id} 
                    task={task} 
                    onToggleComplete={handleToggleComplete}
                    getPriorityColor={getPriorityColor}
                    formatRelativeDate={formatRelativeDate}
                    isOptimistic={optimisticUpdates[task.id] !== undefined}
                  />
                ))}
              </div>
            )}

            {/* Today Section */}
            {groupedTasks.today.length > 0 && (
              <div>
                <div className="px-4 py-2 bg-indigo-50 text-indigo-700 font-medium text-sm sticky top-0">
                  Today ({groupedTasks.today.length})
                </div>
                {groupedTasks.today.map(task => (
                  <TaskItem 
                    key={task.id} 
                    task={task} 
                    onToggleComplete={handleToggleComplete}
                    getPriorityColor={getPriorityColor}
                    formatRelativeDate={formatRelativeDate}
                    isOptimistic={optimisticUpdates[task.id] !== undefined}
                  />
                ))}
              </div>
            )}

            {/* Tomorrow Section */}
            {groupedTasks.tomorrow.length > 0 && (
              <div>
                <div className="px-4 py-2 bg-gray-50 text-gray-700 font-medium text-sm sticky top-0">
                  Tomorrow ({groupedTasks.tomorrow.length})
                </div>
                {groupedTasks.tomorrow.map(task => (
                  <TaskItem 
                    key={task.id} 
                    task={task} 
                    onToggleComplete={handleToggleComplete}
                    getPriorityColor={getPriorityColor}
                    formatRelativeDate={formatRelativeDate}
                    isOptimistic={optimisticUpdates[task.id] !== undefined}
                  />
                ))}
              </div>
            )}

            {/* This Week Section */}
            {groupedTasks.thisWeek.length > 0 && (
              <div>
                <div className="px-4 py-2 bg-gray-50 text-gray-700 font-medium text-sm sticky top-0">
                  This Week ({groupedTasks.thisWeek.length})
                </div>
                {groupedTasks.thisWeek.map(task => (
                  <TaskItem 
                    key={task.id} 
                    task={task} 
                    onToggleComplete={handleToggleComplete}
                    getPriorityColor={getPriorityColor}
                    formatRelativeDate={formatRelativeDate}
                    isOptimistic={optimisticUpdates[task.id] !== undefined}
                  />
                ))}
              </div>
            )}

            {/* Later Section */}
            {groupedTasks.later.length > 0 && (
              <div>
                <div className="px-4 py-2 bg-gray-50 text-gray-700 font-medium text-sm sticky top-0">
                  Later ({groupedTasks.later.length})
                </div>
                {groupedTasks.later.map(task => (
                  <TaskItem 
                    key={task.id} 
                    task={task} 
                    onToggleComplete={handleToggleComplete}
                    getPriorityColor={getPriorityColor}
                    formatRelativeDate={formatRelativeDate}
                    isOptimistic={optimisticUpdates[task.id] !== undefined}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// Task Item Component
const TaskItem = ({ task, onToggleComplete, getPriorityColor, formatRelativeDate, isOptimistic }) => {
  const isOverdue = task.due_date && isPast(new Date(task.due_date)) && !isToday(new Date(task.due_date));
  
  return (
    <div className={`px-4 py-3 hover:bg-gray-50 transition-colors ${isOptimistic ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-3">
        {/* Complete Toggle */}
        <button
          onClick={() => onToggleComplete(task)}
          className="mt-0.5 flex-shrink-0"
          aria-label={task.is_completed ? 'Mark as incomplete' : 'Mark as complete'}
        >
          {task.is_completed ? (
            <CheckCircleIconSolid className="h-5 w-5 text-indigo-600" />
          ) : (
            <CheckCircleIcon className="h-5 w-5 text-gray-400 hover:text-indigo-600" />
          )}
        </button>

        {/* Task Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <p className={`text-sm font-medium text-gray-900 ${task.is_completed ? 'line-through' : ''}`}>
                {task.name}
              </p>
              
              {/* Meta info */}
              <div className="flex items-center gap-3 mt-1">
                {/* Due date */}
                <span className={`text-xs ${isOverdue ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                  {formatRelativeDate(task.due_date)}
                </span>
                
                {/* Project name */}
                {task.project_name && (
                  <span className="text-xs text-gray-400">
                    {task.project_name}
                  </span>
                )}
              </div>
            </div>

            {/* Priority indicator */}
            <span className={`flex-shrink-0 h-2 w-2 rounded-full mt-1.5 ${
              task.priority === 'High' ? 'bg-red-500' :
              task.priority === 'Medium' ? 'bg-yellow-500' :
              task.priority === 'Low' ? 'bg-green-500' :
              'bg-gray-300'
            }`} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default UpcomingTasksList;