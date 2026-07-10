import { sortTasksByPriority } from '@/lib/taskSort';
import { computeSortOrder } from '@/lib/sortOrder';
import { getLondonDateKey } from '@/lib/timezone';
import {
  SOFT_CAPS,
  STALE_BACKLOG_DAYS,
  REVIEW_BACKLOG_CAP,
  STATE,
  TODAY_SECTION,
  TASK_TYPE,
} from '@/lib/constants';

// A3 — Morning Autopilot rule engine.
//
// buildAutopilotPlan fetches the eligible Today-candidate pool (the same
// population the daily planning modal draws from), ranks it with the F1
// comparator, and assigns tasks into the three Today sections respecting the
// per-section soft caps. It is pure of HTTP: it takes a user-scoped Supabase
// service-role client and a windowDate (today's London date), and never logs
// secrets.
//
// SINGLE-SOURCE-OF-TRUTH NOTE: the pool below deliberately MIRRORS the daily
// candidate filters in src/app/api/planning-candidates/route.js (carried,
// inbox, due<=window, undated this_week, ageing undated backlog — all
// snooze-aware, none already in Today/Done). It is implemented self-contained
// here rather than extracted, so the route's output stays byte-for-byte
// identical (extraction is a follow-up). Because the buckets are unioned and
// de-duplicated by id, the route's cross-bucket exclusions (carried_section /
// inbox) are unnecessary here — the SET is the same either way.

// The app has no formal `task_type: 'quick'` value. These short-effort types are
// treated as Quick Wins by the autopilot; a task_type outside this set (or none)
// is not a quick win. Adjust here if the product later defines "quick"
// differently — this is the single place the classification lives.
const QUICK_WIN_TASK_TYPES = new Set([
  TASK_TYPE.ADMIN,
  TASK_TYPE.REPLY_CHASE,
  TASK_TYPE.FIX,
]);

// Lean projection — enough for the F1 comparator (due_date, chips,
// entered_state_at, sort_order, created_at, name, id), the section routing
// (task_type), and the placement update (id).
const POOL_SELECT =
  'id, name, due_date, state, today_section, sort_order, task_type, chips, entered_state_at, created_at';

