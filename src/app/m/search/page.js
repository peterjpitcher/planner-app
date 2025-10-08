'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApiClient } from '@/hooks/useApiClient';
import { handleError } from '@/lib/errorHandler';
import { useSession } from 'next-auth/react';
import MobileLayout from '@/components/Mobile/MobileLayout';
import MobileProjectListItem from '@/components/Mobile/MobileProjectListItem';
import MobileTaskListItem from '@/components/Mobile/MobileTaskListItem';

function SearchResults() {
  const api = useApiClient();
  const { data: session, status } = useSession();
  const user = session?.user;
  const authLoading = status === 'loading';
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
      const { data: projectData, error: projectError } = await api.projects.list();
      if (projectError) throw new Error(projectError);
      
      // Filter projects by search query
      const filteredProjects = (projectData || []).filter(project => 
        project.name.toLowerCase().includes(query.toLowerCase())
      );
      
      // Get tasks for open task count calculation
      const { data: allTasks, error: allTasksError } = await api.tasks.list();
      if (allTasksError) throw new Error(allTasksError);
      
      const projectsWithOpenTaskCount = filteredProjects.map(p => ({
        ...p,
        open_tasks_count: (allTasks || []).filter(t => t.project_id === p.id && !t.is_completed).length,
      }));
      setProjects(projectsWithOpenTaskCount);

      // Search tasks
      const filteredTasks = (allTasks || []).filter(task => 
        task.name.toLowerCase().includes(query.toLowerCase())
      );
      
      // Add project info to tasks
      const tasksWithProject = filteredTasks.map(task => {
        const project = projectData?.find(p => p.id === task.project_id);
        return {
          ...task,
          projects: project ? { id: project.id, name: project.name } : null
        };
      });
      
      setTasks(tasksWithProject);

    } catch (e) {
      const errorMsg = handleError(e, 'perform search');
      setError(errorMsg);
      setProjects([]);
      setTasks([]);
    } finally {
      setIsLoading(false);
    }
  }, [user, query, api.projects, api.tasks]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    } else if (status === 'authenticated' && user) {
      performSearch();
    }
  }, [user, status, query, router, performSearch]);

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
