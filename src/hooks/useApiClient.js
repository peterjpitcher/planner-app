'use client';

import { useCallback } from 'react';
import { handleError } from '@/lib/errorHandler';

/**
 * Custom hook for making API calls to our Next.js API routes
 * This provides a secure way to interact with the database
 */
export function useApiClient() {
  const apiCall = useCallback(async (url, options = {}) => {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
      }
      
      return { data: data.data, error: null };
    } catch (error) {
      const message = handleError(error, 'API call');
      return { data: null, error: message };
    }
  }, []);

  // Project methods
  const projects = {
    list: useCallback(async (options = {}) => {
      const params = new URLSearchParams();
      if (options.includeCompleted) params.append('includeCompleted', 'true');
      if (options.limit) params.append('limit', options.limit);
      if (options.offset) params.append('offset', options.offset);
      return apiCall(`/api/projects?${params.toString()}`);
    }, [apiCall]),
    
    get: useCallback(async (id) => {
      const response = await apiCall(`/api/projects?includeCompleted=true`);
      if (response.error) return response;
      const project = response.data?.find(p => p.id === id);
      return { data: project || null, error: project ? null : 'Project not found' };
    }, [apiCall]),
    
    create: useCallback(async (projectData) => {
      return apiCall('/api/projects', {
        method: 'POST',
        body: JSON.stringify(projectData),
      });
    }, [apiCall]),
    
    update: useCallback(async (id, updates) => {
      return apiCall('/api/projects', {
        method: 'PATCH',
        body: JSON.stringify({ id, ...updates }),
      });
    }, [apiCall]),
    
    delete: useCallback(async (id) => {
      return apiCall(`/api/projects?id=${id}`, {
        method: 'DELETE',
      });
    }, [apiCall]),
  };

  // Task methods
  const tasks = {
    list: useCallback(async (options = {}) => {
      const params = new URLSearchParams();
      if (options.projectId) params.append('projectId', options.projectId);
      if (options.includeCompleted) params.append('includeCompleted', 'true');
      if (options.range) params.append('range', options.range);
      if (options.days !== undefined) params.append('days', options.days);
      if (options.includeOverdue !== undefined) params.append('includeOverdue', options.includeOverdue);
      if (options.limit) params.append('limit', options.limit);
      if (options.offset) params.append('offset', options.offset);
      return apiCall(`/api/tasks?${params.toString()}`);
    }, [apiCall]),
    
    create: useCallback(async (taskData) => {
      return apiCall('/api/tasks', {
        method: 'POST',
        body: JSON.stringify(taskData),
      });
    }, [apiCall]),
    
    update: useCallback(async (id, updates) => {
      return apiCall('/api/tasks', {
        method: 'PATCH',
        body: JSON.stringify({ id, ...updates }),
      });
    }, [apiCall]),
    
    delete: useCallback(async (id) => {
      return apiCall(`/api/tasks?id=${id}`, {
        method: 'DELETE',
      });
    }, [apiCall]),
  };

  // Notes methods
  const notes = {
    list: useCallback(async (options = {}) => {
      const params = new URLSearchParams();
      if (options.projectId) params.append('projectId', options.projectId);
      if (options.taskId) params.append('taskId', options.taskId);
      if (options.limit) params.append('limit', options.limit);
      if (options.offset) params.append('offset', options.offset);
      return apiCall(`/api/notes?${params.toString()}`);
    }, [apiCall]),
    
    create: useCallback(async (noteData) => {
      return apiCall('/api/notes', {
        method: 'POST',
        body: JSON.stringify(noteData),
      });
    }, [apiCall]),
  };

  return {
    projects,
    tasks,
    notes,
  };
}

/**
 * Example usage in a component:
 * 
 * import { useApiClient } from '@/hooks/useApiClient';
 * 
 * function MyComponent() {
 *   const api = useApiClient();
 *   
 *   const handleCreateProject = async (projectData) => {
 *     const { data, error } = await api.projects.create(projectData);
 *     if (error) {
 *       alert(error);
 *       return;
 *     }
 *     // Handle success
 *   };
 * }
 */