// Normalise any date/timestamp value to a lexically-comparable YYYY-MM-DD key.
function toDateKey(value) {
  if (!value) return null;
  const key = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

function isQuickWinType(taskType) {
  return typeof taskType === 'string' && QUICK_WIN_TASK_TYPES.has(taskType);
}

/**
 * Determine the natural Today section for a task relative to windowDate.
 *   - overdue (due < window) or due-today (due === window) → Must Do
 *   - quick-win task_type → Quick Wins
 *   - everything else (later-dated, undated, non-quick) → Good to Do
 * There is NO overflow between sections: a task whose natural section is full is
 * left untouched (surfaces in the digest/modal as usual), never bumped elsewhere.
 *
 * @param {object} task
 * @param {string} windowDate - YYYY-MM-DD
 * @returns {'must_do'|'good_to_do'|'quick_wins'}
 */
function naturalSection(task, windowDate) {
  const due = toDateKey(task?.due_date);
  if (due && windowDate && due <= windowDate) return TODAY_SECTION.MUST_DO;
  if (isQuickWinType(task?.task_type)) return TODAY_SECTION.QUICK_WINS;
  return TODAY_SECTION.GOOD_TO_DO;
}

/**
 * De-duplicate a task list by id, preserving first occurrence.
 * @param {object[]} tasks
 * @returns {object[]}
 */
function dedupeById(tasks = []) {
  const seen = new Set();
  const out = [];
  for (const task of tasks) {
    const id = task?.id;
    if (id == null) {
      out.push(task);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(task);
  }
  return out;
}

/**
 * PURE section-assignment. Ranks the pool with the F1 comparator, then routes
 * each task to its natural Today section respecting per-section soft caps
 * (capacity = cap − tasks already in that section). No IO.
 *
 * @param {object[]} pool - candidate task rows (de-duplication is the caller's job)
 * @param {object} options
 * @param {string} options.windowDate - YYYY-MM-DD reference "today"
 * @param {{must_do?:number,good_to_do?:number,quick_wins?:number}} [options.existingCounts]
 *   number of tasks already occupying each Today section
 * @param {{MUST_DO:number,GOOD_TO_DO:number,QUICK_WINS:number}} [options.caps]
 * @returns {{ placements: Array<{id:string, section:string, task:object}>,
 *             placed: {must_do:number, good_to_do:number, quick_wins:number},
 *             leftOver: number }}
 */
export function assignAutopilotSections(pool = [], { windowDate, existingCounts = {}, caps = SOFT_CAPS } = {}) {
  const ranked = sortTasksByPriority(pool, { todayKey: windowDate });

  // Remaining capacity per section — never below zero (an over-cap section
  // simply accepts nothing).
  const remaining = {
    [TODAY_SECTION.MUST_DO]: Math.max(0, (caps.MUST_DO ?? SOFT_CAPS.MUST_DO) - (existingCounts.must_do || 0)),
    [TODAY_SECTION.GOOD_TO_DO]: Math.max(0, (caps.GOOD_TO_DO ?? SOFT_CAPS.GOOD_TO_DO) - (existingCounts.good_to_do || 0)),
    [TODAY_SECTION.QUICK_WINS]: Math.max(0, (caps.QUICK_WINS ?? SOFT_CAPS.QUICK_WINS) - (existingCounts.quick_wins || 0)),
  };

  const placements = [];
  const placed = { must_do: 0, good_to_do: 0, quick_wins: 0 };
  let leftOver = 0;

  for (const task of ranked) {
    const section = naturalSection(task, windowDate);
    if (remaining[section] > 0) {
      remaining[section] -= 1;
      placed[section] += 1;
      placements.push({ id: task.id, section, task });
    } else {
      leftOver += 1;
    }
  }

  return { placements, placed, leftOver };
}

/**
 * Fetch the eligible Today-candidate pool (mirrors the daily planning-candidate
 * filters). Union of six snooze-aware buckets, none already in Today/Done:
 *   0. Carried from Today (this_week + carried_section set)
 *   1. Inbox awaiting triage (inbox = true)
 *   2. Due today (due_date === windowDate)
 *   3. Overdue (due_date < windowDate)
 *   4. Undated this_week
 *   5. Ageing undated backlog (entered_state_at older than STALE_BACKLOG_DAYS),
 *      capped at REVIEW_BACKLOG_CAP
 * De-duplicated by id.
 *
 * @param {{ supabase:any, userId:string, windowDate:string }}
 * @returns {Promise<object[]>}
 */
async function fetchAutopilotPool({ supabase, userId, windowDate }) {
  // Snooze filter (F2): a task is only a candidate when not snoozed past the
  // window. windowDate is validated YYYY-MM-DD upstream, so it is safe to
  // interpolate here (same as the candidate route).
  const snoozeFilter = `snoozed_until.is.null,snoozed_until.lte.${windowDate}`;

  // F4 ageing cutoff — derived from windowDate (noon UTC to sidestep DST edges),
  // subtract STALE_BACKLOG_DAYS-1 so a strict `.lt` includes tasks aged EXACTLY
  // STALE_BACKLOG_DAYS days. Mirrors the candidate route exactly.
  const staleThreshold = new Date(windowDate + 'T12:00:00Z');
  staleThreshold.setUTCDate(staleThreshold.getUTCDate() - (STALE_BACKLOG_DAYS - 1));
  const staleThresholdDate = staleThreshold.toISOString().slice(0, 10);

  const [carried, inbox, dueToday, overdue, undated, reviewBacklog] = await Promise.all([
    supabase
      .from('tasks')
      .select(POOL_SELECT)
      .eq('user_id', userId)
      .eq('state', STATE.THIS_WEEK)
      .not('carried_section', 'is', null)
      .eq('inbox', false)
      .or(snoozeFilter),

    supabase
      .from('tasks')
      .select(POOL_SELECT)
      .eq('user_id', userId)
      .eq('inbox', true)
      .not('state', 'in', '("today","done")')
      .or(snoozeFilter),

    supabase
      .from('tasks')
      .select(POOL_SELECT)
      .eq('user_id', userId)
      .eq('due_date', windowDate)
      .eq('inbox', false)
      .not('state', 'in', '("today","done")')
      .or(snoozeFilter),

    supabase
      .from('tasks')
      .select(POOL_SELECT)
      .eq('user_id', userId)
      .lt('due_date', windowDate)
      .eq('inbox', false)
      .not('state', 'in', '("today","done")')
      .or(snoozeFilter),

    supabase
      .from('tasks')
      .select(POOL_SELECT)
      .eq('user_id', userId)
      .eq('state', STATE.THIS_WEEK)
      .is('due_date', null)
      .eq('inbox', false)
      .or(snoozeFilter),

    supabase
      .from('tasks')
      .select(POOL_SELECT)
      .eq('user_id', userId)
      .eq('state', STATE.BACKLOG)
      .eq('inbox', false)
      .is('due_date', null)
      .lt('entered_state_at', staleThresholdDate)
      .or(snoozeFilter)
      .order('entered_state_at', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(REVIEW_BACKLOG_CAP),
  ]);

  const buckets = [carried, inbox, dueToday, overdue, undated, reviewBacklog];
  const firstError = buckets.find((b) => b?.error)?.error;
  if (firstError) {
    // A partial pool would build a wrong plan, so a fetch failure is hard: fail
    // the whole run rather than silently under-plan.
    throw new Error(`fetchAutopilotPool: candidate query failed: ${firstError.message || firstError}`);
  }

  return dedupeById(buckets.flatMap((b) => b?.data || []));
}

/**
 * Build today's plan for one user: fetch the eligible pool, rank it (F1), and
 * assign into the Today sections respecting soft caps. Placed tasks get
 * state='today', their section, an append sort_order, and autoplanned_at=now.
 * Tasks already in Today are left in place but count against their section cap.
 *
 * Placement uses DIRECT service-role updates (not taskService.updateTask) so
 * autoplanned_at — a server-managed field absent from TASK_UPDATE_FIELDS — can
 * be stamped, and so a bulk morning placement does not fire per-task Office365
 * sync. It touches exactly four fields; entered_state_at is stamped by the DB
 * state trigger. Naturally idempotent: a second run finds the placed tasks in
 * 'today' (excluded from the pool) with the caps already consumed, so it places
 * nothing new.
 *
 * @param {{ supabase:any, userId:string, windowDate:string }}
 * @returns {Promise<{ placed:{must_do:number,good_to_do:number,quick_wins:number},
 *                     leftOver:number, failures:string[] }>}
 */
export async function buildAutopilotPlan({ supabase, userId, windowDate }) {
  if (!supabase) throw new Error('buildAutopilotPlan: supabase is required');
  if (!userId) throw new Error('buildAutopilotPlan: userId is required');
  if (!windowDate || !/^\d{4}-\d{2}-\d{2}$/.test(windowDate)) {
    throw new Error('buildAutopilotPlan: windowDate must be YYYY-MM-DD');
  }

  // 1. Tasks already in Today occupy cap capacity and seed the per-section
  //    append sort_order (so placements land at the end of each section).
  const { data: todayRows, error: todayError } = await supabase
    .from('tasks')
    .select('id, today_section, sort_order')
    .eq('user_id', userId)
    .eq('state', STATE.TODAY);
  if (todayError) {
    throw new Error(`buildAutopilotPlan: failed to fetch Today tasks: ${todayError.message || todayError}`);
  }

  const existingCounts = { must_do: 0, good_to_do: 0, quick_wins: 0 };
  const sectionSeed = { must_do: null, good_to_do: null, quick_wins: null };
  for (const row of todayRows || []) {
    const section = row?.today_section;
    if (existingCounts[section] !== undefined) existingCounts[section] += 1;
    if (section && row?.sort_order != null && (sectionSeed[section] == null || row.sort_order > sectionSeed[section])) {
      sectionSeed[section] = row.sort_order;
    }
  }

  // 2. Fetch and rank the eligible pool; assign to sections respecting caps.
  const pool = await fetchAutopilotPool({ supabase, userId, windowDate });
  const { placements } = assignAutopilotSections(pool, { windowDate, existingCounts });

  // 3. Apply placements. Append sort_order per section, stepping from the
  //    current max in that section by a gap per task.
  const nowIso = new Date().toISOString();
  const seeds = { ...sectionSeed };
  const applied = { must_do: 0, good_to_do: 0, quick_wins: 0 };
  const failures = [];
  let leftOver = 0;

  for (const { id, section } of placements) {
    seeds[section] = computeSortOrder(seeds[section], null);
    const { error } = await supabase
      .from('tasks')
      .update({
        state: STATE.TODAY,
        today_section: section,
        sort_order: seeds[section],
        autoplanned_at: nowIso,
        // Placing a task into Today IS a triage decision, so an auto-placed
        // inbox item is no longer "awaiting triage" — clear the flag so the
        // digest doesn't list it as both scheduled and inbox.
        inbox: false,
      })
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      failures.push(`${id}: ${error.message || 'update failed'}`);
    } else {
      applied[section] += 1;
    }
  }

  // leftOver = pool tasks that did not fit under a cap (re-derive so an update
  // failure is reported as a failure, not silently folded into leftOver).
  leftOver = pool.length - placements.length;

  return { placed: applied, leftOver, failures };
}

/**
 * Undo the auto-plan: move every task that is still purely auto-placed (has
 * autoplanned_at set AND is still state='today') back to This Week, clearing
 * autoplanned_at. A manual re-triage clears autoplanned_at (taskService), so any
 * task the user has since touched no longer qualifies and is left alone. The DB
 * state trigger clears today_section on the move; demoted tasks append to the
 * end of This Week (their Today sort_order is meaningless in the new column).
 *
 * @param {{ supabase:any, userId:string }}
 * @returns {Promise<{ cleared:number, failures:string[] }>}
 */
export async function clearAutopilotPlan({ supabase, userId }) {
  if (!supabase) throw new Error('clearAutopilotPlan: supabase is required');
  if (!userId) throw new Error('clearAutopilotPlan: userId is required');

  const { data: rows, error } = await supabase
    .from('tasks')
    .select('id, autoplanned_at')
    .eq('user_id', userId)
    .eq('state', STATE.TODAY)
    .not('autoplanned_at', 'is', null);
  if (error) {
    throw new Error(`clearAutopilotPlan: failed to fetch auto-placed tasks: ${error.message || error}`);
  }

  // Only undo TODAY's auto-plan. A Must Do auto-added on a prior day and kept
  // (carried) since has an older autoplanned_at and must stay in Today.
  const todayKey = getLondonDateKey();
  const ids = (rows || [])
    .filter((r) => r.autoplanned_at && getLondonDateKey(new Date(r.autoplanned_at)) === todayKey)
    .map((r) => r.id)
    .filter(Boolean);
  if (ids.length === 0) return { cleared: 0, failures: [] };

  // Seed the append order from the current max This Week sort_order.
  const { data: maxRow } = await supabase
    .from('tasks')
    .select('sort_order')
    .eq('user_id', userId)
    .eq('state', STATE.THIS_WEEK)
    .not('sort_order', 'is', null)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  let order = maxRow?.sort_order ?? null;

  let cleared = 0;
  const failures = [];
  for (const id of ids) {
    order = computeSortOrder(order, null);
    // Re-assert state='today' AND autoplanned_at not null in the WHERE so a task
    // the user touched between the read and the write is not clobbered.
    const { data, error: updErr } = await supabase
      .from('tasks')
      .update({ state: STATE.THIS_WEEK, autoplanned_at: null, sort_order: order })
      .eq('id', id)
      .eq('user_id', userId)
      .eq('state', STATE.TODAY)
      .not('autoplanned_at', 'is', null)
      .select('id')
      .maybeSingle();

    if (updErr) {
      failures.push(`${id}: ${updErr.message || 'update failed'}`);
    } else if (data?.id) {
      cleared += 1;
    }
  }

  return { cleared, failures };
}
