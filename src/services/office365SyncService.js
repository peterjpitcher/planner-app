import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { office365GraphRequest } from '@/lib/office365/graph';
import { getValidOffice365AccessToken } from '@/services/office365ConnectionService';

function toGraphImportance(priority) {
  switch (priority) {
    case 'High':
      return 'high';
    case 'Low':
      return 'low';
    default:
      return 'normal';
  }
}

function toGraphDueDateTime(dueDate) {
  if (!dueDate) return null;
  // Supabase returns DATE columns as `YYYY-MM-DD` strings.
  const dateString = String(dueDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return null;

  // Use midday UTC to reduce off-by-one issues across time zones.
  return { dateTime: `${dateString}T12:00:00`, timeZone: 'UTC' };
}

function buildTodoTaskPayload(task) {
  const payload = {
    title: task.name,
    importance: toGraphImportance(task.priority),
    status: task.is_completed ? 'completed' : 'notStarted',
  };

  const dueDateTime = toGraphDueDateTime(task.due_date);
  if (dueDateTime) {
    payload.dueDateTime = dueDateTime;
  }

  if (task.description) {
    payload.body = { contentType: 'text', content: task.description };
  }

  return payload;
}

async function createTodoList({ accessToken, displayName }) {
  return office365GraphRequest({
    accessToken,
    method: 'POST',
    path: '/me/todo/lists',
    body: { displayName },
  });
}

async function updateTodoList({ accessToken, listId, displayName }) {
  return office365GraphRequest({
    accessToken,
    method: 'PATCH',
    path: `/me/todo/lists/${encodeURIComponent(listId)}`,
    body: { displayName },
  });
}

async function deleteTodoList({ accessToken, listId }) {
  return office365GraphRequest({
    accessToken,
    method: 'DELETE',
    path: `/me/todo/lists/${encodeURIComponent(listId)}`,
  });
}

async function createTodoTask({ accessToken, listId, payload }) {
  return office365GraphRequest({
    accessToken,
    method: 'POST',
    path: `/me/todo/lists/${encodeURIComponent(listId)}/tasks`,
    body: payload,
  });
}

async function updateTodoTask({ accessToken, listId, todoTaskId, payload }) {
  return office365GraphRequest({
    accessToken,
    method: 'PATCH',
    path: `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(todoTaskId)}`,
    body: payload,
  });
}

async function deleteTodoTask({ accessToken, listId, todoTaskId }) {
  return office365GraphRequest({
    accessToken,
    method: 'DELETE',
    path: `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(todoTaskId)}`,
  });
}

async function ensureProjectList({ supabase, accessToken, userId, project, existingMap }) {
  const current = existingMap?.get(project.id) || null;
  if (!current) {
    const created = await createTodoList({ accessToken, displayName: project.name });
    const listId = created?.id;
    if (!listId) throw new Error('Office365 list creation did not return an id');

    const { data, error } = await supabase
      .from('office365_project_lists')
      .insert({
        user_id: userId,
        project_id: project.id,
        list_id: listId,
      })
      .select('*')
      .single();

    if (error) throw error;
    existingMap?.set(project.id, data);
    return data;
  }

  // Keep list name in sync (best-effort).
  if (current.list_id && typeof project.name === 'string') {
    try {
      await updateTodoList({ accessToken, listId: current.list_id, displayName: project.name });
    } catch (err) {
      const message = String(err?.message || '');
      if (message.includes('(404)')) {
        const recreated = await createTodoList({ accessToken, displayName: project.name });
        const newListId = recreated?.id;
        if (!newListId) throw new Error('Office365 list recreation did not return an id');

        const { data, error } = await supabase
          .from('office365_project_lists')
          .update({ list_id: newListId, updated_at: new Date().toISOString() })
          .eq('id', current.id)
          .select('*')
          .single();

        if (error) throw error;
        existingMap?.set(project.id, data);
        return data;
      }
      throw err;
    }
  }

  return current;
}

async function ensureTaskItem({
  supabase,
  accessToken,
  userId,
  task,
  listId,
  existingTaskMap,
}) {
  const current = existingTaskMap?.get(task.id) || null;
  const payload = buildTodoTaskPayload(task);

  const createAndUpsert = async () => {
    const created = await createTodoTask({ accessToken, listId, payload });
    const todoTaskId = created?.id;
    if (!todoTaskId) throw new Error('Office365 task creation did not return an id');

    if (!current) {
      const { data, error } = await supabase
        .from('office365_task_items')
        .insert({
          user_id: userId,
          task_id: task.id,
          project_id: task.project_id,
          list_id: listId,
          todo_task_id: todoTaskId,
          etag: created?.['@odata.etag'] || null,
        })
        .select('*')
        .single();

      if (error) throw error;
      existingTaskMap?.set(task.id, data);
      return data;
    }

    const { data, error } = await supabase
      .from('office365_task_items')
      .update({
        project_id: task.project_id,
        list_id: listId,
        todo_task_id: todoTaskId,
        etag: created?.['@odata.etag'] || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', current.id)
      .select('*')
      .single();

    if (error) throw error;
    existingTaskMap?.set(task.id, data);
    return data;
  };

  if (!current) {
    return createAndUpsert();
  }

  const movedLists = current.list_id !== listId;
  if (movedLists) {
    // Graph To Do doesn't support moving tasks between lists; recreate.
    try {
      await deleteTodoTask({ accessToken, listId: current.list_id, todoTaskId: current.todo_task_id });
    } catch (err) {
      // Ignore and recreate anyway.
    }
    return createAndUpsert();
  }

  try {
    const updated = await updateTodoTask({
      accessToken,
      listId,
      todoTaskId: current.todo_task_id,
      payload,
    });

    const nextEtag = updated?.['@odata.etag'] || current.etag || null;
    const { data, error } = await supabase
      .from('office365_task_items')
      .update({
        project_id: task.project_id,
        etag: nextEtag,
        updated_at: new Date().toISOString(),
      })
      .eq('id', current.id)
      .select('*')
      .single();

    if (error) throw error;
    existingTaskMap?.set(task.id, data);
    return data;
  } catch (err) {
    const message = String(err?.message || '');
    if (message.includes('(404)')) {
      return createAndUpsert();
    }
    throw err;
  }
}

export async function syncOffice365All({ userId }) {
  const supabase = getSupabaseServiceRole();
  const accessToken = await getValidOffice365AccessToken({ userId });

  const [{ data: projects, error: projectsError }, { data: tasks, error: tasksError }] = await Promise.all([
    supabase.from('projects').select('*').eq('user_id', userId),
    supabase.from('tasks').select('*').eq('user_id', userId),
  ]);

  if (projectsError) throw projectsError;
  if (tasksError) throw tasksError;

  const { data: projectMaps, error: projectMapsError } = await supabase
    .from('office365_project_lists')
    .select('*')
    .eq('user_id', userId);
  if (projectMapsError) throw projectMapsError;

  const { data: taskMaps, error: taskMapsError } = await supabase
    .from('office365_task_items')
    .select('*')
    .eq('user_id', userId);
  if (taskMapsError) throw taskMapsError;

  const projectMapByProjectId = new Map((projectMaps || []).map((row) => [row.project_id, row]));
  const taskMapByTaskId = new Map((taskMaps || []).map((row) => [row.task_id, row]));

  const localProjectIds = new Set((projects || []).map((p) => p.id));
  const localTaskIds = new Set((tasks || []).map((t) => t.id));

  let createdLists = 0;
  let createdTasks = 0;
  let updatedTasks = 0;

  for (const project of projects || []) {
    const before = projectMapByProjectId.get(project.id);
    const ensured = await ensureProjectList({
      supabase,
      accessToken,
      userId,
      project,
      existingMap: projectMapByProjectId,
    });
    if (!before && ensured) {
      createdLists += 1;
    }
  }

  for (const task of tasks || []) {
    const projectMap = projectMapByProjectId.get(task.project_id);
    if (!projectMap) {
      // In case of data inconsistency, skip.
      continue;
    }

    const before = taskMapByTaskId.get(task.id);
    const ensured = await ensureTaskItem({
      supabase,
      accessToken,
      userId,
      task,
      listId: projectMap.list_id,
      existingTaskMap: taskMapByTaskId,
    });

    if (!before && ensured) createdTasks += 1;
    else updatedTasks += 1;
  }

  // Remove stale task mappings (and delete remote tasks) for local deletions.
  for (const mapping of taskMaps || []) {
    if (localTaskIds.has(mapping.task_id)) continue;
    try {
      await deleteTodoTask({ accessToken, listId: mapping.list_id, todoTaskId: mapping.todo_task_id });
    } catch (err) {
      // Ignore.
    }
    await supabase.from('office365_task_items').delete().eq('id', mapping.id);
  }

  // Remove stale project mappings (and delete remote lists) for local deletions.
  for (const mapping of projectMaps || []) {
    if (localProjectIds.has(mapping.project_id)) continue;
    try {
      await deleteTodoList({ accessToken, listId: mapping.list_id });
    } catch (err) {
      // Ignore.
    }
    await supabase.from('office365_project_lists').delete().eq('id', mapping.id);
  }

  await supabase
    .from('office365_connections')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('user_id', userId);

  return {
    createdLists,
    createdTasks,
    updatedTasks,
    totalProjects: projects?.length || 0,
    totalTasks: tasks?.length || 0,
  };
}

export async function syncOffice365Project({ userId, projectId }) {
  const supabase = getSupabaseServiceRole();
  const accessToken = await getValidOffice365AccessToken({ userId });

  const { data: project, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .eq('user_id', userId)
    .single();
  if (error) throw error;

  const { data: mapRows, error: mapError } = await supabase
    .from('office365_project_lists')
    .select('*')
    .eq('user_id', userId);
  if (mapError) throw mapError;

  const mapByProjectId = new Map((mapRows || []).map((row) => [row.project_id, row]));
  await ensureProjectList({ supabase, accessToken, userId, project, existingMap: mapByProjectId });

  await supabase
    .from('office365_connections')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('user_id', userId);
}

export async function deleteOffice365Project({ userId, projectId }) {
  const supabase = getSupabaseServiceRole();
  const accessToken = await getValidOffice365AccessToken({ userId });

  const { data: mapping, error } = await supabase
    .from('office365_project_lists')
    .select('*')
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .maybeSingle();

  if (error) throw error;
  if (!mapping) return;

  try {
    await deleteTodoList({ accessToken, listId: mapping.list_id });
  } catch (err) {
    // Ignore.
  }

  await supabase.from('office365_project_lists').delete().eq('id', mapping.id);
  await supabase.from('office365_task_items').delete().eq('user_id', userId).eq('project_id', projectId);

  await supabase
    .from('office365_connections')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('user_id', userId);
}

export async function syncOffice365Task({ userId, taskId }) {
  const supabase = getSupabaseServiceRole();
  const accessToken = await getValidOffice365AccessToken({ userId });

  const { data: task, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();
  if (error) throw error;

  const { data: projectMapping, error: projectMappingError } = await supabase
    .from('office365_project_lists')
    .select('*')
    .eq('user_id', userId)
    .eq('project_id', task.project_id)
    .maybeSingle();

  if (projectMappingError) throw projectMappingError;

  let listId = projectMapping?.list_id;
  if (!listId) {
    // Ensure list exists first.
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', task.project_id)
      .eq('user_id', userId)
      .single();
    if (projectError) throw projectError;

    const ensured = await ensureProjectList({ supabase, accessToken, userId, project, existingMap: null });
    listId = ensured.list_id;
  }

  const { data: taskMapping, error: taskMappingError } = await supabase
    .from('office365_task_items')
    .select('*')
    .eq('user_id', userId)
    .eq('task_id', task.id)
    .maybeSingle();
  if (taskMappingError) throw taskMappingError;

  const mapByTaskId = new Map();
  if (taskMapping) {
    mapByTaskId.set(task.id, taskMapping);
  }

  await ensureTaskItem({
    supabase,
    accessToken,
    userId,
    task,
    listId,
    existingTaskMap: mapByTaskId,
  });

  await supabase
    .from('office365_connections')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('user_id', userId);
}

export async function deleteOffice365Task({ userId, taskId }) {
  const supabase = getSupabaseServiceRole();
  const accessToken = await getValidOffice365AccessToken({ userId });

  const { data: mapping, error } = await supabase
    .from('office365_task_items')
    .select('*')
    .eq('user_id', userId)
    .eq('task_id', taskId)
    .maybeSingle();

  if (error) throw error;
  if (!mapping) return;

  try {
    await deleteTodoTask({ accessToken, listId: mapping.list_id, todoTaskId: mapping.todo_task_id });
  } catch (err) {
    // Ignore.
  }

  await supabase.from('office365_task_items').delete().eq('id', mapping.id);

  await supabase
    .from('office365_connections')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('user_id', userId);
}
