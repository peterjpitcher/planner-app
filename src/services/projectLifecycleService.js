import { PROJECT_STATUS, STATE, CLOSED_STATES, ACTIVE_STATES } from '@/lib/constants';
import { callRpc } from '@/lib/rpc';

/**
 * Project lifecycle.
 *
 * A project status change is not just a label: closing a project has to do
 * something about the work still sitting under it. Before this existed, the
 * status was written and the tasks were left live, so a cancelled project's
 * tasks kept appearing in Today, the Plan board, planning candidates, the
 * autopilot pool and the daily digest, while the project itself vanished from
 * the project list. Office365 sync already deleted those tasks remotely, so the
 * two systems actively disagreed.
 *
 * Closing now also moves the project's notes onto the customer's record, writes
 * an optional close-out note, and can add key facts. That is five tables in one
 * operation, and separate Supabase client calls are separate PostgREST requests
 * and therefore separate transactions. A JavaScript function is not a
 * transaction boundary, so the work happens in Postgres functions and this
 * module is the typed way in.
 *
 * See docs/superpowers/specs/2026-09-01-customers-crm-design.md section 7.
 */

// Statuses that close a project, mapped to the terminal state their open tasks
// inherit. Completing a project completes its work; cancelling abandons it.
const CLOSING_STATUS_TO_TASK_STATE = {
  [PROJECT_STATUS.COMPLETED]: STATE.DONE,
  [PROJECT_STATUS.CANCELLED]: STATE.CANCELLED,
};

/**
 * @param {string} status
 * @returns {boolean} true when the status closes the project.
 */
export function isClosingStatus(status) {
  return Object.prototype.hasOwnProperty.call(CLOSING_STATUS_TO_TASK_STATE, status);
}

/**
 * The terminal state a closing status sends its open tasks to.
 *
 * @param {string} status
 * @returns {string|null}
 */
export function taskStateForClosingStatus(status) {
  return CLOSING_STATUS_TO_TASK_STATE[status] ?? null;
}

/**
 * Fetch the open (non-closed) tasks for a project.
 *
 * Used to preview the cascade in the confirmation dialog, so the list the user
 * approves is the list that gets changed.
 *
 * @returns {Promise<{data?: Array<object>, error?: object}>}
 */
export async function getOpenProjectTasks({ supabase, userId, projectId }) {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, name, state, due_date')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .in('state', ACTIVE_STATES)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (error) {
    return { error: { status: 500, message: error.message || 'Unable to load project tasks' } };
  }
  return { data: data || [] };
}

/** Tasks the cancelled project's reopen would actually restore. */
export async function getReopeningProjectTasks({ supabase, userId, projectId, status }) {
  if (status !== PROJECT_STATUS.CANCELLED) return { data: [] };
  const { data, error } = await supabase.from('tasks')
    .select('id, name, state, due_date')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .eq('state', STATE.CANCELLED)
    .not('lifecycle_move_id', 'is', null)
    .order('created_at', { ascending: true });
  if (error) return { error: { status: 500, message: 'Unable to load tasks for reopening' } };
  return { data: data || [] };
}

/**
 * Apply a project status change and everything that follows from it.
 *
 * Closing runs `close_project`: the status, the task cascade, the note handover
 * to the customer, the close-out note and any key facts, in one transaction.
 * Reopening runs `reopen_project`, which restores only the tasks and notes that
 * close moved.
 *
 * Neither is done with client-side updates any more. The previous version wrote
 * the project first and cascaded second, and carried an explicit partial-failure
 * response (`projectUpdated: true`) because there was no way to make the two
 * atomic. Adding notes and facts to that pattern would have multiplied the
 * number of half-done states.
 *
 * @param {object} params
 * @param {string} params.previousStatus status before the change.
 * @param {string} params.nextStatus status after the change.
 * @param {string} [params.closeoutNote] optional note to pin against the customer.
 * @param {Array<{label: string, value: string}>} [params.facts] optional key facts.
 * @returns {Promise<{data?: object, error?: object}>}
 */
