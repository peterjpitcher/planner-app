import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { office365GraphRequest } from '@/lib/office365/graph';
import { getOffice365Connection, getValidOffice365AccessToken } from '@/services/office365ConnectionService';

function isProjectActive(status) {
  const normalized = typeof status === 'string' ? status.trim().toLowerCase() : '';
  return normalized === 'open' || normalized === 'in progress' || normalized === 'on hold';
}

function toLocalPriority(importance) {
  switch (importance) {
    case 'high':
      return 'High';
    case 'low':
      return 'Low';
    default:
      return 'Medium';
  }
}

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

function fromGraphDueDateTime(dueDateTime) {
  const raw = dueDateTime?.dateTime;
  if (!raw) return null;
  const dateString = String(raw).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return null;
  return dateString;
}

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\r\n/g, '\n').trim();
}

function normalizeLocalTask(task) {
  return {
    title: normalizeText(task?.name),
    description: normalizeText(task?.description),
    dueDate: task?.due_date ? String(task.due_date).slice(0, 10) : null,
    importance: toGraphImportance(task?.priority),
    status: task?.is_completed ? 'completed' : 'notStarted',
  };
}

function normalizeRemoteTask(todoTask) {
  const task = todoTask || {};
  const result = {};

  if (Object.prototype.hasOwnProperty.call(task, 'title')) {
    result.title = normalizeText(task.title);
  }
  if (Object.prototype.hasOwnProperty.call(task, 'body')) {
    result.description = normalizeText(task.body?.content);
  }
  if (Object.prototype.hasOwnProperty.call(task, 'dueDateTime')) {
    result.dueDate = fromGraphDueDateTime(task.dueDateTime);
  } else {
    // If Graph omits dueDateTime, treat it as null so we can push local due dates.
    result.dueDate = null;
  }
  if (Object.prototype.hasOwnProperty.call(task, 'importance')) {
    result.importance = task.importance || 'normal';
  }
  if (Object.prototype.hasOwnProperty.call(task, 'status')) {
    result.status = task.status || 'notStarted';
  }

  return result;
}

function tasksMatch(localTask, remoteTask) {
  const local = normalizeLocalTask(localTask);
  const remote = normalizeRemoteTask(remoteTask);
  for (const [key, value] of Object.entries(remote)) {
    if (local[key] !== value) return false;
  }
  return true;
}

