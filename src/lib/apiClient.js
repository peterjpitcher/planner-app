// API client for all data operations
// This replaces direct Supabase calls for better security and reliability

import { dedupedFetch, clearCache, clearCacheByPrefix } from './requestCache';

function dispatchTasksChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('tasks-changed'));
  }
}

function dispatchIdeasChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ideas-changed'));
  }
}

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

  async getAllProjects(includeCompleted = false) {
    const allProjects = [];
    let offset = 0;
    const limit = 200; // max allowed by API
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams();
      if (includeCompleted) params.append('includeCompleted', 'true');
      params.append('limit', limit.toString());
      params.append('offset', offset.toString());

      const response = await this.fetchWithAuth(`/api/projects?${params}`);
      const data = response.data || [];
      allProjects.push(...data);
      hasMore = response.pagination?.hasMore ?? false;
      offset += limit;
    }

    return allProjects;
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
    const result = await this.fetchWithAuth(`/api/projects/${projectId}`, {
      method: 'DELETE',
    });
    // Clear project cache after deletion (mirrors create/update)
    clearCache('projects-true');
    clearCache('projects-false');
    return result;
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

  async getAllTasks(projectId = null, options = {}) {
    const allTasks = [];
    let offset = 0;
    const limit = 200; // max allowed by API
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams();
      if (projectId) params.append('projectId', projectId);
      if (options.states) params.append('states', options.states);
      if (options.state) params.append('state', options.state);
      params.append('limit', limit.toString());
      params.append('offset', offset.toString());

      const response = await this.fetchWithAuth(`/api/tasks?${params}`);
      const data = response.data || [];
      allTasks.push(...data);
      hasMore = response.pagination?.hasMore ?? false;
      offset += limit;
    }

    return allTasks;
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
      // Capture inbox (F3): thread the flag through so a plain quick-capture can
      // mark the created backlog task as awaiting triage. Undefined for every
      // other caller, so it is dropped by JSON.stringify.
      inbox,
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
      inbox,
      ...rest,
    };

    const result = await this.fetchWithAuth('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    dispatchTasksChanged();
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

    const result = await this.fetchWithAuth('/api/tasks', {
      method: 'PATCH',
      body: JSON.stringify({ id: taskId, ...cleanUpdates }),
    });
    dispatchTasksChanged();
    return result?.data ?? result;
  }

  async deleteTask(taskId) {
    const result = await this.fetchWithAuth(`/api/tasks/${taskId}`, {
      method: 'DELETE',
    });
    dispatchTasksChanged();
    return result;
  }

  // First-class snooze (F2). snoozeTask hides a task from planning candidates
  // until `until` (a YYYY-MM-DD London date); the server increments snooze_count.
  // unsnoozeTask clears it. Both dispatch tasks-changed so boards/views refresh.
  async snoozeTask(taskId, until) {
    const result = await this.fetchWithAuth('/api/tasks', {
      method: 'PATCH',
      body: JSON.stringify({ id: taskId, snoozed_until: until }),
    });
    dispatchTasksChanged();
    return result?.data ?? result;
  }

  async unsnoozeTask(taskId) {
    const result = await this.fetchWithAuth('/api/tasks', {
      method: 'PATCH',
      body: JSON.stringify({ id: taskId, snoozed_until: null }),
    });
    dispatchTasksChanged();
    return result?.data ?? result;
  }

  // Waiting chase engine (Wave 7). chaseTask re-arms a waiting task's self-
  // reminder: it sets follow_up_date to `until` (a YYYY-MM-DD London date). The
  // server increments chase_count when the new date is strictly later than the
  // current one (see taskService.updateTask); the client never sets chase_count.
  // Dispatches tasks-changed so boards/views refresh.
  async chaseTask(taskId, until) {
    const result = await this.fetchWithAuth('/api/tasks', {
      method: 'PATCH',
      body: JSON.stringify({ id: taskId, follow_up_date: until }),
    });
    dispatchTasksChanged();
    return result?.data ?? result;
  }

  // Carry-forward (A1) "Keep yesterday's plan": restore every task carried from
  // today back to Today at its remembered section in one action. Reuses
  // updateTask, so the server re-triage reset clears carried_section/carried_count
  // and each call dispatches tasks-changed for the boards/views to refresh.
  async restoreCarriedTasks(carriedTasks = []) {
    const restorable = (carriedTasks || []).filter((t) => t && t.id && t.carried_section);
    return Promise.all(
      restorable.map((t) =>
        this.updateTask(t.id, { state: 'today', today_section: t.carried_section })
      )
    );
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
    // Notify idea views (e.g. IdeaVault) so QuickCapture-created ideas appear
    // without a manual reload
    dispatchIdeasChanged();
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

  // Planning
  async getPlanningCandidates(windowType, windowDate) {
    const params = new URLSearchParams({ windowType, windowDate });
    const response = await this.fetchWithAuth(`/api/planning-candidates?${params}`);
    return response.data || {};
  }

  async getPlanningSession(windowType, windowDate) {
    const params = new URLSearchParams({ windowType, windowDate });
    const response = await this.fetchWithAuth(`/api/planning-sessions?${params}`);
    return response.data;
  }

  async createPlanningSession(windowType, windowDate) {
    const response = await this.fetchWithAuth('/api/planning-sessions', {
      method: 'POST',
      body: JSON.stringify({ windowType, windowDate }),
    });
    return response.data;
  }

  // A3 / F5-lite: acknowledge an auto-built day ("Looks good"). Stamps
  // reviewed_at on the daily session for windowDate so the review banner dismisses.
  async markPlanningSessionReviewed(windowDate) {
    const response = await this.fetchWithAuth('/api/planning-sessions', {
      method: 'PATCH',
      body: JSON.stringify({ windowType: 'daily', windowDate }),
    });
    return response.data;
  }

  // A3 / F5-lite: "Clear auto-plan". Moves every still-auto-placed, un-touched
  // task back to This Week, clears the flag, and deletes today's auto-built
  // session. Dispatches tasks-changed so the boards/views refresh.
  async clearAutopilotPlan() {
    const result = await this.fetchWithAuth('/api/autopilot/clear', {
      method: 'POST',
    });
    dispatchTasksChanged();
    return result;
  }

  // A5 (Wave 8): on-demand "Draft my day with AI". POSTs to the advisory
  // ai-draft route and returns the model's suggested placements as an array of
  // { taskId, section, reason }. Advisory only — nothing is placed server-side;
  // the planning modal pre-selects the suggestions for the user to confirm.
  // Returns an empty array when AI is off, unconfigured, or the draft failed.
  async draftDayWithAI(windowDate) {
    const response = await this.fetchWithAuth('/api/planning/ai-draft', {
      method: 'POST',
      // Pass the window being planned (usually tomorrow in the evening flow) so the
      // AI drafts against the SAME candidate pool the modal shows, not today's.
      ...(windowDate ? { body: JSON.stringify({ windowDate }) } : {}),
    });
    return response.assignments || [];
  }

  async getUserSettings() {
    const response = await this.fetchWithAuth('/api/user-settings');
    return response.data;
  }

  async updateUserSettings(settings) {
    const response = await this.fetchWithAuth('/api/user-settings', {
      method: 'PATCH',
      body: JSON.stringify(settings),
    });
    return response.data;
  }

  // Wave 4 automation control panel + heartbeat. Returns the full payload
  // ({ settings, health }) so callers can render both the toggles and the
  // per-automation status list.
  async getAutomations() {
    return this.fetchWithAuth('/api/automations');
  }

  // Wave 5 project-altitude radar. Returns { projects: [...radar rows...],
  // stalledCount } for the caller — the "needs a next action" board data.
  async getProjectRadar() {
    return this.fetchWithAuth('/api/projects/radar');
  }

  // Areas
  async getAreas() {
    const response = await this.fetchWithAuth('/api/areas');
    return response.data || [];
  }
}

// Export singleton instance
export const apiClient = new APIClient();