export async function changeProjectStatus({
  supabase,
  userId,
  projectId,
  previousStatus,
  nextStatus,
  closeoutNote = null,
  facts = null,
}) {
  if (previousStatus === nextStatus) {
    return { data: { tasksChanged: 0, taskState: null, notesMoved: 0 } };
  }

  if (isClosingStatus(nextStatus)) {
    const { data, error } = await callRpc(supabase, 'close_project', {
      p_project_id: projectId,
      p_user_id: userId,
      p_status: nextStatus,
      p_closeout_note: closeoutNote,
      p_facts: facts && facts.length > 0 ? facts : null,
    });

    if (error) return { error };

    return {
      data: {
        tasksChanged: data?.tasksChanged ?? 0,
        taskState: data?.taskState ?? taskStateForClosingStatus(nextStatus),
        notesMoved: data?.notesMoved ?? 0,
        factsAdded: data?.factsAdded ?? 0,
        closeoutNoteId: data?.closeoutNoteId ?? null,
        customerId: data?.customerId ?? null,
      },
    };
  }

  // Reopening. Only meaningful when the project was closed; moving between two
  // live statuses (Open to On Hold, say) changes nothing about its work.
  if (isClosingStatus(previousStatus)) {
    const { data, error } = await callRpc(supabase, 'reopen_project', {
      p_project_id: projectId,
      p_user_id: userId,
      p_status: nextStatus,
    });

    if (error) return { error };

    return {
      data: {
        tasksChanged: data?.tasksRestored ?? 0,
        taskState: (data?.tasksRestored ?? 0) > 0 ? STATE.BACKLOG : null,
        notesReturned: data?.notesReturned ?? 0,
      },
    };
  }

  const { data: updated, error } = await supabase
    .from('projects')
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq('id', projectId)
    .eq('user_id', userId)
    .eq('status', previousStatus)
    .select('id')
    .maybeSingle();

  if (error) return { error: { status: 500, message: 'Unable to update project status' } };
  if (!updated) return { error: { status: 409, message: 'Project status changed. Refresh and try again.' } };
  return { data: { tasksChanged: 0, taskState: null, notesMoved: 0 } };
}

/**
 * What deleting a project would affect.
 *
 * Reports what is **kept and where it goes**, not only what is destroyed.
 * notes.project_id used to be ON DELETE CASCADE, so a delete permanently
 * destroyed every note on the project and the dialog could only warn about it.
 * Now the notes move to the customer, or become unfiled when there is none, so
 * the dialog can say where they land.
 *
 * @returns {Promise<{data?: object, error?: object}>}
 */
export async function getProjectDeletionImpact({ supabase, userId, projectId }) {
  const closedFilter = `(${CLOSED_STATES.map((s) => `"${s}"`).join(',')})`;

  const [taskResult, noteResult, projectResult] = await Promise.all([
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .not('state', 'in', closedFilter),
    // Both the notes still on the project and the ones a previous close moved
    // onto the customer, because deleting the project rewrites the tombstone on
    // all of them.
    supabase
      .from('notes')
      .select('id, project_id, origin_project_id')
      .eq('user_id', userId)
      .or(`project_id.eq.${projectId},origin_project_id.eq.${projectId}`),
    supabase
      .from('projects')
      .select('id, name, customer_id')
      .eq('id', projectId)
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  if (taskResult.error || noteResult.error || projectResult.error) {
    const err = taskResult.error || noteResult.error || projectResult.error;
    return { error: { status: 500, message: err.message || 'Unable to load project impact' } };
  }

  let customerName = null;
  if (projectResult.data?.customer_id) {
    const { data: customer } = await supabase
      .from('customers')
      .select('name')
      .eq('id', projectResult.data.customer_id)
      .maybeSingle();
    customerName = customer?.name || null;
  }

  return {
    data: {
      taskCount: taskResult.count || 0,
      noteCount: (noteResult.data || []).length,
      customerId: projectResult.data?.customer_id || null,
      customerName,
    },
  };
}

/**
 * Delete a project without losing its notes.
 *
 * Runs `delete_project_preserving_content`, which stamps the tombstone on every
 * note the project owns or previously handed to a customer, re-parents them,
 * and only then deletes the project. Doing that as separate calls would leave a
 * window where the project is gone and the notes are not yet re-parented.
 *
 * @param {boolean} [params.destroyContent] explicit opt-in to delete the notes too.
 * @returns {Promise<{data?: object, error?: object}>}
 */
export async function deleteProjectPreservingContent({
  supabase,
  userId,
  projectId,
  destroyContent = false,
}) {
  const { data, error } = await callRpc(supabase, 'delete_project_preserving_content', {
    p_project_id: projectId,
    p_user_id: userId,
    p_destroy_content: Boolean(destroyContent),
  });

  if (error) return { error };
  return { data };
}