function toTimestampMs(value) {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function toIsoTimestamp(value) {
  const ms = toTimestampMs(value);
  if (!ms) return null;
  return new Date(ms).toISOString();
}

function buildTodoTaskPayload(task) {
  const dueDateTime = toGraphDueDateTime(task.due_date);
  const payload = {
    title: task.name,
    importance: toGraphImportance(task.priority),
    status: task.is_completed ? 'completed' : 'notStarted',
    dueDateTime,
    body: { contentType: 'text', content: task.description ? String(task.description) : '' },
  };

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

async function listTodoTasks({ accessToken, listId }) {
  const selectFull = [
    'id',
    'title',
    'status',
    'importance',
    'dueDateTime',
    'completedDateTime',
    'body',
    'createdDateTime',
    'lastModifiedDateTime',
  ].join(',');
  const selectMinimal = [
    'id',
    'title',
    'status',
    'importance',
    'dueDateTime',
    'createdDateTime',
    'lastModifiedDateTime',
  ].join(',');

  const listIdVariants = [encodeURIComponent(listId), listId];
  const queryVariants = [
    `?$top=100&$select=${selectFull}`,
    `?$top=100&$select=${selectMinimal}`,
    '?$top=100',
    '',
  ];

  const fetchAllPages = async ({ initialPath }) => {
    const items = [];
    let nextUrl = null;
    for (let i = 0; i < 50; i += 1) {
      const page = await office365GraphRequest({
        accessToken,
        method: 'GET',
        ...(nextUrl ? { url: nextUrl } : { path: initialPath }),
      });

      const pageItems = page?.value;
      if (Array.isArray(pageItems)) {
        items.push(...pageItems);
      }

      nextUrl = page?.['@odata.nextLink'] || null;
      if (!nextUrl) break;
    }
    return items;
  };

  let lastError = null;
  for (const listIdValue of listIdVariants) {
    for (const query of queryVariants) {
      const initialPath = `/me/todo/lists/${listIdValue}/tasks${query}`;
      try {
        return await fetchAllPages({ initialPath });
      } catch (err) {
        lastError = err;
        const message = String(err?.message || '');
        if (!message.includes('(400)') || !message.includes('ParseUri')) {
          throw err;
        }
      }
    }
  }

  throw lastError || new Error('Office365 listTodoTasks failed');
}

async function todoTaskExists({ accessToken, listId, todoTaskId }) {
  const listIdVariants = [encodeURIComponent(listId), listId];
  const encodedTodoTaskId = encodeURIComponent(todoTaskId);

  let any404 = false;
  let lastError = null;
  for (const listIdValue of listIdVariants) {
    try {
      await office365GraphRequest({
        accessToken,
        method: 'GET',
        path: `/me/todo/lists/${listIdValue}/tasks/${encodedTodoTaskId}`,
      });
      return true;
    } catch (err) {
      lastError = err;
      const message = String(err?.message || '');
      if (message.includes('(404)')) {
        any404 = true;
        continue;
      }
      if (message.includes('(400)') && message.includes('ParseUri')) {
        continue;
      }
      throw err;
    }
  }

  if (any404) return false;
  throw lastError || new Error('Office365 todoTaskExists failed');
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

  const [
    { data: projects, error: projectsError },
    { data: tasks, error: tasksError },
  ] = await Promise.all([
    supabase.from('projects').select('*').eq('user_id', userId),
    supabase.from('tasks').select('*').eq('user_id', userId),
  ]);

  if (projectsError) throw projectsError;
  if (tasksError) throw tasksError;

  const activeProjects = (projects || []).filter((project) => isProjectActive(project.status));
  const activeProjectIds = new Set(activeProjects.map((project) => project.id));
  const desiredTasks = (tasks || []).filter((task) => activeProjectIds.has(task.project_id));

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
  const taskMapByTodoTaskId = new Map((taskMaps || []).map((row) => [row.todo_task_id, row]));

  const desiredProjectIds = new Set(activeProjects.map((p) => p.id));
  const desiredTaskIds = new Set(desiredTasks.map((t) => t.id));

  let createdLists = 0;
  let pushedCreatedTasks = 0;
  let pushedUpdatedTasks = 0;
  let pulledCreatedTasks = 0;
  let pulledUpdatedTasks = 0;
  let pulledDeletedTasks = 0;

  for (const project of activeProjects) {
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

  const remoteTasksByListId = new Map();
  const remoteTodoTaskIds = new Set();
  const localTasksById = new Map((tasks || []).map((task) => [task.id, task]));

  const activeProjectMappings = activeProjects
    .map((project) => projectMapByProjectId.get(project.id))
    .filter(Boolean);

  for (const projectMapping of activeProjectMappings) {
    const listId = projectMapping.list_id;
    if (!listId) continue;

    const remoteTasks = await listTodoTasks({ accessToken, listId });
    remoteTasksByListId.set(listId, remoteTasks);
    for (const remoteTask of remoteTasks) {
      if (remoteTask?.id) remoteTodoTaskIds.add(remoteTask.id);
    }

	    for (const remoteTask of remoteTasks) {
	      const remoteTodoId = remoteTask?.id;
	      if (!remoteTodoId) continue;

      const existingMapping = taskMapByTodoTaskId.get(remoteTodoId) || null;
      if (!existingMapping) {
        const projectId = projectMapping.project_id;
        if (!projectId) continue;

	        const payload = {
	          user_id: userId,
	          project_id: projectId,
	          name: remoteTask.title || 'New task',
	          description: remoteTask?.body?.content ? String(remoteTask.body.content) : null,
	          due_date: fromGraphDueDateTime(remoteTask?.dueDateTime) || new Date().toISOString().slice(0, 10),
	          priority: toLocalPriority(remoteTask?.importance),
	          is_completed: remoteTask?.status === 'completed',
	          completed_at:
	            remoteTask?.status === 'completed'
	              ? (toIsoTimestamp(remoteTask?.completedDateTime?.dateTime) || new Date().toISOString())
              : null,
          updated_at: toIsoTimestamp(remoteTask?.lastModifiedDateTime || remoteTask?.createdDateTime) || new Date().toISOString(),
        };

        const { data: createdTask, error: createdTaskError } = await supabase
          .from('tasks')
          .insert(payload)
          .select('*')
          .single();
        if (createdTaskError) {
          console.warn('Office365 pull: failed to create local task:', createdTaskError);
          continue;
        }

        const { data: mappingRow, error: mappingError } = await supabase
          .from('office365_task_items')
          .insert({
            user_id: userId,
            task_id: createdTask.id,
            project_id: projectId,
            list_id: listId,
            todo_task_id: remoteTodoId,
            etag: remoteTask?.['@odata.etag'] || null,
          })
          .select('*')
          .single();
        if (mappingError) {
          console.warn('Office365 pull: failed to create mapping:', mappingError);
          continue;
        }

        taskMapByTaskId.set(createdTask.id, mappingRow);
        taskMapByTodoTaskId.set(remoteTodoId, mappingRow);
        localTasksById.set(createdTask.id, createdTask);
        pulledCreatedTasks += 1;

        await supabase
          .from('projects')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', projectId);

        continue;
      }

      const localTask = localTasksById.get(existingMapping.task_id);
      if (!localTask) continue;

      const remoteEtag = remoteTask?.['@odata.etag'] || null;
      const localMs = toTimestampMs(localTask.updated_at || localTask.created_at);
      const remoteMs = toTimestampMs(remoteTask.lastModifiedDateTime || remoteTask.createdDateTime);

	      if (!tasksMatch(localTask, remoteTask)) {
	        if (remoteMs > localMs) {
	          const updates = {
	            updated_at: toIsoTimestamp(remoteTask?.lastModifiedDateTime || remoteTask?.createdDateTime) || new Date().toISOString(),
	          };

	          if (Object.prototype.hasOwnProperty.call(remoteTask || {}, 'title')) {
	            updates.name = remoteTask.title || localTask.name;
	          }
	          if (Object.prototype.hasOwnProperty.call(remoteTask || {}, 'body')) {
	            const content = typeof remoteTask?.body?.content === 'string' ? remoteTask.body.content : '';
	            const normalized = normalizeText(content);
	            updates.description = normalized ? normalized : null;
	          }
	          if (Object.prototype.hasOwnProperty.call(remoteTask || {}, 'dueDateTime')) {
	            updates.due_date = fromGraphDueDateTime(remoteTask?.dueDateTime);
	          }
	          if (Object.prototype.hasOwnProperty.call(remoteTask || {}, 'importance')) {
	            updates.priority = toLocalPriority(remoteTask?.importance);
	          }
	          if (Object.prototype.hasOwnProperty.call(remoteTask || {}, 'status')) {
	            const isCompleted = remoteTask?.status === 'completed';
	            updates.is_completed = isCompleted;
	            if (isCompleted) {
	              const completedAt = toIsoTimestamp(remoteTask?.completedDateTime?.dateTime);
	              updates.completed_at = completedAt || localTask.completed_at || new Date().toISOString();
	            } else {
	              updates.completed_at = null;
	            }
	          }

	          const { data: updatedLocalTask, error: updateError } = await supabase
	            .from('tasks')
	            .update(updates)
            .eq('id', localTask.id)
            .eq('user_id', userId)
            .select('*')
            .single();

          if (updateError) {
            console.warn('Office365 pull: failed to update local task:', updateError);
          } else {
            localTasksById.set(localTask.id, updatedLocalTask);
            pulledUpdatedTasks += 1;

            await supabase
              .from('projects')
              .update({ updated_at: new Date().toISOString() })
              .eq('id', updatedLocalTask.project_id);

            if (remoteEtag && remoteEtag !== existingMapping.etag) {
              const { data: updatedMapping, error: mappingUpdateError } = await supabase
                .from('office365_task_items')
                .update({ etag: remoteEtag, updated_at: new Date().toISOString() })
                .eq('id', existingMapping.id)
                .select('*')
                .single();

              if (!mappingUpdateError && updatedMapping) {
                taskMapByTaskId.set(updatedMapping.task_id, updatedMapping);
                taskMapByTodoTaskId.set(updatedMapping.todo_task_id, updatedMapping);
              }
            }
          }

          continue;
        }
      } else if (remoteEtag && remoteEtag !== existingMapping.etag) {
        const { data: updatedMapping, error: mappingUpdateError } = await supabase
          .from('office365_task_items')
          .update({ etag: remoteEtag, updated_at: new Date().toISOString() })
          .eq('id', existingMapping.id)
          .select('*')
          .single();

        if (!mappingUpdateError && updatedMapping) {
          taskMapByTaskId.set(updatedMapping.task_id, updatedMapping);
          taskMapByTodoTaskId.set(updatedMapping.todo_task_id, updatedMapping);
        }
      }
    }
  }

  // Delete local tasks for items removed remotely (two-way deletes).
  for (const mapping of taskMaps || []) {
    if (!activeProjectIds.has(mapping.project_id)) continue;
    if (!remoteTodoTaskIds.has(mapping.todo_task_id)) {
      const localTask = localTasksById.get(mapping.task_id);
      if (!localTask) continue;

      const existsRemotely = await todoTaskExists({
        accessToken,
        listId: mapping.list_id,
        todoTaskId: mapping.todo_task_id,
      }).catch((err) => {
        console.warn('Office365 pull: unable to confirm remote deletion:', err);
        return true;
      });
      if (existsRemotely) continue;

      const { error: deleteError } = await supabase
        .from('tasks')
        .delete()
        .eq('id', localTask.id)
        .eq('user_id', userId);

      if (deleteError) {
        console.warn('Office365 pull: failed to delete local task:', deleteError);
        continue;
      }

      pulledDeletedTasks += 1;
      localTasksById.delete(localTask.id);

      await supabase
        .from('projects')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', localTask.project_id);
    }
  }

  // Push local tasks -> Office 365 (only when different).
  const tasksAfterPull = Array.from(localTasksById.values());
  const desiredTasksAfterPull = tasksAfterPull.filter((task) => activeProjectIds.has(task.project_id));

  for (const task of desiredTasksAfterPull) {
    const projectMap = projectMapByProjectId.get(task.project_id);
    if (!projectMap) continue;

    const listId = projectMap.list_id;
    if (!listId) continue;

    const mapping = taskMapByTaskId.get(task.id) || null;
    const remoteTasks = remoteTasksByListId.get(listId) || [];
    const remoteTask = mapping?.todo_task_id
      ? remoteTasks.find((item) => item?.id === mapping.todo_task_id) || null
      : null;

    if (mapping && mapping.list_id !== listId) {
      try {
        await deleteTodoTask({ accessToken, listId: mapping.list_id, todoTaskId: mapping.todo_task_id });
      } catch (err) {
        // Ignore.
      }

      const payload = buildTodoTaskPayload(task);
      const created = await createTodoTask({ accessToken, listId, payload });
      const todoTaskId = created?.id;
      if (!todoTaskId) throw new Error('Office365 task creation did not return an id');

      const { data: updatedMapping, error: mappingError } = await supabase
        .from('office365_task_items')
        .update({
          project_id: task.project_id,
          list_id: listId,
          todo_task_id: todoTaskId,
          etag: created?.['@odata.etag'] || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', mapping.id)
        .select('*')
        .single();
      if (mappingError) throw mappingError;

      taskMapByTaskId.set(task.id, updatedMapping);
      taskMapByTodoTaskId.set(updatedMapping.todo_task_id, updatedMapping);
      pushedCreatedTasks += 1;
      continue;
    }

    if (!mapping) {
      const payload = buildTodoTaskPayload(task);
      const created = await createTodoTask({ accessToken, listId, payload });
      const todoTaskId = created?.id;
      if (!todoTaskId) throw new Error('Office365 task creation did not return an id');

      const { data: mappingRow, error: mappingError } = await supabase
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
      if (mappingError) throw mappingError;

      taskMapByTaskId.set(task.id, mappingRow);
      taskMapByTodoTaskId.set(todoTaskId, mappingRow);
      pushedCreatedTasks += 1;
      continue;
    }

    if (!remoteTask) {
      const payload = buildTodoTaskPayload(task);
      const created = await createTodoTask({ accessToken, listId, payload });
      const todoTaskId = created?.id;
      if (!todoTaskId) throw new Error('Office365 task creation did not return an id');

      const { data: updatedMapping, error: mappingError } = await supabase
        .from('office365_task_items')
        .update({
          project_id: task.project_id,
          list_id: listId,
          todo_task_id: todoTaskId,
          etag: created?.['@odata.etag'] || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', mapping.id)
        .select('*')
        .single();
      if (mappingError) throw mappingError;

      taskMapByTaskId.set(task.id, updatedMapping);
      taskMapByTodoTaskId.set(updatedMapping.todo_task_id, updatedMapping);
      pushedCreatedTasks += 1;
      continue;
    }

    if (tasksMatch(task, remoteTask)) continue;

    const localMs = toTimestampMs(task.updated_at || task.created_at);
    const remoteMs = toTimestampMs(remoteTask.lastModifiedDateTime || remoteTask.createdDateTime);
    if (remoteMs > localMs) {
      continue;
    }

    const payload = buildTodoTaskPayload(task);
    try {
      const updated = await updateTodoTask({
        accessToken,
        listId,
        todoTaskId: mapping.todo_task_id,
        payload,
      });

      const nextEtag = updated?.['@odata.etag'] || mapping.etag || null;
      const { data: updatedMapping, error: mappingUpdateError } = await supabase
        .from('office365_task_items')
        .update({
          project_id: task.project_id,
          etag: nextEtag,
          updated_at: new Date().toISOString(),
        })
        .eq('id', mapping.id)
        .select('*')
        .single();

      if (!mappingUpdateError && updatedMapping) {
        taskMapByTaskId.set(task.id, updatedMapping);
        taskMapByTodoTaskId.set(updatedMapping.todo_task_id, updatedMapping);
      }

      pushedUpdatedTasks += 1;
    } catch (err) {
      const message = String(err?.message || '');
      if (message.includes('(404)')) {
        // Remote item missing; will be recreated on next sync.
        continue;
      }
      throw err;
    }
  }

  // Remove stale task mappings (and delete remote tasks) for local deletions or inactive projects.
  for (const mapping of taskMaps || []) {
    if (desiredTaskIds.has(mapping.task_id)) continue;
    try {
      await deleteTodoTask({ accessToken, listId: mapping.list_id, todoTaskId: mapping.todo_task_id });
    } catch (err) {
      // Ignore.
    }
    await supabase.from('office365_task_items').delete().eq('id', mapping.id);
  }

  // Remove stale project mappings (and delete remote lists) for local deletions or inactive projects.
  for (const mapping of projectMaps || []) {
    if (desiredProjectIds.has(mapping.project_id)) continue;
    try {
      await deleteTodoList({ accessToken, listId: mapping.list_id });
    } catch (err) {
      // Ignore.
    }
    await supabase.from('office365_project_lists').delete().eq('id', mapping.id);
    await supabase.from('office365_task_items').delete().eq('user_id', userId).eq('project_id', mapping.project_id);
  }

  await supabase
    .from('office365_connections')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('user_id', userId);

  return {
    createdLists,
    createdTasks: pushedCreatedTasks,
    updatedTasks: pushedUpdatedTasks,
    pulledCreatedTasks,
    pulledUpdatedTasks,
    pulledDeletedTasks,
    totalProjects: projects?.length || 0,
    totalTasks: tasks?.length || 0,
  };
}

export async function maybeAutoSyncOffice365({
  userId,
  minIntervalMinutes = 2,
  reason,
} = {}) {
  if (!userId) return { skipped: 'missing-user' };

  const connection = await getOffice365Connection({ userId });
  if (!connection?.sync_enabled) return { skipped: 'not-connected' };

  const lastSyncedAt = connection.last_synced_at ? new Date(connection.last_synced_at).getTime() : 0;
  const minutesSince = lastSyncedAt ? (Date.now() - lastSyncedAt) / 60000 : Number.POSITIVE_INFINITY;
  if (Number.isFinite(minIntervalMinutes) && minIntervalMinutes > 0 && minutesSince < minIntervalMinutes) {
    return { skipped: 'recent', minutesSince };
  }

  try {
    const result = await syncOffice365All({ userId });
    return { synced: true, ...result };
  } catch (err) {
    const label = reason ? ` (${reason})` : '';
    console.warn(`Office365 auto-sync failed${label}:`, err);
    return { synced: false, error: String(err?.message || err) };
  }
}

export async function syncOffice365Project({ userId, projectId }) {
  const supabase = getSupabaseServiceRole();

  const { data: project, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .eq('user_id', userId)
    .single();
  if (error) throw error;

  if (!isProjectActive(project.status)) {
    await deleteOffice365Project({ userId, projectId });
    return;
  }

  const accessToken = await getValidOffice365AccessToken({ userId });

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

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, name, status')
    .eq('id', task.project_id)
    .eq('user_id', userId)
    .single();

  if (projectError) throw projectError;

  if (!isProjectActive(project.status)) {
    // Project is not eligible for sync; ensure task is removed remotely if it exists.
    const { data: existingMapping } = await supabase
      .from('office365_task_items')
      .select('*')
      .eq('user_id', userId)
      .eq('task_id', task.id)
      .maybeSingle();

    if (existingMapping?.id) {
      try {
        await deleteTodoTask({ accessToken, listId: existingMapping.list_id, todoTaskId: existingMapping.todo_task_id });
      } catch (err) {
        // Ignore.
      }
      await supabase.from('office365_task_items').delete().eq('id', existingMapping.id);
    }

    await supabase
      .from('office365_connections')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('user_id', userId);

    return;
  }

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
