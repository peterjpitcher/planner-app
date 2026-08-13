import { PROJECT_STATUS, STATE, CLOSED_STATES, ACTIVE_STATES } from '@/lib/constants';

/**
 * Project lifecycle cascade.
 *
 * A project status change is not just a label: closing a project has to do
 * something about the work still sitting under it. Before this existed, the
 * status was written and the tasks were left live, so a cancelled project's
 * tasks kept appearing in Today, the Plan board, planning candidates, the
 * autopilot pool and the daily digest, while the project itself vanished from
 * the project list. Office365 sync already deleted those tasks remotely, so the
 * two systems actively disagreed.
 *
 * The cascade lives in the service layer (called by the API route) rather than
 * in a component, so the rule holds for every caller: the projects page, a
 * direct API call, or anything added later.
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
 * Fetch the open (non-closed) tasks for a project.
 *
 * Used both to preview the cascade in the confirmation dialog and to perform
 * it, so the list the user approves is the list that gets changed.
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

/**
 * Apply the task cascade for a project status change.
 *
 * - Closing (Completed / Cancelled): open tasks move to the matching terminal
 *   state. completed_at / cancelled_at are stamped by fn_task_state_cleanup, so
 *   they are deliberately not written here.
 * - Reopening: tasks previously cancelled by the cascade return to backlog.
 *   Without this, reopening a project would leave its work invisible with no
 *   way to get it back. Tasks that were completed stay completed, since those
 *   were genuinely finished.
 *
 * @param {object} params
 * @param {string} params.previousStatus status before the change.
 * @param {string} params.nextStatus status after the change.
 * @returns {Promise<{data?: {tasksChanged: number, taskState: string|null}, error?: object}>}
 */
export async function cascadeProjectStatusToTasks({
  supabase,
  userId,
  projectId,
  previousStatus,
  nextStatus,
}) {
  if (previousStatus === nextStatus) {
    return { data: { tasksChanged: 0, taskState: null } };
  }

  // Closing the project: carry its open work into the matching terminal state.
  if (isClosingStatus(nextStatus)) {
    const taskState = CLOSING_STATUS_TO_TASK_STATE[nextStatus];
    const { data, error } = await supabase
      .from('tasks')
      .update({ state: taskState, updated_at: new Date().toISOString() })
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .in('state', ACTIVE_STATES)
      .select('id');

    if (error) {
      return { error: { status: 500, message: error.message || 'Unable to update project tasks' } };
    }
    return { data: { tasksChanged: (data || []).length, taskState } };
  }

  // Reopening a previously cancelled project: bring its cancelled tasks back.
  // Backlog rather than their original state, because the original is not
  // recorded and backlog is the safe landing spot that needs an explicit
  // decision before the task can reach Today.
  if (isClosingStatus(previousStatus) && previousStatus === PROJECT_STATUS.CANCELLED) {
    const { data, error } = await supabase
      .from('tasks')
      .update({ state: STATE.BACKLOG, updated_at: new Date().toISOString() })
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .eq('state', STATE.CANCELLED)
      .select('id');

    if (error) {
      return { error: { status: 500, message: error.message || 'Unable to restore project tasks' } };
    }
    return { data: { tasksChanged: (data || []).length, taskState: STATE.BACKLOG } };
  }

  return { data: { tasksChanged: 0, taskState: null } };
}

/**
 * Count what deleting a project would destroy.
 *
 * tasks.project_id is ON DELETE SET NULL (20260404000001), so tasks survive as
 * unassigned. notes.project_id is still ON DELETE CASCADE from the initial
 * schema, so project notes are destroyed permanently. The delete confirmation
 * has to say so, which means counting both.
 *
 * @returns {Promise<{data?: {taskCount: number, noteCount: number}, error?: object}>}
 */
export async function getProjectDeletionImpact({ supabase, userId, projectId }) {
  const [taskResult, noteResult] = await Promise.all([
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .not('state', 'in', `(${CLOSED_STATES.map((s) => `"${s}"`).join(',')})`),
    supabase
      .from('notes')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('user_id', userId),
  ]);

  if (taskResult.error || noteResult.error) {
    const err = taskResult.error || noteResult.error;
    return { error: { status: 500, message: err.message || 'Unable to load project impact' } };
  }

  return {
    data: {
      taskCount: taskResult.count || 0,
      noteCount: noteResult.count || 0,
    },
  };
}
