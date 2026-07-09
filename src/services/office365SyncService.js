import { fromZonedTime } from 'date-fns-tz';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { office365GraphRequest } from '@/lib/office365/graph';
import { getLondonDateKey } from '@/lib/timezone';
import { getOffice365Connection, getValidOffice365AccessToken } from '@/services/office365ConnectionService';

const TODO_TASK_SELECT_FULL = [
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

const TODO_TASK_SELECT_MINIMAL = [
  'id',
  'title',
  'status',
  'importance',
  'dueDateTime',
  'createdDateTime',
  'lastModifiedDateTime',
].join(',');

function isProjectActive(status) {
  const normalized = typeof status === 'string' ? status.trim().toLowerCase() : '';
  return normalized === 'open' || normalized === 'in progress' || normalized === 'on hold';
}

// Priority mapping removed: the local model uses `state` (not priority/importance).
// Graph importance is always sent as 'normal' on outbound; inbound importance is ignored.

function toGraphDueDateTime(dueDate) {
  if (!dueDate) return null;
  // Supabase returns DATE columns as `YYYY-MM-DD` strings.
  const dateString = String(dueDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return null;

  // Use midday UTC to reduce off-by-one issues across time zones.
  return { dateTime: `${dateString}T12:00:00`, timeZone: 'UTC' };
}

// Graph returns a due date as a wall-clock `dateTime` paired with a `timeZone`.
// When the zone is a named, non-UTC zone we must resolve the wall-clock time in
// that zone to an absolute instant and then read its Europe/London calendar
// date — otherwise a task created in Outlook/To Do under another zone can land a
// day early (FF-039). Returns a `YYYY-MM-DD` key, or null if the zone is
// unrecognised (Graph can send Windows zone names, which Intl cannot parse).
function convertGraphDateTimeToLondonDateKey(rawDateTime, timeZone) {
  try {
    // Graph wall-clock strings look like `2026-07-09T00:00:00.0000000`; take the
    // zoneless `YYYY-MM-DDTHH:MM:SS` portion before resolving it in `timeZone`.
    const wallClock = String(rawDateTime).slice(0, 19);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(wallClock)) return null;
    const instant = fromZonedTime(wallClock, timeZone);
    if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) return null;
    return getLondonDateKey(instant);
  } catch {
    return null;
  }
}

export function fromGraphDueDateTime(dueDateTime) {
  const raw = dueDateTime?.dateTime;
  if (!raw) return null;

  // If the zone is absent or UTC, preserve the existing behaviour: the outbound
  // path writes noon UTC (see toGraphDueDateTime), which round-trips safely, so
  // slicing the date component is correct for our own writes.
  const timeZone = typeof dueDateTime?.timeZone === 'string' ? dueDateTime.timeZone.trim() : '';
  if (timeZone && timeZone.toUpperCase() !== 'UTC') {
    const converted = convertGraphDateTimeToLondonDateKey(raw, timeZone);
    if (converted) return converted;
    // Unrecognised zone — fall through to the plain slice below.
  }

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
    // importance is always 'normal' — we no longer map local priority to Graph importance.
    importance: 'normal',
    status: task?.state === 'done' ? 'completed' : 'notStarted',
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
  } else {
    // Treat missing body as null so local description changes still propagate.
    result.description = null;
  }
  if (Object.prototype.hasOwnProperty.call(task, 'dueDateTime')) {
    result.dueDate = fromGraphDueDateTime(task.dueDateTime);
  } else {
    // If Graph omits dueDateTime, treat it as null so we can push local due dates.
    result.dueDate = null;
  }
  // importance is intentionally excluded from the normalised remote task — we no longer
  // sync priority between Graph and local, so it must not influence tasksMatch().
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

function makeTodoTaskKey({ listId, todoTaskId }) {
  if (!listId || !todoTaskId) return null;
  return `${listId}::${todoTaskId}`;
}

function isUniqueConstraintError(error) {
  const code = String(error?.code || '');
  if (code === '23505') return true;
  const message = String(error?.message || '').toLowerCase();
  return message.includes('duplicate key') || message.includes('unique constraint');
}

