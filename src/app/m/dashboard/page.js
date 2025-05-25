'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import MobileLayout from '@/components/Mobile/MobileLayout';
import MobileProjectListItem from '@/components/Mobile/MobileProjectListItem';
import { useAuth } from '@/contexts/AuthContext'; // Assuming you have an AuthContext
import { FunnelIcon, XMarkIcon } from '@heroicons/react/20/solid'; // For filter icons

const MobileDashboardPage = () => {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // State for filters
  const [selectedStatus, setSelectedStatus] = useState('All');
  const [selectedPriority, setSelectedPriority] = useState('All');
  const [showFilters, setShowFilters] = useState(false);

  const projectStatusOptions = ['All', 'Open', 'In Progress', 'On Hold']; // Exclude Completed/Cancelled as they are filtered by query
  const priorityOptions = ['All', 'High', 'Medium', 'Low'];

  const fetchProjects = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: dbError } = await supabase
        .from('projects')
        .select('*, tasks(id, is_completed)') // Fetch tasks to count open ones
        .eq('user_id', user.id)
        .not('status', 'in', '("Completed", "Cancelled")'); // Filter out completed or cancelled projects

      if (dbError) throw dbError;
      
      let projectsWithOpenTaskCount = data.map(p => ({
        ...p,
        open_tasks_count: p.tasks ? p.tasks.filter(t => !t.is_completed).length : 0,
      }));

      // Apply comprehensive client-side sorting
      projectsWithOpenTaskCount.sort((a, b) => {
        const priorityOrder = { 'High': 3, 'Medium': 2, 'Low': 1 };
        const priorityA = priorityOrder[a.priority] || 0;
        const priorityB = priorityOrder[b.priority] || 0;
        
        // Sort by priority descending
        if (priorityB !== priorityA) return priorityB - priorityA; 
        
        // Then sort by due_date ascending (nulls first)
        const dateA = a.due_date ? new Date(a.due_date) : null;
        const dateB = b.due_date ? new Date(b.due_date) : null;

        if (dateA === null && dateB === null) return 0; // both null, equal
        if (dateA === null) return -1; // a is null, sort a first (nulls first)
        if (dateB === null) return 1;  // b is null, sort b first (nulls first)
        
        return dateA - dateB; // Both are dates, sort ascending
      });
      
      setProjects(projectsWithOpenTaskCount);

    } catch (e) {
      console.error('Error fetching projects:', e);
      setError('Failed to load projects.');
      setProjects([]);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
    if (user) {
      fetchProjects();
    }
  }, [user, authLoading, router, fetchProjects]);

  const handleProjectAdded = (newProject) => {
    // Optimistically add or re-fetch
    fetchProjects(); // Simplest way to refresh list with correct task count
  };

  const handleProjectDeletedFromSwipe = useCallback((deletedProjectId) => {
    setProjects(currentProjects => currentProjects.filter(p => p.id !== deletedProjectId));
    // This also handles projects marked as 'Completed' via swipe, as they are filtered out by fetchProjects or client-side logic.
  }, []);

  const handleProjectUpdatedFromSwipe = useCallback((updatedProject) => {
    setProjects(currentProjects => {
      const newProjects = currentProjects.map(p => 
        p.id === updatedProject.id ? { ...p, ...updatedProject, open_tasks_count: updatedProject.open_tasks_count !== undefined ? updatedProject.open_tasks_count : p.open_tasks_count } : p
      );
      // Re-sort based on the primary sort order (priority desc, due_date asc)
      return newProjects.sort((a, b) => {
        const priorityOrder = { 'High': 3, 'Medium': 2, 'Low': 1 };
        const priorityA = priorityOrder[a.priority] || 0;
        const priorityB = priorityOrder[b.priority] || 0;
        
        // Sort by priority descending
        if (priorityB !== priorityA) return priorityB - priorityA; 
        
        // Then sort by due_date ascending (nulls first)
        const dateA = a.due_date ? new Date(a.due_date) : null;
        const dateB = b.due_date ? new Date(b.due_date) : null;

        if (dateA === null && dateB === null) return 0; // both null, equal
        if (dateA === null) return -1; // a is null, sort a first (nulls first)
        if (dateB === null) return 1;  // b is null, sort b first (nulls first)
        
        return dateA - dateB; // Both are dates, sort ascending
      });
    });
  }, []);

  const filteredProjects = useMemo(() => {
    return projects.filter(project => {
      const statusMatch = selectedStatus === 'All' || project.status === selectedStatus;
      const priorityMatch = selectedPriority === 'All' || project.priority === selectedPriority;
      return statusMatch && priorityMatch;
    });
  }, [projects, selectedStatus, selectedPriority]);

  const clearFilters = () => {
    setSelectedStatus('All');
    setSelectedPriority('All');
  };
  
  const activeFilterCount = (selectedStatus !== 'All' ? 1 : 0) + (selectedPriority !== 'All' ? 1 : 0);

  if (authLoading || (isLoading && projects.length === 0)) {
    return (
      <MobileLayout title="My Projects">
        <div className="text-center py-10">
          <p className="text-gray-500">Loading projects...</p>
          {/* Optional: Add a spinner here */}
        </div>
      </MobileLayout>
    );
  }

  if (error) {
    return (
      <MobileLayout title="Error">
        <div className="text-center py-10">
          <p className="text-red-500">{error}</p>
          <button 
            onClick={fetchProjects} 
            className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
          >
            Try Again
          </button>
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout title="My Projects" onProjectAdded={handleProjectAdded}>
      <div className="p-2">
        <button 
          onClick={() => setShowFilters(!showFilters)} 
          className="w-full mb-2 flex items-center justify-center px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-indigo-500"
        >
          <FunnelIcon className={`h-4 w-4 mr-1.5 ${activeFilterCount > 0 ? 'text-indigo-600' : 'text-gray-400'}`} />
          Filters {activeFilterCount > 0 ? `(${activeFilterCount} applied)` : ''}
        </button>

        {showFilters && (
          <div className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="statusFilter" className="block text-xs font-medium text-gray-600 mb-0.5">Status</label>
                <select id="statusFilter" value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)} className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 py-1.5 px-2">
                  {projectStatusOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
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

        {filteredProjects.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500">No projects match your filters.</p>
            {projects.length > 0 && activeFilterCount === 0 && <p className="text-sm text-gray-400">Tap the &apos;+&apos; icon to add your first project.</p>}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredProjects.map(project => (
              <MobileProjectListItem 
                key={project.id} 
                project={project} 
                onProjectUpdated={handleProjectUpdatedFromSwipe}
                onProjectDeleted={handleProjectDeletedFromSwipe}
              />
            ))}
          </div>
        )}
      </div>
    </MobileLayout>
  );
};

export default MobileDashboardPage; 