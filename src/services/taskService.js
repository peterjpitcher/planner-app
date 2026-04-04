import { STATE, TODAY_SECTION, PROJECT_STATUS } from '@/lib/constants';
import { validateTask } from '@/lib/validators';
import { handleSupabaseError } from '@/lib/errorHandler';
import { deleteOffice365Task, syncOffice365Task } from '@/services/office365SyncService';

const TASK_UPDATE_FIELDS = new Set([
  'name',
  'description',
  'due_date',
  'state',
  'today_section',
  'area',
  'task_type',
  'chips',
  'waiting_reason',
  'follow_up_date',
  'project_id',
  'completed_at',
  'updated_at',
]);

function filterTaskUpdates(updates = {}) {
  const filtered = {};
  Object.entries(updates).forEach(([key, value]) => {
    if (TASK_UPDATE_FIELDS.has(key)) {
      filtered[key] = value;
    }
  });
  return filtered;
}

function normalizeArea(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;  // Preserve case, just trim
}

const TASK_SELECT_FIELDS = 'id, name, description, due_date, state, today_section, sort_order, area, task_type, chips, waiting_reason, follow_up_date, project_id, user_id, completed_at, entered_state_at, source_idea_id, created_at, updated_at';

export async function createTask({ supabase, userId, payload, options = {} }) {
  const taskData = {
    ...payload,
    user_id: userId,
    state: payload?.state || STATE.BACKLOG,
  };

  // When state = 'today' and no today_section provided, default to 'good_to_do'
  if (taskData.state === STATE.TODAY && !taskData.today_section) {
    taskData.today_section = TODAY_SECTION.GOOD_TO_DO;
  }

  // Normalize area
  taskData.area = normalizeArea(taskData.area);

  // Set entered_state_at for initial state
  if (!taskData.entered_state_at) {
    taskData.entered_state_at = new Date().toISOString();
  }

  // Remove old fields that should not be sent
  delete taskData.priority;
  delete taskData.importance_score;
  delete taskData.urgency_score;
  delete taskData.is_completed;
  delete taskData.job;

  const validation = validateTask(taskData);
  if (!validation.isValid) {
    return { error: { status: 400, details: validation.errors } };
  }

  // Validate project ownership if project_id is provided
  if (taskData.project_id) {
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('user_id, name')
      .eq('id', taskData.project_id)
      .single();

    if (projectError || !project) {
      return { error: { status: 404, message: 'Project not found' } };
    }

    if (project.user_id !== userId) {
      return { error: { status: 403, message: 'Forbidden' } };
    }
  }

  const { data, error } = await supabase
    .from('tasks')
    .insert(taskData)
    .select(`${TASK_SELECT_FIELDS}, projects(id, name)`)
    .single();

  if (error) {
    const errorMessage = handleSupabaseError(error, 'create');
    return { error: { status: 500, message: errorMessage } };
  }

  // Touch the project's updated_at
  if (taskData.project_id) {
    await supabase
      .from('projects')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', taskData.project_id);
  }

  if (!options?.skipOffice365Sync && data?.id) {
    try {
      await syncOffice365Task({ userId, taskId: data.id });
    } catch (err) {
      console.warn('Office365 sync failed for created task:', err);
    }
  }

  return { data };
}