async function dedupeTaskMappings({ supabase, userId, taskMaps }) {
  const maps = Array.isArray(taskMaps) ? taskMaps : [];
  const mappingsByRemoteKey = new Map();

  for (const mapping of maps) {
    const key = makeTodoTaskKey({ listId: mapping?.list_id, todoTaskId: mapping?.todo_task_id });
    if (!key) continue;
    if (!mappingsByRemoteKey.has(key)) mappingsByRemoteKey.set(key, []);
    mappingsByRemoteKey.get(key).push(mapping);
  }

  let removedDuplicateMappings = 0;

  for (const rows of mappingsByRemoteKey.values()) {
    if (rows.length <= 1) continue;

    rows.sort((a, b) => {
      const aMs = toTimestampMs(a?.updated_at || a?.created_at);
      const bMs = toTimestampMs(b?.updated_at || b?.created_at);
      return bMs - aMs;
    });

    for (const duplicate of rows.slice(1)) {
      const { error } = await supabase
        .from('office365_task_items')
        .delete()
        .eq('id', duplicate.id)
        .eq('user_id', userId);

      if (error) {
        console.warn('Office365 sync: failed to remove duplicate task mapping:', error);
        continue;
      }

      removedDuplicateMappings += 1;
    }
  }

  if (!removedDuplicateMappings) {
    return { taskMaps: maps, removedDuplicateMappings: 0 };
  }

  const { data: refreshedMaps, error: refreshedMapsError } = await supabase
    .from('office365_task_items')
    .select('*')
    .eq('user_id', userId);
  if (refreshedMapsError) throw refreshedMapsError;

  return {
    taskMaps: refreshedMaps || [],
    removedDuplicateMappings,
  };
}

