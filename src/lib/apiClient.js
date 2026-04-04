// API client for all data operations
// This replaces direct Supabase calls for better security and reliability

import { dedupedFetch, clearCache, clearCacheByPrefix } from './requestCache';

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
  async getTasks(projectId = null, options = {}) {
    const params = new URLSearchParams();
    if (projectId) params.append('projectId', projectId);
    // State-based filtering (replaces is_completed / includeCompleted)
    if (options?.state) params.append('state', options.state);
    if (options?.states) params.append('states', options.states);
    if (options?.completedSince) params.append('completedSince', options.completedSince);
    if (options?.range) params.append('range', options.range);
    if (options?.days !== undefined) params.append('days', String(options.days));
    if (options?.includeOverdue === false) params.append('includeOverdue', 'false');
    if (options?.limit !== undefined) params.append('limit', String(options.limit));
    if (options?.offset !== undefined) params.append('offset', String(options.offset));
    if (options?.forceSync) params.append('forceSync', 'true');

    const response = await this.fetchWithAuth(`/api/tasks?${params}`);
    return response.data || [];
  }

  // Convenience method: fetch tasks filtered by a single state
  async getTasksByState(state) {
    return this.getTasks(null, { state });
  }

  async createTask(taskData) {
    // Allowed fields for task creation — old scoring/status fields removed
    const {
      name,
      projectId,
      dueDate,
      state,
      today_section,
      area,
      task_type,
      chips,
      notes,
      ...rest
    } = taskData;

    const payload = {
      name,
      projectId,
      dueDate,
      state,
      today_section,
      area,
      task_type,
      chips,
      notes,
      ...rest,
    };

    const result = await this.fetchWithAuth('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return result?.data ?? result;
  }

  async updateTask(taskId, updates) {
    // Strip out deprecated fields before sending to the API
    const {
      priority,
      is_completed,
      importance_score,
      urgency_score,
      job,
      ...cleanUpdates
    } = updates;

    const result = await this.fetchWithAuth(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(cleanUpdates),
    });
    return result?.data ?? result;
  }

  async deleteTask(taskId) {
    return this.fetchWithAuth(`/api/tasks/${taskId}`, {
      method: 'DELETE',
    });
  }

  // Update sort order for a list of tasks
  async updateSortOrder(items) {
    const result = await this.fetchWithAuth('/api/tasks/sort-order', {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
    return result?.data ?? result;
  }

  // Batch fetch tasks for multiple projects
  async getTasksBatch(projectIds) {
    const cacheKey = `tasks-batch-${[...projectIds].sort().join(',')}`;
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
    const result = await this.fetchWithAuth('/api/notes', {
      method: 'POST',
      body: JSON.stringify(noteData),
    });
    // Invalidate note-related batch caches to avoid stale UI
    clearCacheByPrefix('notes-batch-');
    clearCacheByPrefix('project-notes-batch-');
    return result;
  }

  // Batch fetch notes for multiple tasks
  async getNotesBatch(taskIds) {
    const cacheKey = `notes-batch-${[...taskIds].sort().join(',')}`;
    return dedupedFetch(cacheKey, async () => {
      const response = await this.fetchWithAuth('/api/notes/batch', {
        method: 'POST',
        body: JSON.stringify({ taskIds }),
      });
      return response || {};
    });
  }

  // Batch fetch notes for multiple projects
  async getProjectNotesBatch(projectIds) {
    const cacheKey = `project-notes-batch-${[...projectIds].sort().join(',')}`;
    return dedupedFetch(cacheKey, async () => {
      const response = await this.fetchWithAuth('/api/notes/batch', {
        method: 'POST',
        body: JSON.stringify({ projectIds }),
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

  // Ideas
  async getIdeas(filters = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params.append(key, String(value));
      }
    });
    const response = await this.fetchWithAuth(`/api/ideas?${params}`);
    return response.data || [];
  }

  async createIdea(data) {
    const result = await this.fetchWithAuth('/api/ideas', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return result?.data ?? result;
  }

  async updateIdea(id, updates) {
    const result = await this.fetchWithAuth(`/api/ideas/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    return result?.data ?? result;
  }

  async deleteIdea(id) {
    return this.fetchWithAuth(`/api/ideas/${id}`, {
      method: 'DELETE',
    });
  }

  async promoteIdea(id) {
    const result = await this.fetchWithAuth(`/api/ideas/${id}/promote`, {
      method: 'POST',
    });
    return result?.data ?? result;
  }

  // Areas
  async getAreas() {
    const response = await this.fetchWithAuth('/api/areas');
    return response.data || [];
  }
}

// Export singleton instance
export const apiClient = new APIClient();
