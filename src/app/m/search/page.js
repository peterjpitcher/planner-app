'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import MobileLayout from '@/components/Mobile/MobileLayout';
import MobileProjectListItem from '@/components/Mobile/MobileProjectListItem';
import MobileTaskListItem from '@/components/Mobile/MobileTaskListItem';

function SearchResults() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.get('query');

  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const performSearch = useCallback(async () => {
    if (!user || !query || query.trim().length < 2) {
      setProjects([]);
      setTasks([]);
      if (query && query.trim().length > 0 && query.trim().length < 2) {
        setError('Please enter at least 2 characters to search.');
      } else {
        setError(null); // Clear error if query is empty or null
      }
      return;
    }
    setIsLoading(true);
    setError(null);

    try {
      // Search projects
      const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .select('*, tasks(id, is_completed)') // For open_tasks_count
        .eq('user_id', user.id)
        .ilike('name', `%${query}%`); // Case-insensitive search on name
        // Add .or(`description.ilike.%${query}%`) if searching descriptions too
      
      if (projectError) console.error('Project search error:', projectError);
      const projectsWithOpenTaskCount = (projectData || []).map(p => ({
        ...p,
        open_tasks_count: p.tasks ? p.tasks.filter(t => !t.is_completed).length : 0,
      }));
      setProjects(projectsWithOpenTaskCount);

      // Search tasks
      const { data: taskData, error: taskError } = await supabase
        .from('tasks')
        .select('*, projects(id, name)') // For project context
        .eq('user_id', user.id)
        .ilike('name', `%${query}%`);
        // Add .or(`description.ilike.%${query}%`) if searching descriptions too

      if (taskError) console.error('Task search error:', taskError);
      setTasks(taskData || []);

      if (projectError || taskError) {
        setError('An error occurred during the search.');
      }

    } catch (e) {
      console.error('Global search error:', e);
      setError('Search failed. Please try again.');
      setProjects([]);
      setTasks([]);
    } finally {
      setIsLoading(false);
    }
  }, [user, query]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    } else if (user) {
      performSearch();
    }
  }, [user, authLoading, query, router, performSearch]);

  // Callbacks for item updates/deletions from swipe actions
  const handleProjectDeleted = useCallback((deletedProjectId) => {
    setProjects(currentProjects => currentProjects.filter(p => p.id !== deletedProjectId));
  }, []);

  const handleTaskUpdated = useCallback((updatedTask) => {
    setTasks(currentTasks => currentTasks.map(t => t.id === updatedTask.id ? updatedTask : t));
  }, []);

  const handleTaskDeleted = useCallback((deletedTaskId) => {
    setTasks(currentTasks => currentTasks.filter(t => t.id !== deletedTaskId));
  }, []);


  if (authLoading) {
    return <div className="p-4 text-center">Authenticating...</div>;
  }
  
  let content;
  if (isLoading) {
    content = <p className="text-gray-500 text-center py-5">Searching...</p>;
  } else if (error) {
    content = <p className="text-red-500 text-center py-5">{error}</p>;
  } else if (!query || query.trim().length < 2) {
    content = <p className="text-gray-500 text-center py-5">Enter a search term (at least 2 characters).</p>;
  } else if (projects.length === 0 && tasks.length === 0) {
    content = <p className="text-gray-500 text-center py-5">No results found for &quot;{query}&quot;.</p>;
  } else {
    content = (
      <div className="space-y-6">
        {projects.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-2 px-1">Matching Projects ({projects.length})</h2>
            <div className="space-y-2">
              {projects.map(project => (
                <MobileProjectListItem key={project.id} project={project} onProjectDeleted={handleProjectDeleted} />
              ))}
            </div>
          </section>
        )}
        {tasks.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-2 px-1">Matching Tasks ({tasks.length})</h2>
            <div className="space-y-2">
              {tasks.map(task => (
                <MobileTaskListItem key={task.id} task={task} onTaskUpdated={handleTaskUpdated} onTaskDeleted={handleTaskDeleted} />
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  return (
    <MobileLayout title={query ? `Search: ${query}` : 'Search'}>
      {/* The search input is now in MobileLayout header */}
      <div className="p-2">
        {content}
      </div>
    </MobileLayout>
  );
}

// Wrap with Suspense for useSearchParams
export default function MobileSearchPage() {
  return (
    <Suspense fallback={<MobileLayout title="Search"><div className="p-4 text-center">Loading search...</div></MobileLayout>}>
      <SearchResults />
    </Suspense>
  );
} 