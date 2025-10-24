import { PRIORITY, PROJECT_STATUS } from '@/lib/constants';
import { validateTask } from '@/lib/validators';
import { handleSupabaseError } from '@/lib/errorHandler';

import { enqueueTaskSyncJob } from './taskSyncQueue';

async function ensureUnassignedProject(supabase, userId) {
  const { data: existingProject, error: fetchError } = await supabase
    .from('projects')
    .select('id')
    .eq('user_id', userId)
    .ilike('name', 'unassigned')
    .maybeSingle();

  if (fetchError) {
    throw fetchError;
  }

  if (existingProject?.id) {
    return existingProject.id;
  }

  const { data: createdProject, error: createError } = await supabase
    .from('projects')
    .insert({
      user_id: userId,
      name: 'Unassigned',
      status: PROJECT_STATUS.OPEN,
      priority: PRIORITY.MEDIUM,
      stakeholders: [],
      description: 'Auto-generated project for unassigned tasks.'
    })
    .select('id')
    .single();

  if (createError) {
    if (createError.code === '23505') {
      const { data: raceProject, error: raceFetchError } = await supabase
        .from('projects')
        .select('id')
        .eq('user_id', userId)
        .ilike('name', 'unassigned')
        .maybeSingle();

      if (raceFetchError || !raceProject?.id) {
        throw createError;
      }

      return raceProject.id;
    }

    throw createError;
  }

  return createdProject.id;
}

export async function createTask({ supabase, userId, payload, options = {} }) {
  const taskData = {
    ...payload,
    user_id: userId,
    is_completed: payload?.is_completed ?? false
  };

  if (!taskData.project_id) {
    taskData.project_id = await ensureUnassignedProject(supabase, userId);
  }

  const validation = validateTask(taskData);
  if (!validation.isValid) {
    return { error: { status: 400, details: validation.errors } };
  }

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('user_id')
    .eq('id', taskData.project_id)
    .single();

  if (projectError || !project) {
    return { error: { status: 404, message: 'Project not found' } };
  }

  if (project.user_id !== userId) {
    return { error: { status: 403, message: 'Forbidden' } };
  }

  const { data, error } = await supabase
    .from('tasks')
    .insert(taskData)
    .select('*, projects(id, name)')
    .single();

  if (error) {
    const errorMessage = handleSupabaseError(error, 'create');
    return { error: { status: 500, message: errorMessage } };
  }

  await supabase
    .from('projects')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', taskData.project_id);

  if (!options.skipSyncJob) {
    await enqueueTaskSyncJob({
      userId,
      taskId: data.id,
      action: 'create',
      metadata: {
        projectId: data.project_id
      }
    });
  }

  return { data };
}

export async function updateTask({ supabase, userId, taskId, updates, options = {} }) {
  const { data: existingTask, error: fetchError } = await supabase
    .from('tasks')
    .select('user_id, project_id')
    .eq('id', taskId)
    .single();

  if (fetchError || !existingTask) {
    return { error: { status: 404, message: 'Task not found' } };
  }

  if (existingTask.user_id !== userId) {
    return { error: { status: 403, message: 'Forbidden' } };
  }

  const updatesToApply = { ...updates };

  if ('is_completed' in updatesToApply) {
    updatesToApply.completed_at = updatesToApply.is_completed ? new Date().toISOString() : null;
  }

  if (!options.skipTimestamp) {
    updatesToApply.updated_at = new Date().toISOString();
  }

  const { data: syncState } = await supabase
    .from('task_sync_state')
    .select('graph_task_id, graph_etag, graph_list_id')
    .eq('task_id', taskId)
    .maybeSingle();

  const { data, error } = await supabase
    .from('tasks')
    .update(updatesToApply)
    .eq('id', taskId)
    .select()
    .single();

  if (error) {
    const errorMessage = handleSupabaseError(error, 'update');
    return { error: { status: 500, message: errorMessage } };
  }

  if (existingTask.project_id && !options.skipProjectTouch) {
    await supabase
      .from('projects')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', existingTask.project_id);
  }

  if (!options.skipSyncJob) {
    await enqueueTaskSyncJob({
      userId,
      taskId,
      action: 'update',
      metadata: {
        graphTaskId: syncState?.graph_task_id || null,
        graphEtag: syncState?.graph_etag || null,
        projectId: data.project_id,
        previousProjectId: existingTask.project_id
      }
    });
  }

  return { data };
}

export async function deleteTask({ supabase, userId, taskId, options = {} }) {
  const { data: existingTask, error: fetchError } = await supabase
    .from('tasks')
    .select('user_id, project_id')
    .eq('id', taskId)
    .single();

  if (fetchError || !existingTask) {
    return { error: { status: 404, message: 'Task not found' } };
  }

  if (existingTask.user_id !== userId) {
    return { error: { status: 403, message: 'Forbidden' } };
  }

  const { data: syncState } = await supabase
    .from('task_sync_state')
    .select('graph_task_id, graph_etag, graph_list_id')
    .eq('task_id', taskId)
    .maybeSingle();

  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', taskId);

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

  if (!options.skipSyncJob) {
    await enqueueTaskSyncJob({
      userId,
      taskId,
      action: 'delete',
      metadata: {
        graphTaskId: syncState?.graph_task_id || null,
        graphEtag: syncState?.graph_etag || null,
        projectId: existingTask.project_id,
        graphListId: syncState?.graph_list_id || null
      }
    });
  }

  return { data: { success: true } };
}

export async function fetchTaskById({ supabase, userId, taskId }) {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
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
    .single();

  if (error || !data) {
    return { error: { status: 404, message: 'Task not found' } };
  }

  if (data.user_id !== userId) {
    return { error: { status: 403, message: 'Forbidden' } };
  }

  return { data };
}

export { ensureUnassignedProject };
