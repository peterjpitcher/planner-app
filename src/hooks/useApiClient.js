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
    list: useCallback(async (includeCompleted = false) => {
      return apiCall(`/api/projects?includeCompleted=${includeCompleted}`);
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
    list: useCallback(async (projectId = null, includeCompleted = false) => {
      let url = '/api/tasks?';
      if (projectId) url += `projectId=${projectId}&`;
      url += `includeCompleted=${includeCompleted}`;
      return apiCall(url);
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
    list: useCallback(async (projectId = null, taskId = null) => {
      let url = '/api/notes?';
      if (projectId) url += `projectId=${projectId}&`;
      if (taskId) url += `taskId=${taskId}&`;
      return apiCall(url);
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