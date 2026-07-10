import { STATE, TODAY_SECTION, PROJECT_STATUS } from '@/lib/constants';
import { validateTask } from '@/lib/validators';
import { handleSupabaseError } from '@/lib/errorHandler';
import { computeSortOrder } from '@/lib/sortOrder';
import { deleteOffice365Task, syncOffice365Task } from '@/services/office365SyncService';

const TASK_UPDATE_FIELDS = new Set([
  'name',
  'description',
  'due_date',
  'state',
  'today_section',
  'sort_order',
  'area',
  'task_type',
  'chips',
  'waiting_reason',
  'follow_up_date',
  'project_id',
  // First-class snooze (F2): snoozed_until is client-writable. snooze_count is
  // deliberately NOT here — it is server-managed (see updateTask) so a client
  // can never inflate or reset the escalation counter.
  'snoozed_until',
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

// FF-029: allowlist for create. Server owns user_id and state; id, timestamps,
// completed_at, entered_state_at and source_idea_id are never client-settable
// (source_idea_id is only ever set by promoteIdea after an ownership check).
const TASK_CREATE_FIELDS = new Set([
  'name',
  'description',
  'due_date',
  'state',
  'today_section',
  'sort_order',
  'area',
  'task_type',
  'chips',
  'waiting_reason',
  'follow_up_date',
  'project_id',
  // Capture inbox (F3): inbox is client-settable ONLY at create time, so the
  // three capture entry points (plain quick-capture, idea promotion, Office365
  // inbound pull) can mark a freshly captured task as awaiting triage. It is
  // deliberately absent from TASK_UPDATE_FIELDS — clients can never flip it; it
  // is cleared only by the server triage rule in updateTask.
  'inbox',
]);

function filterTaskCreate(fields = {}) {
  const filtered = {};
  Object.entries(fields).forEach(([key, value]) => {
    if (TASK_CREATE_FIELDS.has(key)) {
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

/**
 * Compute an append sort_order (max within the target bucket + gap) server-side.
 * Buckets are keyed by state, and additionally by today_section for today tasks.
 * Returns a value that places the task at the end of the bucket, or null if the
 * lookup fails (leaving sort_order untouched).
 */
async function computeAppendSortOrder({ supabase, userId, state, todaySection }) {
  let query = supabase
    .from('tasks')
    .select('sort_order')
    .eq('user_id', userId)
    .eq('state', state)
    .not('sort_order', 'is', null);

  if (state === STATE.TODAY) {
    query = todaySection
      ? query.eq('today_section', todaySection)
      : query.is('today_section', null);
  }

  const { data, error } = await query
    .order('sort_order', { ascending: false })
    .limit(1);

  if (error) return null;
  const max = data && data.length > 0 ? data[0].sort_order : null;
  return computeSortOrder(max, null); // max + gap, or gap when the bucket is empty
}

const TASK_SELECT_FIELDS = 'id, name, description, due_date, state, today_section, sort_order, area, task_type, chips, waiting_reason, follow_up_date, project_id, user_id, completed_at, entered_state_at, source_idea_id, snoozed_until, snooze_count, inbox, carried_count, carried_section, created_at, updated_at';

export async function createTask({ supabase, userId, payload, options = {} }) {
  // Map camelCase frontend fields to snake_case DB columns
  const { projectId, dueDate, ...rest } = payload || {};
  const normalized = {
    ...rest,
    ...(projectId !== undefined && { project_id: projectId }),
    ...(dueDate !== undefined && { due_date: dueDate }),
  };

  // FF-029: allowlist client-supplied columns so mass assignment cannot set
  // user_id, id, timestamps or source_idea_id. Legacy fields (priority,
  // importance_score, urgency_score, is_completed, job) are dropped implicitly.
  const taskData = filterTaskCreate(normalized);
  taskData.user_id = userId;
  taskData.state = taskData.state || STATE.BACKLOG;

  // When state = 'today' and no today_section provided, default to 'good_to_do'
  if (taskData.state === STATE.TODAY && !taskData.today_section) {
    taskData.today_section = TODAY_SECTION.GOOD_TO_DO;
  }

  // Normalize area
  taskData.area = normalizeArea(taskData.area);

  // Set entered_state_at for initial state (the DB trigger also stamps this on
  // insert; this keeps the returned row consistent when the trigger is absent).
  taskData.entered_state_at = new Date().toISOString();

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

  // First-class snooze (F2): snooze_count is server-managed. Increment it
  // read-modify-write from the already-fetched existingTask (mirrors the
  // sort_order append below) only when the update sets a *new* non-null
  // snooze date — i.e. the task was not already snoozed to that exact value.
  // Clearing the snooze (snoozed_until = null) never changes the count.
  if (Object.prototype.hasOwnProperty.call(updatesToApply, 'snoozed_until')) {
    const newSnooze = updatesToApply.snoozed_until;
    const alreadySnoozedToSame = newSnooze != null && newSnooze === existingTask.snoozed_until;
    if (newSnooze != null && !alreadySnoozedToSame) {
      updatesToApply.snooze_count = (existingTask.snooze_count || 0) + 1;
    }
  }

  // Capture inbox (F3): a freshly captured task carries inbox=true so it is
  // guaranteed exactly one triage moment. Clear the flag the instant the task is
  // genuinely triaged — i.e. this update makes a real placement decision:
  // it changes state (state -> done also counts, so completing clears it),
  // today_section, due_date, or snoozed_until. A plain rename / area /
  // description edit leaves the task untriaged, so its inbox flag must survive.
  // inbox is not in TASK_UPDATE_FIELDS, so a client can never set or clear it
  // directly — only this server rule does.
  if (existingTask.inbox) {
    const triageChanged = (field) =>
      Object.prototype.hasOwnProperty.call(updatesToApply, field) &&
      updatesToApply[field] !== existingTask[field];
    const triaged =
      triageChanged('state') ||
      triageChanged('today_section') ||
      triageChanged('due_date') ||
      triageChanged('snoozed_until');
    if (triaged) {
      updatesToApply.inbox = false;
    }
  }

  // Carry-forward reset (A1): a genuine re-triage — the user changing the task's
  // state, or explicitly (re)placing it into a today_section — is a fresh
  // placement, so the evening carry-forward markers are wiped. This is what makes
  // the planning modal's "Keep yesterday's plan" one-tap restore
  // ({ state:'today', today_section: carried_section }) leave a clean row: the
  // state change fires this reset, clearing carried_section/carried_count.
  // carried_count and carried_section are server-managed (deliberately absent from
  // TASK_UPDATE_FIELDS), so only this rule and the evening cron's direct writes
  // ever touch them — the cron writes them DIRECTLY (not via updateTask) precisely
  // so its increment is not immediately undone by this reset.
  const stateReTriaged =
    Object.prototype.hasOwnProperty.call(updatesToApply, 'state') &&
    updatesToApply.state !== existingTask.state;
  const sectionReTriaged =
    Object.prototype.hasOwnProperty.call(updatesToApply, 'today_section') &&
    updatesToApply.today_section != null;
  if (stateReTriaged || sectionReTriaged) {
    updatesToApply.carried_count = 0;
    updatesToApply.carried_section = null;
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

    // completed_at is owned exclusively by the DB trigger fn_task_state_cleanup,
    // which stamps it on the transition into 'done' (preserving any supplied
    // value via COALESCE) and clears it on the transition out. The app layer no
    // longer writes completed_at — that avoids re-stamping an already-done task
    // (FF-020) and prevents a client making a done task invisible (FF-025).
  }

  // When a task moves into a new live (ordered) state, append it to the end of
  // the target bucket by computing sort_order server-side (FF-035). This removes
  // the racy client-side max+1 read the planning modal used to do. Skipped when:
  //  - the caller supplied an explicit sort_order (drag reorders own the value),
  //  - the state is unchanged (section-only moves keep their drag-set order), or
  //  - the target state is 'done' (not display-ordered by sort_order).
  const stateChanging = 'state' in updatesToApply && updatesToApply.state !== existingTask.state;
  const finalState = 'state' in updatesToApply ? updatesToApply.state : existingTask.state;
  if (
    stateChanging &&
    finalState !== STATE.DONE &&
    !Object.prototype.hasOwnProperty.call(updatesToApply, 'sort_order')
  ) {
    const finalSection = finalState === STATE.TODAY
      ? ('today_section' in updatesToApply ? updatesToApply.today_section : existingTask.today_section)
      : null;
    const appendOrder = await computeAppendSortOrder({
      supabase,
      userId,
      state: finalState,
      todaySection: finalSection || null,
    });
    if (appendOrder != null) {
      updatesToApply.sort_order = appendOrder;
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
