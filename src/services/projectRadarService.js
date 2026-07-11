import { PROJECT_STATUS, STATE } from '@/lib/constants';
import { getLondonDateKey } from '@/lib/timezone';

// Wave 5 — project-altitude radar. Tasks can no longer get lost (Waves 1–2),
// but a whole PROJECT can still silently stall: every one of its tasks sits
// undated in Backlog, or it has no tasks at all, so nothing will ever pull it
// forward. This raises the altitude from tasks to projects and surfaces the
// open projects that have no scheduled next action. Rules-only, computed from
// existing project + task data — no migration, no new columns, no secrets.

// A project's tasks are "terminal" once done — they can never be the next
// action. Non-terminal project statuses are the only ones on the radar.
// Active statuses that can be "stalled" (actively worked, so they need a next
// action). On Hold is non-terminal but a deliberate pause, so it is shown as
// paused, never stalled.
const STALLABLE_STATUSES = new Set([PROJECT_STATUS.OPEN, PROJECT_STATUS.IN_PROGRESS]);
const NON_TERMINAL_STATUSES = new Set([
  PROJECT_STATUS.OPEN,
  PROJECT_STATUS.IN_PROGRESS,
  PROJECT_STATUS.ON_HOLD,
]);

// Normalise a date column (date or timestamp) to a YYYY-MM-DD key, or null.
function toDateKey(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

// Milliseconds for a timestamp string, or null when missing/unparseable. Used
// only to compare "when did anything last happen here" — never for display.
function toMs(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

// An incomplete task is a SCHEDULED next action when it is planned for Today or
// This Week, OR it carries a due date, OR it is a 'waiting' task with a set
// follow-up date. An undated Backlog task is NOT a next action — nothing will
// pull it forward on its own, which is exactly the stall we surface.
function isScheduledNextAction(task) {
  if (!task) return false;
  const state = task.state;
  if (state === STATE.TODAY || state === STATE.THIS_WEEK) return true;
  if (task.due_date != null) return true;
  if (state === STATE.WAITING && task.follow_up_date != null) return true;
  return false;
}

/**
 * PURE builder: one radar row per NON-TERMINAL project (status Open or On Hold;
 * Completed/Cancelled are dropped). Sorted stalled-first, then by lastActivityAt
 * ascending so the most-neglected project is at the top.
 *
 * @param {object} input
 * @param {Array<object>} [input.projects] project rows: { id, name, status, area, due_date, updated_at }.
 * @param {Record<string, Array<object>>} [input.tasksByProject] incomplete tasks keyed by project id:
 *        each { state, due_date, follow_up_date, updated_at }.
 * @param {number} [input.nowMs] current time in ms — anchors the "future" in nextDueDate.
 * @returns {Array<{ projectId, name, status, area, dueDate, hasNextAction, openTaskCount,
 *          nextDueDate, lastActivityAt, stalled, paused }>}
 */
export function buildProjectRadar({ projects = [], tasksByProject = {}, nowMs = Date.now() } = {}) {
  const todayKey = getLondonDateKey(new Date(nowMs));

  const rows = [];
  for (const project of projects) {
    if (!project || !NON_TERMINAL_STATUSES.has(project.status)) continue;

    const projectTasks = tasksByProject[project.id] || [];
    // Defensive: the IO layer only loads incomplete tasks, but the pure builder
    // must not count a 'done' row even if a caller hands one in.
    const incompleteTasks = projectTasks.filter((t) => t && t.state !== STATE.DONE);

    const hasNextAction = incompleteTasks.some(isScheduledNextAction);
    const openTaskCount = incompleteTasks.length;

    // nextDueDate: the earliest today-or-future due date among incomplete tasks,
    // falling back to the earliest due date overall when none are upcoming.
    let earliestFuture = null;
    let earliestAny = null;
    for (const task of incompleteTasks) {
      const key = toDateKey(task.due_date);
      if (!key) continue;
      if (earliestAny === null || key < earliestAny) earliestAny = key;
      if (key >= todayKey && (earliestFuture === null || key < earliestFuture)) {
        earliestFuture = key;
      }
    }
    const nextDueDate = earliestFuture ?? earliestAny;

    // lastActivityAt: most recent of the project's updated_at and its tasks'
    // updated_at — "when did anything happen here". Keep the original string of
    // the winning timestamp so callers render it however they like.
    let lastActivityAt = project.updated_at || null;
    let lastActivityMs = toMs(project.updated_at);
    for (const task of projectTasks) {
      const taskMs = toMs(task?.updated_at);
      if (taskMs !== null && (lastActivityMs === null || taskMs > lastActivityMs)) {
        lastActivityMs = taskMs;
        lastActivityAt = task.updated_at;
      }
    }

    const paused = project.status === PROJECT_STATUS.ON_HOLD;
    // Stalled = an Open project with no scheduled next action. On Hold is a
    // deliberate pause, so it is flagged 'paused' but never 'stalled'.
    const stalled = STALLABLE_STATUSES.has(project.status) && !hasNextAction;

    rows.push({
      projectId: project.id,
      name: project.name || null,
      status: project.status,
      area: project.area || null,
      dueDate: toDateKey(project.due_date),
      hasNextAction,
      openTaskCount,
      nextDueDate,
      lastActivityAt,
      stalled,
      paused,
    });
  }

  // Stalled first, then most-neglected (oldest lastActivityAt) first. A missing
  // lastActivityAt reads as maximally neglected, so it sorts to the top.
  rows.sort((a, b) => {
    if (a.stalled !== b.stalled) return a.stalled ? -1 : 1;
    const aMs = toMs(a.lastActivityAt);
    const bMs = toMs(b.lastActivityAt);
    const aKey = aMs === null ? -Infinity : aMs;
    const bKey = bMs === null ? -Infinity : bMs;
    return aKey - bKey;
  });

  return rows;
}

// Run a query and degrade to a failure signal on any error/throw. Unlike a
// plain "return []" this distinguishes "query failed" from "genuinely empty",
// so a failed sub-query can collapse the whole radar to empty rather than
// falsely flagging every open project as stalled (a task-query failure would
// otherwise make every project look like it has no tasks).
async function safeQuery(queryFn) {
  try {
    const { data, error } = await queryFn();
    if (error) return { ok: false, data: [] };
    return { ok: true, data: data || [] };
  } catch {
    return { ok: false, data: [] };
  }
}

/**
 * IO fetcher: load the user's non-terminal projects and their incomplete tasks
 * (one query each, scoped by user_id), aggregate per project, and hand them to
 * the pure builder. Resilient — if EITHER sub-query fails, the whole radar
 * degrades to an empty result rather than throwing or raising false alarms.
 *
 * @param {object} input
 * @param {object} input.supabase service-role client (already user-scoped by user_id here).
 * @param {string} input.userId the user whose projects to report on.
 * @param {number} [input.nowMs] current time in ms.
 * @returns {Promise<{ projects: Array, stalledCount: number }>}
 */
export async function fetchProjectRadar({ supabase, userId, nowMs = Date.now() }) {
  if (!supabase) throw new Error('fetchProjectRadar: supabase is required');
  if (!userId) throw new Error('fetchProjectRadar: userId is required');

  const EMPTY = { projects: [], stalledCount: 0 };

  const [projectsResult, tasksResult] = await Promise.all([
    safeQuery(() =>
      supabase
        .from('projects')
        .select('id, name, status, area, due_date, updated_at')
        .eq('user_id', userId)
        .in('status', [PROJECT_STATUS.OPEN, PROJECT_STATUS.IN_PROGRESS, PROJECT_STATUS.ON_HOLD])
    ),
    safeQuery(() =>
      supabase
        .from('tasks')
        .select('project_id, state, due_date, follow_up_date, updated_at')
        .eq('user_id', userId)
        .neq('state', STATE.DONE)
    ),
  ]);

  // A failed sub-query returns an empty radar rather than a misleading one.
  if (!projectsResult.ok || !tasksResult.ok) return EMPTY;

  const tasksByProject = {};
  for (const task of tasksResult.data) {
    if (!task?.project_id) continue;
    if (!tasksByProject[task.project_id]) tasksByProject[task.project_id] = [];
    tasksByProject[task.project_id].push(task);
  }

  const rows = buildProjectRadar({ projects: projectsResult.data, tasksByProject, nowMs });
  const stalledCount = rows.reduce((count, row) => (row.stalled ? count + 1 : count), 0);

  return { projects: rows, stalledCount };
}
