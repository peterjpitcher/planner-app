// API client for all data operations
// This replaces direct Supabase calls for better security and reliability

import { dedupedFetch, clearCache } from './requestCache';

class APIClient {
  async fetchWithAuth(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Network error' }));
      throw new Error(error.error || `Request failed: ${response.status}`);
    }

    return response.json();
  }

  // Projects
  async getProjects(includeCompleted = false) {
    const params = new URLSearchParams();
    if (includeCompleted) params.append('includeCompleted', 'true');
    
    const cacheKey = `projects-${includeCompleted}`;
    return dedupedFetch(cacheKey, async () => {
      const response = await this.fetchWithAuth(`/api/projects?${params}`);
      return response.data || [];
    });
  }

  async createProject(projectData) {
    const result = await this.fetchWithAuth('/api/projects', {
      method: 'POST',
      body: JSON.stringify(projectData),
    });
    // Clear project cache after creation
    clearCache('projects-true');
    clearCache('projects-false');
    return result?.data ?? result;
  }

  async updateProject(projectId, updates) {
    const result = await this.fetchWithAuth(`/api/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    // Clear project cache after update
    clearCache('projects-true');
    clearCache('projects-false');
    return result?.data ?? result;
  }

  async deleteProject(projectId) {
    return this.fetchWithAuth(`/api/projects/${projectId}`, {
      method: 'DELETE',
    });
  }

  // Tasks
  async getTasks(projectId = null, includeCompleted = false) {
    const params = new URLSearchParams();
    if (projectId) params.append('projectId', projectId);
    if (includeCompleted) params.append('includeCompleted', 'true');
    
    const response = await this.fetchWithAuth(`/api/tasks?${params}`);
    return response.data || [];
  }

  async createTask(taskData) {
    const result = await this.fetchWithAuth('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(taskData),
    });
    return result?.data ?? result;
  }

  async updateTask(taskId, updates) {
    const result = await this.fetchWithAuth(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    return result?.data ?? result;
  }

  async deleteTask(taskId) {
    return this.fetchWithAuth(`/api/tasks/${taskId}`, {
      method: 'DELETE',
    });
  }

  // Batch fetch tasks for multiple projects
  async getTasksBatch(projectIds) {
    const cacheKey = `tasks-batch-${projectIds.sort().join(',')}`;
    return dedupedFetch(cacheKey, async () => {
      const response = await this.fetchWithAuth('/api/tasks/batch', {
        method: 'POST',
        body: JSON.stringify({ projectIds }),
      });
      return response || {};
    });
  }

  // Notes
  async getNotes(projectId = null, taskId = null) {
    const params = new URLSearchParams();
    if (projectId) params.append('projectId', projectId);
    if (taskId) params.append('taskId', taskId);
    
    return this.fetchWithAuth(`/api/notes?${params}`);
  }

  async createNote(noteData) {
    return this.fetchWithAuth('/api/notes', {
      method: 'POST',
      body: JSON.stringify(noteData),
    });
  }

  // Batch fetch notes for multiple tasks
  async getNotesBatch(taskIds) {
    const cacheKey = `notes-batch-${taskIds.sort().join(',')}`;
    return dedupedFetch(cacheKey, async () => {
      const response = await this.fetchWithAuth('/api/notes/batch', {
        method: 'POST',
        body: JSON.stringify({ taskIds }),
      });
      return response || {};
    });
  }

  // Completed items report
  async getCompletedItems(startDate, endDate) {
    const params = new URLSearchParams({
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    });
    
    return this.fetchWithAuth(`/api/completed-items?${params}`);
  }
}

// Export singleton instance
export const apiClient = new APIClient();
