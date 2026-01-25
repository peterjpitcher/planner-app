import { PRIORITY, PROJECT_STATUS } from '@/lib/constants';
import { validateTask } from '@/lib/validators';
import { handleSupabaseError } from '@/lib/errorHandler';

function normalizeJob(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeScore(value) {
  if (value === null) return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return { error: 'Must be a number between 0 and 100' };
  }
  const rounded = Math.round(numeric);
  if (rounded < 0 || rounded > 100) {
    return { error: 'Must be between 0 and 100' };
  }
  return { value: rounded };
}

function isUnassignedProject(project) {
  const name = typeof project?.name === 'string' ? project.name.trim().toLowerCase() : '';
  return name === 'unassigned';
}

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

  taskData.job = normalizeJob(taskData.job);

  const scoreErrors = {};
  if (Object.prototype.hasOwnProperty.call(taskData, 'importance_score')) {
    const normalized = normalizeScore(taskData.importance_score);
    if (normalized?.error) {
      scoreErrors.importance_score = normalized.error;
    } else {
      taskData.importance_score = normalized.value;
    }
  }
  if (Object.prototype.hasOwnProperty.call(taskData, 'urgency_score')) {
    const normalized = normalizeScore(taskData.urgency_score);
    if (normalized?.error) {
      scoreErrors.urgency_score = normalized.error;
    } else {
      taskData.urgency_score = normalized.value;
    }
  }
  if (Object.keys(scoreErrors).length > 0) {
    return { error: { status: 400, details: scoreErrors } };
  }

  const validation = validateTask(taskData);
  if (!validation.isValid) {
    return { error: { status: 400, details: validation.errors } };
  }

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

  if (!isUnassignedProject(project)) {
    taskData.job = null;
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

  return { data };
}

export async function updateTask({ supabase, userId, taskId, updates, options = {} }) {
  const { data: existingTask, error: fetchError } = await supabase
    .from('tasks')
    .select('user_id, project_id, job')
    .eq('id', taskId)
    .single();

  if (fetchError || !existingTask) {
    return { error: { status: 404, message: 'Task not found' } };
  }

  if (existingTask.user_id !== userId) {
    return { error: { status: 403, message: 'Forbidden' } };
  }

  const updatesToApply = { ...updates };
  const userProvidedJob = Object.prototype.hasOwnProperty.call(updatesToApply, 'job');
  const userProvidedProjectId = Object.prototype.hasOwnProperty.call(updatesToApply, 'project_id');

  const scoreUpdateErrors = {};
  if (Object.prototype.hasOwnProperty.call(updatesToApply, 'importance_score')) {
    const normalized = normalizeScore(updatesToApply.importance_score);
    if (normalized?.error) {
      scoreUpdateErrors.importance_score = normalized.error;
    } else {
      updatesToApply.importance_score = normalized.value;
    }
  }
  if (Object.prototype.hasOwnProperty.call(updatesToApply, 'urgency_score')) {
    const normalized = normalizeScore(updatesToApply.urgency_score);
    if (normalized?.error) {
      scoreUpdateErrors.urgency_score = normalized.error;
    } else {
      updatesToApply.urgency_score = normalized.value;
    }
  }
  if (Object.keys(scoreUpdateErrors).length > 0) {
    return { error: { status: 400, message: 'Validation failed', details: scoreUpdateErrors } };
  }

  if (userProvidedJob) {
    updatesToApply.job = normalizeJob(updatesToApply.job);
  }

  const touches = new Set();
  if (existingTask.project_id) touches.add(existingTask.project_id);

  if (userProvidedJob || userProvidedProjectId) {
    const projectId = userProvidedProjectId ? updatesToApply.project_id : existingTask.project_id;
    if (!projectId) {
      return { error: { status: 400, message: 'Task must be associated with a project' } };
    }

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id, name, job')
      .eq('id', projectId)
      .single();

    if (projectError || !project) {
      return { error: { status: 404, message: 'Project not found' } };
    }

    if (project.user_id !== userId) {
      return { error: { status: 403, message: 'Forbidden' } };
    }

    const movingProjects = userProvidedProjectId && updatesToApply.project_id !== existingTask.project_id;
    if (movingProjects) {
      touches.add(project.id);
    }

    const targetIsUnassigned = isUnassignedProject(project);

    if (!targetIsUnassigned) {
      // Tasks in a "real" project always inherit the project's job; don't store on the task.
      updatesToApply.job = null;
    } else {
      // Moving into Unassigned: if no job was provided, preserve context.
      if (movingProjects && !userProvidedJob) {
        const { data: previousProject, error: previousProjectError } = await supabase
          .from('projects')
          .select('id, name, job')
          .eq('id', existingTask.project_id)
          .single();

        if (!previousProjectError && previousProject) {
          updatesToApply.job = isUnassignedProject(previousProject)
            ? normalizeJob(existingTask.job)
            : normalizeJob(previousProject.job);
        } else {
          updatesToApply.job = normalizeJob(existingTask.job);
        }
      }
    }
  }

  if ('is_completed' in updatesToApply) {
    updatesToApply.completed_at = updatesToApply.is_completed ? new Date().toISOString() : null;
  }

  if (!options.skipTimestamp) {
    updatesToApply.updated_at = new Date().toISOString();
  }

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

  if (!options.skipProjectTouch && touches.size > 0) {
    await supabase
      .from('projects')
      .update({ updated_at: new Date().toISOString() })
      .in('id', Array.from(touches));
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