function buildTodoTaskPayload(task) {
  const dueDateTime = toGraphDueDateTime(task.due_date);
  const payload = {
    title: task.name,
    // importance is always 'normal' — we no longer map local data to Graph importance.
    importance: 'normal',
    status: task.state === 'done' ? 'completed' : 'notStarted',
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
  const listIdVariants = [encodeURIComponent(listId), listId];
  const queryVariants = [
    `?$top=100&$select=${TODO_TASK_SELECT_FULL}`,
    `?$top=100&$select=${TODO_TASK_SELECT_MINIMAL}`,
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

async function fetchTodoTask({ accessToken, listId, todoTaskId }) {
  const listIdVariants = [encodeURIComponent(listId), listId];
  const encodedTodoTaskId = encodeURIComponent(todoTaskId);
  const queryVariants = [
    `?$select=${TODO_TASK_SELECT_FULL}`,
    `?$select=${TODO_TASK_SELECT_MINIMAL}`,
    '',
  ];

  let lastError = null;
  for (const listIdValue of listIdVariants) {
    for (const query of queryVariants) {
      const path = `/me/todo/lists/${listIdValue}/tasks/${encodedTodoTaskId}${query}`;
      try {
        return await office365GraphRequest({
          accessToken,
          method: 'GET',
          path,
        });
      } catch (err) {
        lastError = err;
        const message = String(err?.message || '');
        if (message.includes('(400)') && message.includes('ParseUri')) {
          continue;
        }
        if (message.includes('(404)')) {
          continue;
        }
        throw err;
      }
    }
  }

  throw lastError || new Error('Office365 fetchTodoTask failed');
}

function hasTaskField(task, field) {
  return Object.prototype.hasOwnProperty.call(task || {}, field);
}

function shouldFetchFullRemoteTask(remoteTask) {
  if (!remoteTask) return false;
  return (
    !hasTaskField(remoteTask, 'body') ||
    !hasTaskField(remoteTask, 'completedDateTime') ||
    !hasTaskField(remoteTask, 'dueDateTime')
  );
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

async function ensureProjectList({ supabase, accessToken, userId, project, existingMap, recreatedListIds }) {
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

        // FF-012: the remote list was deleted, so every office365_task_items row
        // for it points at a list that no longer exists. Drop those stale
        // mappings so the tasks are re-pushed to the recreated list on this same
        // sync, and record the old list id so the two-way delete pass does NOT
        // misread the vanished list as per-task remote deletions and hard-delete
        // the local tasks. Never let a recreated list cause local task loss.
        const oldListId = current.list_id;
        if (oldListId) {
          const { error: mappingCleanupError } = await supabase
            .from('office365_task_items')
            .delete()
            .eq('user_id', userId)
            .eq('list_id', oldListId);
          if (mappingCleanupError) {
            console.warn('Office365 sync: failed to clear task mappings for recreated list:', mappingCleanupError);
          }
          recreatedListIds?.add(oldListId);
        }

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

// FF-041: hard per-user serialisation for the whole sync.
//
// The every-minute cron, the fire-and-forget auto-sync fired by GET /api/tasks,
// and per-mutation syncs can otherwise overlap and create duplicate remote
// tasks/lists (Graph creates are not idempotent). A Postgres session/advisory
// lock cannot be held across the sync because supabase-js speaks to PostgREST
// over pooled, per-request transactions, so we claim a lock ROW in the existing
// cron_runs table at the top of the sync and release it in a finally block.
//
// The lock lives in one stable slot per user (`operation` carries the user id;
// `run_date` is a fixed sentinel so the mutex never rolls over at midnight). A
// stale claim left by a crashed run can be stolen after SYNC_LOCK_TTL_MS so a
// single hard crash cannot wedge syncing forever. Any unexpected lock error
// fails open — a broken lock must never stop syncing outright.
const SYNC_LOCK_OPERATION_PREFIX = 'office365-sync-lock:';
const SYNC_LOCK_RUN_DATE = '1970-01-01';
const SYNC_LOCK_TTL_MS = 10 * 60 * 1000;

async function acquireSyncLock({ supabase, userId }) {
  const operation = `${SYNC_LOCK_OPERATION_PREFIX}${userId}`;
  try {
    const { data, error } = await supabase
      .from('cron_runs')
      .insert({ operation, run_date: SYNC_LOCK_RUN_DATE, status: 'claimed' })
      .select('id, created_at')
      .single();

    if (!error) {
      return { acquired: true, lockId: data?.id || null, createdAt: data?.created_at || null, operation };
    }

    if (isUniqueConstraintError(error)) {
      // Another run holds the lock — unless it is stale, in which case steal it.
      const { data: existing, error: fetchError } = await supabase
        .from('cron_runs')
        .select('id, created_at')
        .eq('operation', operation)
        .eq('run_date', SYNC_LOCK_RUN_DATE)
        .maybeSingle();
      if (fetchError) throw fetchError;
      if (!existing) {
        // Row vanished between insert and read; let the next tick retry cleanly.
        return { acquired: false, reason: 'race' };
      }

      const ageMs = Date.now() - new Date(existing.created_at).getTime();
      if (!(Number.isFinite(ageMs) && ageMs > SYNC_LOCK_TTL_MS)) {
        return { acquired: false, reason: 'held' };
      }

      // Conditional update on the observed created_at makes the steal atomic: if
      // a concurrent run stole it first, no row matches and we back off.
      const stealCreatedAt = new Date().toISOString();
      const { data: stolen, error: stealError } = await supabase
        .from('cron_runs')
        .update({ created_at: stealCreatedAt, status: 'claimed', error: null })
        .eq('id', existing.id)
        .eq('created_at', existing.created_at)
        .select('id, created_at')
        .maybeSingle();
      if (stealError) throw stealError;
      if (stolen?.id) {
        return { acquired: true, lockId: stolen.id, createdAt: stolen.created_at || stealCreatedAt, operation, stolen: true };
      }
      return { acquired: false, reason: 'held' };
    }

    if (String(error.message || '').toLowerCase().includes('does not exist')) {
      // No cron_runs table (e.g. a fresh environment): fail open.
      return { acquired: true, lockId: null, operation, unlocked: true };
    }

    throw error;
  } catch (err) {
    console.warn('Office365 sync: failed to acquire per-user lock, proceeding unlocked:', err);
    return { acquired: true, lockId: null, operation, unlocked: true };
  }
}

async function releaseSyncLock({ supabase, lock }) {
  if (!lock || !lock.lockId) return;
  try {
    // Ownership-guarded delete: only remove the lock if we still hold it. If
    // another run stole it after our TTL lapsed (bumping created_at), this
    // matches no row and we leave their live lock intact (FF-041 steal race).
    let query = supabase.from('cron_runs').delete().eq('id', lock.lockId);
    if (lock.createdAt) query = query.eq('created_at', lock.createdAt);
    await query;
  } catch (err) {
    console.warn('Office365 sync: failed to release per-user lock:', err);
  }
}

export async function syncOffice365All({ userId }) {
  const supabase = getSupabaseServiceRole();

  // FF-041: serialise the whole sync per user; skip if another run holds the lock.
  const lock = await acquireSyncLock({ supabase, userId });
  if (!lock.acquired) {
    return { skipped: 'locked' };
  }

  try {
    return await performFullSync({ supabase, userId });
  } finally {
    await releaseSyncLock({ supabase, lock });
  }
}

async function performFullSync({ supabase, userId }) {
  const connection = await getOffice365Connection({ userId });
  const lastSyncedMs = toTimestampMs(connection?.last_synced_at);
  const hasLastSync = Boolean(connection?.last_synced_at);
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

  const { data: rawTaskMaps, error: taskMapsError } = await supabase
    .from('office365_task_items')
    .select('*')
    .eq('user_id', userId);
  if (taskMapsError) throw taskMapsError;

  const { taskMaps, removedDuplicateMappings } = await dedupeTaskMappings({
    supabase,
    userId,
    taskMaps: rawTaskMaps,
  });

  const projectMapByProjectId = new Map((projectMaps || []).map((row) => [row.project_id, row]));
  const taskMapByTaskId = new Map((taskMaps || []).map((row) => [row.task_id, row]));
  const taskMapByTodoTaskKey = new Map();
  for (const mapping of taskMaps || []) {
    const key = makeTodoTaskKey({ listId: mapping.list_id, todoTaskId: mapping.todo_task_id });
    if (!key) continue;
    taskMapByTodoTaskKey.set(key, mapping);
  }

  const desiredProjectIds = new Set(activeProjects.map((p) => p.id));
  const desiredTaskIds = new Set(desiredTasks.map((t) => t.id));

  let createdLists = 0;
  let pushedCreatedTasks = 0;
  let pushedUpdatedTasks = 0;
  let pulledCreatedTasks = 0;
  let pulledUpdatedTasks = 0;
  let pulledDeletedTasks = 0;
  // FF-001: surface pull-side insert failures in the summary instead of only
  // console.warn, so a broken import is visible rather than silent.
  let pullFailedTasks = 0;
  // FF-012: list ids whose remote To Do list was deleted (404) and recreated on
  // this run. Their old task mappings have been purged in the DB; the two-way
  // delete pass must skip them so local tasks are re-pushed, not deleted.
  const recreatedListIds = new Set();

  for (const project of activeProjects) {
    const before = projectMapByProjectId.get(project.id);
    const ensured = await ensureProjectList({
      supabase,
      accessToken,
      userId,
      project,
      existingMap: projectMapByProjectId,
      recreatedListIds,
    });
    if (!before && ensured) {
      createdLists += 1;
    }
  }

  // FF-012: for any list recreated after a remote 404, drop its now-stale task
  // mappings from the in-memory maps too (they were deleted in the DB by
  // ensureProjectList). This makes the push phase treat those tasks as unmapped
  // and re-create them on the new list rather than updating a deleted mapping.
  if (recreatedListIds.size > 0) {
    for (const [taskId, mapping] of taskMapByTaskId) {
      if (recreatedListIds.has(mapping.list_id)) {
        taskMapByTaskId.delete(taskId);
        const staleKey = makeTodoTaskKey({ listId: mapping.list_id, todoTaskId: mapping.todo_task_id });
        if (staleKey) taskMapByTodoTaskKey.delete(staleKey);
      }
    }
  }

  const remoteTasksByListId = new Map();
  const remoteTodoTaskKeys = new Set();
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
      const remoteTodoKey = makeTodoTaskKey({ listId, todoTaskId: remoteTask?.id });
      if (remoteTodoKey) remoteTodoTaskKeys.add(remoteTodoKey);
    }

    for (const remoteTask of remoteTasks) {
      const remoteTodoId = remoteTask?.id;
      if (!remoteTodoId) continue;
      const remoteTodoKey = makeTodoTaskKey({ listId, todoTaskId: remoteTodoId });
      if (!remoteTodoKey) continue;

      const existingMapping = taskMapByTodoTaskKey.get(remoteTodoKey) || null;
      if (!existingMapping) {
        const projectId = projectMapping.project_id;
        if (!projectId) continue;

        const remoteIsCompleted = remoteTask?.status === 'completed';
        const payload = {
          user_id: userId,
          project_id: projectId,
          name: remoteTask.title || 'New task',
          description: remoteTask?.body?.content ? String(remoteTask.body.content) : null,
          // FF-040: due_date is nullable — store NULL when the remote task has no
          // dueDateTime rather than fabricating today's date, which would lose
          // conflict resolution and get PATCHed back onto Microsoft.
          due_date: fromGraphDueDateTime(remoteTask?.dueDateTime),
          // FF-001: map Graph status to a VALID local state. 'todo' violates
          // tasks_state_check (today/this_week/backlog/waiting/done); use
          // 'backlog'. Inbound importance is ignored (no local priority field).
          state: remoteIsCompleted ? 'done' : 'backlog',
          completed_at:
            remoteIsCompleted
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
          // FF-001: count the failure so a broken import surfaces in the summary.
          pullFailedTasks += 1;
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
          if (isUniqueConstraintError(mappingError)) {
            const { data: existingRemoteMapping, error: existingRemoteMappingError } = await supabase
              .from('office365_task_items')
              .select('*')
              .eq('user_id', userId)
              .eq('list_id', listId)
              .eq('todo_task_id', remoteTodoId)
              .maybeSingle();

            if (!existingRemoteMappingError && existingRemoteMapping) {
              const { error: deleteCreatedTaskError } = await supabase
                .from('tasks')
                .delete()
                .eq('id', createdTask.id)
                .eq('user_id', userId);

              if (deleteCreatedTaskError) {
                console.warn('Office365 pull: failed to clean up raced local task:', deleteCreatedTaskError);
              }

              taskMapByTaskId.set(existingRemoteMapping.task_id, existingRemoteMapping);
              const existingRemoteKey = makeTodoTaskKey({
                listId: existingRemoteMapping.list_id,
                todoTaskId: existingRemoteMapping.todo_task_id,
              });
              if (existingRemoteKey) {
                taskMapByTodoTaskKey.set(existingRemoteKey, existingRemoteMapping);
              }
              continue;
            }
          }

          // FF-042: any other mapping failure (a non-unique error, or a unique
          // violation with no adoptable existing row) would strand an unmapped
          // local task that duplicates the remote task on the next sync. Roll
          // the just-created local task back so no orphan remains.
          const { error: cleanupError } = await supabase
            .from('tasks')
            .delete()
            .eq('id', createdTask.id)
            .eq('user_id', userId);
          if (cleanupError) {
            console.warn('Office365 pull: failed to roll back local task after mapping failure:', cleanupError);
          }
          pullFailedTasks += 1;
          console.warn('Office365 pull: failed to create mapping:', mappingError);
          continue;
        }

        taskMapByTaskId.set(createdTask.id, mappingRow);
        taskMapByTodoTaskKey.set(remoteTodoKey, mappingRow);
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
      let remoteMs = toTimestampMs(remoteTask.lastModifiedDateTime || remoteTask.createdDateTime);
      const localChangedSinceSync = hasLastSync ? localMs > lastSyncedMs : true;
      const remoteChangedSinceSync =
        (remoteEtag && remoteEtag !== existingMapping.etag) ||
        (hasLastSync && remoteMs > lastSyncedMs);

      let remoteDetails = remoteTask;
      const shouldFetchRemoteDetails =
        shouldFetchFullRemoteTask(remoteTask) &&
        (remoteChangedSinceSync || remoteMs > localMs || !localChangedSinceSync);
      if (shouldFetchRemoteDetails) {
        try {
          const fetched = await fetchTodoTask({
            accessToken,
            listId,
            todoTaskId: remoteTodoId,
          });
          if (fetched) {
            remoteDetails = fetched;
            const refreshedRemoteMs = toTimestampMs(
              remoteDetails.lastModifiedDateTime || remoteDetails.createdDateTime,
            );
            if (refreshedRemoteMs) {
              remoteMs = refreshedRemoteMs;
            }
          }
        } catch (err) {
          console.warn('Office365 pull: failed to fetch full task details:', err);
        }
      }

      if (!tasksMatch(localTask, remoteDetails)) {
        const shouldPullRemote =
          !localChangedSinceSync || (remoteMs && remoteMs > localMs);

        if (shouldPullRemote) {
          const updates = {
            updated_at: toIsoTimestamp(remoteDetails?.lastModifiedDateTime || remoteDetails?.createdDateTime) || new Date().toISOString(),
          };

            if (Object.prototype.hasOwnProperty.call(remoteDetails || {}, 'title')) {
              updates.name = remoteDetails.title || localTask.name;
            }
            if (Object.prototype.hasOwnProperty.call(remoteDetails || {}, 'body')) {
              const content = typeof remoteDetails?.body?.content === 'string' ? remoteDetails.body.content : '';
              const normalized = normalizeText(content);
              updates.description = normalized ? normalized : null;
            }
            if (Object.prototype.hasOwnProperty.call(remoteDetails || {}, 'dueDateTime')) {
              updates.due_date = fromGraphDueDateTime(remoteDetails?.dueDateTime);
            }
            // inbound importance is intentionally ignored — we do not write priority from Graph.
            if (Object.prototype.hasOwnProperty.call(remoteDetails || {}, 'status')) {
              const remoteCompleted = remoteDetails?.status === 'completed';
              if (remoteCompleted) {
                // Only mark done when Graph says completed; preserve existing local state otherwise.
                updates.state = 'done';
                const completedAt = toIsoTimestamp(remoteDetails?.completedDateTime?.dateTime);
                updates.completed_at = completedAt || localTask.completed_at || new Date().toISOString();
              }
              // If Graph status is not 'completed', do NOT overwrite local state — the user may have
              // set it to 'in-progress' or similar, which Graph has no equivalent for.
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
                  const updatedMappingKey = makeTodoTaskKey({
                    listId: updatedMapping.list_id,
                    todoTaskId: updatedMapping.todo_task_id,
                  });
                  if (updatedMappingKey) {
                    taskMapByTodoTaskKey.set(updatedMappingKey, updatedMapping);
                  }
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
          const updatedMappingKey = makeTodoTaskKey({
            listId: updatedMapping.list_id,
            todoTaskId: updatedMapping.todo_task_id,
          });
          if (updatedMappingKey) {
            taskMapByTodoTaskKey.set(updatedMappingKey, updatedMapping);
          }
        }
      }
    }
  }

  // Delete local tasks for items removed remotely (two-way deletes).
  for (const mapping of taskMaps || []) {
    if (!activeProjectIds.has(mapping.project_id)) continue;
    // FF-012: never delete local tasks because their remote LIST was deleted.
    // A recreated list means the tasks should be re-pushed, not destroyed.
    if (recreatedListIds.has(mapping.list_id)) continue;
    const mappingRemoteKey = makeTodoTaskKey({
      listId: mapping.list_id,
      todoTaskId: mapping.todo_task_id,
    });
    if (!mappingRemoteKey || !remoteTodoTaskKeys.has(mappingRemoteKey)) {
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
      const updatedMappingKey = makeTodoTaskKey({
        listId: updatedMapping.list_id,
        todoTaskId: updatedMapping.todo_task_id,
      });
      if (updatedMappingKey) {
        taskMapByTodoTaskKey.set(updatedMappingKey, updatedMapping);
      }
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
      const mappingRowKey = makeTodoTaskKey({ listId: mappingRow.list_id, todoTaskId: mappingRow.todo_task_id });
      if (mappingRowKey) {
        taskMapByTodoTaskKey.set(mappingRowKey, mappingRow);
      }
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
      const updatedMappingKey = makeTodoTaskKey({
        listId: updatedMapping.list_id,
        todoTaskId: updatedMapping.todo_task_id,
      });
      if (updatedMappingKey) {
        taskMapByTodoTaskKey.set(updatedMappingKey, updatedMapping);
      }
      pushedCreatedTasks += 1;
      continue;
    }

    const localMs = toTimestampMs(task.updated_at || task.created_at);
    const localChangedSinceSync = lastSyncedMs ? localMs > lastSyncedMs : true;

    let remoteDetails = remoteTask;
    if (remoteDetails && localChangedSinceSync && shouldFetchFullRemoteTask(remoteDetails)) {
      try {
        const fetched = await fetchTodoTask({
          accessToken,
          listId,
          todoTaskId: mapping.todo_task_id,
        });
        if (fetched) {
          remoteDetails = fetched;
        }
      } catch (err) {
        console.warn('Office365 push: failed to fetch full task details:', err);
      }
    }

    if (tasksMatch(task, remoteDetails)) continue;

    if (!localChangedSinceSync) {
      continue;
    }

    const remoteMs = toTimestampMs(remoteDetails?.lastModifiedDateTime || remoteDetails?.createdDateTime);
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
        const updatedMappingKey = makeTodoTaskKey({
          listId: updatedMapping.list_id,
          todoTaskId: updatedMapping.todo_task_id,
        });
        if (updatedMappingKey) {
          taskMapByTodoTaskKey.set(updatedMappingKey, updatedMapping);
        }
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
    pullFailedTasks,
    dedupedTaskMappings: removedDuplicateMappings,
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
