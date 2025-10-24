import {
  fetchPendingTaskSyncJobs,
  markTaskSyncJobProcessing,
  markTaskSyncJobCompleted,
  markTaskSyncJobFailed
} from './taskSyncQueue';

import {
  createTask,
  updateTask,
  deleteTask,
  ensureUnassignedProject
} from './taskService';

import {
  refreshAccessToken,
  createPlannerTask,
  updatePlannerTask,
  deletePlannerTask,
  getPlannerListDelta,
  renewSubscription,
  createTodoList,
  getTodoList,
  listTodoLists
} from '@/lib/microsoftGraphClient';

import { retrieveSecret, updateSecret } from '@/lib/supabaseVault';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { PRIORITY, PROJECT_STATUS } from '@/lib/constants';

const GRAPH_TIME_ZONE = 'UTC';

const STATUS_COMPLETED = 'completed';

const DEFAULT_PROJECT_DESCRIPTION_PREFIX = 'Created from Microsoft To Do list:';

function buildListDisplayName(projectName) {
  if (!projectName) {
    return 'Planner Project';
  }
  const trimmed = projectName.trim();
  return trimmed.length > 120 ? trimmed.slice(0, 117).concat('...') : trimmed;
}

async function getProjectListMapping({ supabase, projectId }) {
  const { data, error } = await supabase
    .from('project_outlook_lists')
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

async function getProjectListMappingByListId({ supabase, userId, listId }) {
  const { data, error } = await supabase
    .from('project_outlook_lists')
    .select('*')
    .eq('user_id', userId)
    .eq('graph_list_id', listId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

async function upsertProjectListMapping({ supabase, userId, projectId, listId, etag, isActive = true }) {
  const payload = {
    user_id: userId,
    project_id: projectId,
    graph_list_id: listId,
    graph_etag: etag || null,
    is_active: isActive
  };

  const { data, error } = await supabase
    .from('project_outlook_lists')
    .upsert(payload, { onConflict: 'project_id' })
    .select()
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

function mapPriorityToImportance(priority) {
  switch (priority) {
    case 'High':
      return 'high';
    case 'Low':
      return 'low';
    default:
      return 'normal';
  }
}

function mapImportanceToPriority(importance) {
  switch ((importance || '').toLowerCase()) {
    case 'high':
      return 'High';
    case 'low':
      return 'Low';
    default:
      return 'Medium';
  }
}

function formatDateForGraph(dateString) {
  if (!dateString) {
    return null;
  }

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return {
    dateTime: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString(),
    timeZone: GRAPH_TIME_ZONE
  };
}

function extractDateFromGraph(graphDateTime) {
  if (!graphDateTime?.dateTime) {
    return null;
  }

  const date = new Date(graphDateTime.dateTime);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function buildGraphTaskPayload(task) {
  const payload = {
    subject: task.name,
    body: {
      contentType: 'text',
      content: task.description || ''
    },
    importance: mapPriorityToImportance(task.priority)
  };

  const dueDate = formatDateForGraph(task.due_date);
  if (dueDate) {
    payload.dueDateTime = dueDate;
  }

  if (task.is_completed) {
    payload.status = STATUS_COMPLETED;
    payload.completedDateTime = {
      dateTime: (task.completed_at ? new Date(task.completed_at) : new Date()).toISOString(),
      timeZone: GRAPH_TIME_ZONE
    };
  } else {
    payload.status = 'notStarted';
  }

  return payload;
}

function mapGraphTaskToLocal(graphTask) {
  return {
    name: graphTask.subject,
    description: graphTask.body?.content || '',
    due_date: extractDateFromGraph(graphTask.dueDateTime),
    priority: mapImportanceToPriority(graphTask.importance),
    is_completed: (graphTask.status || '').toLowerCase() === STATUS_COMPLETED,
    completed_at: graphTask.completedDateTime?.dateTime || null,
    updated_at: graphTask.lastModifiedDateTime || new Date().toISOString()
  };
}

async function getConnection(userId) {
  const supabase = getSupabaseServiceRole();
  const { data: connection, error } = await supabase
    .from('outlook_connections')
    .select('user_id, planner_list_id, access_token, access_token_expires_at, refresh_token_secret, delta_token, subscription_id, subscription_expiration')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !connection) {
    return null;
  }

  let accessToken = connection.access_token;
  let expiresAt = connection.access_token_expires_at;
  const expireThreshold = Date.now() + 2 * 60 * 1000;

  if (!accessToken || !expiresAt || new Date(expiresAt).getTime() <= expireThreshold) {
    if (!connection.refresh_token_secret) {
      return null;
    }

    const refreshToken = await retrieveSecret(connection.refresh_token_secret);
    if (!refreshToken) {
      return null;
    }

    const refreshed = await refreshAccessToken({ refreshToken });
    accessToken = refreshed.access_token;
    expiresAt = new Date(Date.now() + (refreshed.expires_in - 60) * 1000).toISOString();

    await updateSecret(connection.refresh_token_secret, refreshed.refresh_token || refreshToken);

    const updateResult = await supabase
      .from('outlook_connections')
      .update({
        access_token: accessToken,
        access_token_expires_at: expiresAt
      })
      .eq('user_id', userId);

    if (updateResult.error) {
      throw updateResult.error;
    }
  }

  return {
    ...connection,
    accessToken,
    access_token_expires_at: expiresAt
  };
}

async function ensureProjectList({ supabase, connection, userId, projectId }) {
  const existingMapping = await getProjectListMapping({ supabase, projectId });
  if (existingMapping?.graph_list_id && existingMapping.is_active !== false) {
    return existingMapping;
  }

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('name')
    .eq('id', projectId)
    .maybeSingle();

  if (projectError || !project) {
    throw projectError || new Error('Project not found');
  }

  const displayName = buildListDisplayName(project.name || 'Planner Project');
  let list = null;

  try {
    list = await createTodoList(connection.accessToken, displayName);
  } catch (error) {
    if (error.status === 409 || error.status === 400) {
      const existingLists = await listTodoLists(connection.accessToken);
      list = existingLists?.value?.find((l) => l.displayName?.toLowerCase() === displayName.toLowerCase()) || null;
    }

    if (!list) {
      throw error;
    }
  }

  const mapping = await upsertProjectListMapping({
    supabase,
    userId,
    projectId,
    listId: list.id,
    etag: list['@odata.etag'] || null,
    isActive: true
  });

  return mapping;
}

async function ensureProjectForList({ supabase, connection, userId, listId }) {
  const existingMapping = await getProjectListMappingByListId({ supabase, userId, listId });
  if (existingMapping?.project_id) {
    return existingMapping;
  }

  const list = await getTodoList(connection.accessToken, listId);
  const displayName = buildListDisplayName(list?.displayName || 'Outlook Project');

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .insert({
      user_id: userId,
      name: displayName,
      priority: PRIORITY.MEDIUM,
      status: PROJECT_STATUS.OPEN,
      stakeholders: [],
      description: `${DEFAULT_PROJECT_DESCRIPTION_PREFIX} ${displayName}`
    })
    .select()
    .single();

  if (projectError) {
    throw projectError;
  }

  const mapping = await upsertProjectListMapping({
    supabase,
    userId,
    projectId: project.id,
    listId,
    etag: list?.['@odata.etag'] || null,
    isActive: true
  });

  return mapping;
}

async function upsertSyncState({ supabase, taskId, userId, graphTaskId, graphEtag, graphListId, direction }) {
  const payload = {
    task_id: taskId,
    user_id: userId,
    graph_task_id: graphTaskId,
    graph_etag: graphEtag || null,
    graph_list_id: graphListId || null,
    last_synced_at: new Date().toISOString(),
    last_sync_direction: direction
  };

  const { error } = await supabase
    .from('task_sync_state')
    .upsert(payload, { onConflict: 'task_id' });

  if (error) {
    throw error;
  }
}

async function handleCreateJob(job, connection) {
  const supabase = getSupabaseServiceRole();
  const { data: task, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', job.task_id)
    .maybeSingle();

  if (error || !task) {
    throw new Error('Task not found for create sync');
  }

  let projectId = task.project_id;
  if (!projectId) {
    projectId = await ensureUnassignedProject(supabase, task.user_id);
    if (projectId !== task.project_id) {
      await supabase
        .from('tasks')
        .update({ project_id: projectId })
        .eq('id', task.id);
      task.project_id = projectId;
    }
  }

  const projectMapping = await ensureProjectList({
    supabase,
    connection,
    userId: task.user_id,
    projectId
  });

  const graphTask = await createPlannerTask(
    connection.accessToken,
    projectMapping.graph_list_id,
    buildGraphTaskPayload(task)
  );

  await upsertSyncState({
    supabase,
    taskId: task.id,
    userId: task.user_id,
    graphTaskId: graphTask.id,
    graphEtag: graphTask['@odata.etag'] || null,
    graphListId: projectMapping.graph_list_id,
    direction: 'local'
  });
}

async function handleUpdateJob(job, connection) {
  const supabase = getSupabaseServiceRole();
  const jobPayload = job.payload || {};

  const { data: task, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', job.task_id)
    .maybeSingle();

  if (error || !task) {
    throw new Error('Task not found for update sync');
  }

  const { data: syncState, error: syncError } = await supabase
    .from('task_sync_state')
    .select('graph_task_id, graph_etag, graph_list_id')
    .eq('task_id', task.id)
    .maybeSingle();

  if (syncError) {
    throw syncError;
  }

  const targetProjectId = jobPayload.projectId || task.project_id;
  const projectMapping = await ensureProjectList({
    supabase,
    connection,
    userId: task.user_id,
    projectId: targetProjectId
  });

  if (!syncState?.graph_task_id) {
    await handleCreateJob({ ...job, payload: { ...jobPayload, projectId: targetProjectId } }, connection);
    return;
  }

  const existingListId = syncState.graph_list_id;

  // Handle task moves between projects (lists)
  if (existingListId && existingListId !== projectMapping.graph_list_id) {
    try {
      await deletePlannerTask(connection.accessToken, existingListId, syncState.graph_task_id);
    } catch (deleteError) {
      if (deleteError.status !== 404) {
        throw deleteError;
      }
    }

    const graphTask = await createPlannerTask(
      connection.accessToken,
      projectMapping.graph_list_id,
      buildGraphTaskPayload(task)
    );

    await upsertSyncState({
      supabase,
      taskId: task.id,
      userId: task.user_id,
      graphTaskId: graphTask.id,
      graphEtag: graphTask?.['@odata.etag'] || null,
      graphListId: projectMapping.graph_list_id,
      direction: 'local'
    });

    return;
  }

  const listIdForUpdate = existingListId || projectMapping.graph_list_id || connection.planner_list_id;

  const graphTask = await updatePlannerTask(
    connection.accessToken,
    listIdForUpdate,
    syncState.graph_task_id,
    buildGraphTaskPayload(task),
    syncState.graph_etag
  );

  await upsertSyncState({
    supabase,
    taskId: task.id,
    userId: task.user_id,
    graphTaskId: syncState.graph_task_id,
    graphEtag: graphTask?.['@odata.etag'] || syncState.graph_etag || null,
    graphListId: listIdForUpdate,
    direction: 'local'
  });
}

async function handleDeleteJob(job, connection) {
  const supabase = getSupabaseServiceRole();
  const jobPayload = job.payload || {};
  const graphTaskId = jobPayload.graphTaskId;
  const graphEtag = jobPayload.graphEtag;
  const jobListId = jobPayload.graphListId;

  if (!graphTaskId) {
    return; // Nothing to delete on Graph side
  }

  const { data: syncState } = await supabase
    .from('task_sync_state')
    .select('graph_list_id, task_id, user_id')
    .eq('graph_task_id', graphTaskId)
    .maybeSingle();

  const listIdToUse = jobListId || syncState?.graph_list_id || connection.planner_list_id;

  try {
    await deletePlannerTask(connection.accessToken, listIdToUse, graphTaskId, graphEtag || undefined);
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
  }

  await supabase
    .from('task_sync_state')
    .delete()
    .eq('graph_task_id', graphTaskId);
}

async function handleRemoteCreateOrUpdate({ userId, graphTask, connection }) {
  const serviceSupabase = getSupabaseServiceRole();

  const listIdFromGraph = graphTask.parentListId || graphTask.parentFolderId || null;

  const { data: existingSync } = await serviceSupabase
    .from('task_sync_state')
    .select('task_id, graph_list_id')
    .eq('graph_task_id', graphTask.id)
    .maybeSingle();

  const mappedTask = mapGraphTaskToLocal(graphTask);

  let projectMapping = null;
  if (listIdFromGraph) {
    const existingMapping = await getProjectListMappingByListId({
      supabase: serviceSupabase,
      userId,
      listId: listIdFromGraph
    });

    projectMapping = existingMapping ?? await ensureProjectForList({
      supabase: serviceSupabase,
      connection,
      userId,
      listId: listIdFromGraph
    });
  }

  if (!existingSync?.task_id) {
    const projectId = projectMapping?.project_id
      || await ensureUnassignedProject(serviceSupabase, userId);

    const { data: createdTask } = await createTask({
      supabase: serviceSupabase,
      userId,
      payload: {
        name: mappedTask.name,
        description: mappedTask.description,
        due_date: mappedTask.due_date,
        priority: mappedTask.priority,
        project_id: projectId,
        is_completed: mappedTask.is_completed,
        completed_at: mappedTask.completed_at
      },
      options: { skipSyncJob: true }
    });

    if (!createdTask) {
      throw new Error('Failed to create local task from Graph');
    }

    await upsertSyncState({
      supabase: serviceSupabase,
      taskId: createdTask.id,
      userId,
      graphTaskId: graphTask.id,
      graphEtag: graphTask['@odata.etag'] || null,
      graphListId: listIdFromGraph || projectMapping?.graph_list_id || connection.planner_list_id,
      direction: 'remote'
    });

    return;
  }

  const updates = {
    name: mappedTask.name,
    description: mappedTask.description,
    due_date: mappedTask.due_date,
    priority: mappedTask.priority,
    is_completed: mappedTask.is_completed,
    completed_at: mappedTask.completed_at,
    updated_at: mappedTask.updated_at
  };

  if (projectMapping?.project_id) {
    updates.project_id = projectMapping.project_id;
  }

  await updateTask({
    supabase: serviceSupabase,
    userId,
    taskId: existingSync.task_id,
    updates,
    options: {
      skipSyncJob: true,
      skipTimestamp: true,
      skipProjectTouch: true
    }
  });

  await upsertSyncState({
    supabase: serviceSupabase,
    taskId: existingSync.task_id,
    userId,
    graphTaskId: graphTask.id,
    graphEtag: graphTask['@odata.etag'] || null,
    graphListId: listIdFromGraph || projectMapping?.graph_list_id || existingSync.graph_list_id || connection.planner_list_id,
    direction: 'remote'
  });
}

async function handleRemoteDelete({ userId, graphTaskId }) {
  const serviceSupabase = getSupabaseServiceRole();
  const { data: existingSync } = await serviceSupabase
    .from('task_sync_state')
    .select('task_id')
    .eq('graph_task_id', graphTaskId)
    .maybeSingle();

  if (!existingSync?.task_id) {
    return;
  }

  await deleteTask({
    supabase: serviceSupabase,
    userId,
    taskId: existingSync.task_id,
    options: {
      skipSyncJob: true
    }
  });

  await serviceSupabase
    .from('task_sync_state')
    .delete()
    .eq('task_id', existingSync.task_id);
}

async function processSingleJob(job) {
  const connection = await getConnection(job.user_id);
  if (!connection) {
    throw new Error('No Outlook connection available');
  }

  switch (job.action) {
    case 'create':
      await handleCreateJob(job, connection);
      break;
    case 'update':
      await handleUpdateJob(job, connection);
      break;
    case 'delete':
      await handleDeleteJob(job, connection);
      break;
    case 'full_sync':
      await syncRemoteChangesForUser(job.user_id, connection);
      break;
    default:
      throw new Error(`Unsupported sync job action: ${job.action}`);
  }
}

export async function processTaskSyncJobs(limit = 25) {
  const jobs = await fetchPendingTaskSyncJobs(limit);
  const results = [];

  for (const job of jobs) {
    await markTaskSyncJobProcessing(job.id, job.attempts);

    try {
      await processSingleJob(job);
      await markTaskSyncJobCompleted(job.id);
      results.push({ jobId: job.id, status: 'completed' });
    } catch (error) {
      console.error(`Failed to process sync job ${job.id}`, error);
      await markTaskSyncJobFailed(job.id, error.message, job.attempts);
      results.push({ jobId: job.id, status: 'failed', error: error.message });
    }
  }

  return results;
}

export async function syncRemoteChangesForUser(userId, connectionOverride = null) {
  const connection = connectionOverride || await getConnection(userId);

  if (!connection) {
    throw new Error('No Outlook connection available');
  }

  const response = await getPlannerListDelta(connection.accessToken, connection.planner_list_id, connection.delta_token ? connection.delta_token : undefined);

  if (Array.isArray(response?.value)) {
    for (const item of response.value) {
      if (item['@removed']) {
        await handleRemoteDelete({ userId, graphTaskId: item.id });
      } else {
        await handleRemoteCreateOrUpdate({ userId, graphTask: item, connection });
      }
    }
  }

  const newDeltaToken = response['@odata.deltaLink'] || response['@odata.nextLink'];

  if (newDeltaToken && newDeltaToken !== connection.delta_token) {
    const supabase = getSupabaseServiceRole();
    const { error } = await supabase
      .from('outlook_connections')
      .update({ delta_token: newDeltaToken })
      .eq('user_id', userId);

    if (error) {
      throw error;
    }
  }

  return {
    processed: response?.value?.length || 0
  };
}

export async function renewOutlookSubscriptions(thresholdMinutes = 30) {
  const supabase = getSupabaseServiceRole();
  const threshold = Date.now() + thresholdMinutes * 60 * 1000;

  const { data: connections, error } = await supabase
    .from('outlook_connections')
    .select('user_id, subscription_id, subscription_expiration')
    .not('subscription_id', 'is', null);

  if (error) {
    throw error;
  }

  const results = [];

  for (const connection of connections || []) {
    const expirationTime = connection.subscription_expiration
      ? new Date(connection.subscription_expiration).getTime()
      : 0;

    if (!connection.subscription_id) {
      continue;
    }

    if (expirationTime && expirationTime > threshold) {
      continue;
    }

    const resolvedConnection = await getConnection(connection.user_id);
    if (!resolvedConnection) {
      continue;
    }

    try {
      const durationCandidate = parseInt(process.env.OUTLOOK_SUBSCRIPTION_DURATION_MIN || '60', 10);
      const durationMinutes = Number.isNaN(durationCandidate) ? 60 : durationCandidate;
      await renewSubscription(
        resolvedConnection.accessToken,
        connection.subscription_id,
        durationMinutes
      );

      await supabase
        .from('outlook_connections')
        .update({ subscription_expiration: new Date(Date.now() + durationMinutes * 60 * 1000).toISOString() })
        .eq('user_id', connection.user_id);

      results.push({ userId: connection.user_id, status: 'renewed' });
    } catch (renewError) {
      console.error('Failed to renew subscription', renewError);
      results.push({ userId: connection.user_id, status: 'failed', error: renewError.message });
    }
  }

  return results;
}