export async function updateTask({ supabase, userId, taskId, updates, options = {} }) {
  const { data: existingTask, error: fetchError } = await supabase
    .from('tasks')
    .select(TASK_SELECT_FIELDS)
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (fetchError || !existingTask) {
    return { error: { status: 404, message: 'Task not found' } };
  }

  if (existingTask.user_id !== userId) {
    return { error: { status: 403, message: 'Forbidden' } };
  }

  const updatesToApply = filterTaskUpdates(updates);
  if (Object.keys(updatesToApply).length === 0) {
    return { error: { status: 400, message: 'No valid fields to update' } };
  }

  const userProvidedArea = Object.prototype.hasOwnProperty.call(updatesToApply, 'area');
  const userProvidedProjectId = Object.prototype.hasOwnProperty.call(updatesToApply, 'project_id');

  // Normalize area if provided
  if (userProvidedArea) {
    updatesToApply.area = normalizeArea(updatesToApply.area);
  }

  const touches = new Set();
  if (existingTask.project_id) touches.add(existingTask.project_id);

  // Validate project ownership when project_id changes
  if (userProvidedProjectId) {
    const projectId = updatesToApply.project_id;
    if (projectId) {
      const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('id, user_id, name')
        .eq('id', projectId)
        .single();

      if (projectError || !project) {
        return { error: { status: 404, message: 'Project not found' } };
      }

      if (project.user_id !== userId) {
        return { error: { status: 403, message: 'Forbidden' } };
      }

      const movingProjects = updatesToApply.project_id !== existingTask.project_id;
      if (movingProjects) {
        touches.add(project.id);
      }
    }
    // project_id = null is valid (unassigned task) — skip ownership check
  }

  // State transition logic
  if ('state' in updatesToApply) {
    const newState = updatesToApply.state;
    const oldState = existingTask.state;

    if (newState !== oldState) {
      updatesToApply.entered_state_at = new Date().toISOString();
    }

    // When state changes to 'today', ensure today_section is set
    if (newState === STATE.TODAY) {
      if (!updatesToApply.today_section && !existingTask.today_section) {
        updatesToApply.today_section = TODAY_SECTION.GOOD_TO_DO;
      }
    }
    // When state changes away from 'today', do NOT include today_section
    // (the database trigger clears it)
    if (newState !== STATE.TODAY && oldState === STATE.TODAY) {
      delete updatesToApply.today_section;
    }

    // Handle completed_at for done state
    if (newState === STATE.DONE) {
      if (options.preserveCompletedAt) {
        updatesToApply.completed_at = updatesToApply.completed_at || new Date().toISOString();
      } else {
        updatesToApply.completed_at = new Date().toISOString();
      }
    } else if (oldState === STATE.DONE && newState !== STATE.DONE) {
      updatesToApply.completed_at = null;
    }
  }

  if (!options.skipTimestamp) {
    updatesToApply.updated_at = new Date().toISOString();
  }

  const validationTarget = { ...existingTask, ...updatesToApply };
  const validation = validateTask(validationTarget);
  if (!validation.isValid) {
    return { error: { status: 400, message: 'Validation failed', details: validation.errors } };
  }

  const { data, error } = await supabase
    .from('tasks')
    .update(updatesToApply)
    .eq('id', taskId)
    .eq('user_id', userId)
    .select(TASK_SELECT_FIELDS)
    .single();

  if (error) {
    const errorMessage = handleSupabaseError(error, 'update');
    return { error: { status: 500, message: errorMessage } };
  }

  if (!options.skipProjectTouch && touches.size > 0) {
    await supabase
      .from('projects')
      .update({ updated_at: new Date().toISOString() })
      .in('id', Array.from(touches));
  }

  if (!options?.skipOffice365Sync && data?.id) {
    try {
      await syncOffice365Task({ userId, taskId: data.id });
    } catch (err) {
      console.warn('Office365 sync failed for updated task:', err);
    }
  }

  return { data };
}

export async function updateSortOrder({ supabase, userId, items }) {
  if (!items || items.length === 0 || items.length > 50) {
    return { error: 'Invalid batch size (1-50 items)' };
  }
  // Verify ownership
  const ids = items.map(i => i.id);
  const { data: owned } = await supabase
    .from('tasks')
    .select('id')
    .in('id', ids)
    .eq('user_id', userId);
  if (!owned || owned.length !== ids.length) {
    return { error: 'Ownership verification failed' };
  }
  // Batch update via RPC
  const { error } = await supabase.rpc('fn_batch_update_sort_order', {
    p_user_id: userId,
    p_items: JSON.stringify(items),
  });
  if (error) return { error: error.message || error };
  return { success: true };
}

export async function deleteTask({ supabase, userId, taskId, options = {} }) {
  const { data: existingTask, error: fetchError } = await supabase
    .from('tasks')
    .select('user_id, project_id')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (fetchError || !existingTask) {
    return { error: { status: 404, message: 'Task not found' } };
  }

  if (existingTask.user_id !== userId) {
    return { error: { status: 403, message: 'Forbidden' } };
  }

  if (!options?.skipOffice365Sync) {
    try {
      await deleteOffice365Task({ userId, taskId });
    } catch (err) {
      console.warn('Office365 sync failed for deleted task:', err);
    }
  }

  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', taskId)
    .eq('user_id', userId);

  if (error) {
    const errorMessage = handleSupabaseError(error, 'delete');
    return { error: { status: 500, message: errorMessage } };
  }

  if (existingTask.project_id && !options.skipProjectTouch) {
    await supabase
      .from('projects')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', existingTask.project_id);
  }

  return { data: { success: true } };
}

export async function fetchTaskById({ supabase, userId, taskId }) {
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_SELECT_FIELDS)
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return { error: { status: 404, message: 'Task not found' } };
  }

  return { data };
}

export async function verifyTaskOwnership({ supabase, userId, taskId }) {
  const { data, error } = await supabase
    .from('tasks')
    .select('user_id, project_id')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return { error: { status: 404, message: 'Task not found' } };
  }

  if (data.user_id !== userId) {
    return { error: { status: 403, message: 'Forbidden' } };
  }

  return { data };
}
