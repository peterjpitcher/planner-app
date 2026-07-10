import { LONDON_TIME_ZONE, getLondonDateKey } from '@/lib/timezone';
import { sortTasksByPriority } from '@/lib/taskSort';
import { SOFT_CAPS, TODAY_SECTION_ORDER, CARRY_NUDGE_THRESHOLD } from '@/lib/constants';
import { listIdeasDueForReview } from '@/services/ideaService';

// A4 — proposal-style morning digest. The email is a picture of the whole
// planned day (all three Today sections, incl. undated tasks) plus what needs a
// decision, not just already-dated Today tasks. It is READ-ONLY this wave: a
// single app link, no per-task action links.

// Number of rows shown per "Needs a decision" sub-list before it collapses to
// "+N more"; keeps a rich email from getting long.
const DECISION_LIST_CAP = 5;
// Same idea for the ideas-to-revisit list.
const IDEAS_CAP = 5;
// A 'waiting' task with no follow_up_date is stale once it has sat in state for
// more than this many days (spec: "> 7 days in state with no follow_up_date").
const WAITING_STALE_DAYS = 7;

// Sentence-case chip labels, mirroring the UI's ChipBadge so the email reads the
// same as the app.
const CHIP_LABELS = {
  high_impact: 'High impact',
  urgent: 'Urgent',
  blocks_others: 'Blocks others',
  stress_relief: 'Stress relief',
  only_i_can: 'Only I can',
};

// Section headers for "Your day" (plural "Quick Wins" for the header).
const SECTION_HEADER_LABELS = {
  must_do: 'Must Do',
  good_to_do: 'Good to Do',
  quick_wins: 'Quick Wins',
};

const SOFT_CAP_BY_SECTION = {
  must_do: SOFT_CAPS.MUST_DO,
  good_to_do: SOFT_CAPS.GOOD_TO_DO,
  quick_wins: SOFT_CAPS.QUICK_WINS,
};

function normalizeDueDate(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// Add whole days to a YYYY-MM-DD key using UTC arithmetic (handles rollover).
function addDaysToDateKey(dateKey, days) {
  if (!dateKey) return null;
  const [year, month, day] = String(dateKey).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(dt.getTime())) return null;
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function formatDateLabel(dateKey, timeZone) {
  const safeDate = new Date(`${dateKey}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(safeDate);
}

function formatDueDateLabel(dateKey, timeZone) {
  const safeDate = new Date(`${dateKey}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(safeDate);
}

function getProjectName(task) {
  if (!task?.projects) return 'Unassigned';
  if (Array.isArray(task.projects)) {
    return task.projects[0]?.name || 'Unassigned';
  }
  return task.projects.name || 'Unassigned';
}

function getChipLabels(chips) {
  if (!Array.isArray(chips)) return [];
  return chips.map((chip) => CHIP_LABELS[chip]).filter(Boolean);
}

function pluralise(count, singular, plural) {
  return count === 1 ? singular : (plural || `${singular}s`);
}

// Split a flat list of Today-state tasks into the three section buckets. Any row
// with an unexpected section is dropped from "Your day" (Today rows always carry
// a valid section via the DB constraint, so this only guards bad data).
function groupTodayBySection(tasks = []) {
  const grouped = { must_do: [], good_to_do: [], quick_wins: [] };
  for (const task of tasks) {
    const section = task?.today_section;
    if (grouped[section]) grouped[section].push(task);
  }
  return grouped;
}

export async function resolveDigestUserId({ supabase, email }) {
  if (!supabase) throw new Error('resolveDigestUserId: supabase is required');

  const explicitUserId = process.env.DIGEST_USER_ID;
  if (explicitUserId) return explicitUserId;

  const targetEmail = (email || process.env.DIGEST_USER_EMAIL || process.env.MICROSOFT_USER_EMAIL || '').trim();
  if (!targetEmail) {
    throw new Error('Missing digest user email (set DIGEST_USER_EMAIL or MICROSOFT_USER_EMAIL, or set DIGEST_USER_ID)');
  }

  const normalized = targetEmail.toLowerCase();
  const perPage = 200;

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`Unable to list Supabase users: ${error.message || error.toString()}`);
    }

    const users = data?.users || [];
    const match = users.find((u) => String(u?.email || '').toLowerCase() === normalized);
    if (match?.id) return match.id;

    const total = data?.total ?? null;
    if (total !== null && page * perPage >= total) break;
    if (users.length < perPage) break;
  }

  throw new Error(`Unable to find Supabase user for email ${targetEmail}`);
}

// The columns the digest needs: enough for the F1 comparator (chips, due_date,
// entered_state_at, sort_order, created_at, name, id) plus the fields the
// decision/carried lenses read.
const DIGEST_SELECT =
  'id, name, due_date, state, today_section, project_id, chips, carried_count, carried_section, snooze_count, snoozed_until, follow_up_date, entered_state_at, sort_order, created_at, projects(name)';

// Run a select and degrade to [] on any error/throw. Auxiliary decision queries
// must never take the whole digest down — a richer email has more failure
// surface, so one failing lens simply renders as empty. No secrets are logged.
async function safeRows(queryFn) {
  try {
    const { data, error } = await queryFn();
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

async function safeCount(queryFn) {
  try {
    const { count, error } = await queryFn();
    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}

/**
 * Fetch and assemble every piece of the morning brief.
 *
 * Returns { dueToday, overdue, inboxCount, digest }: dueToday/overdue are real
 * task arrays (so the route's run-tracking counts stay correct), inboxCount is a
 * number, and digest is the assembled brief data passed straight to the builder.
 */
export async function fetchOutstandingTasks({ supabase, userId, todayDateKey }) {
  if (!supabase) throw new Error('fetchOutstandingTasks: supabase is required');
  if (!userId) throw new Error('fetchOutstandingTasks: userId is required');

  const today = todayDateKey || getLondonDateKey();
  // Strictly more than WAITING_STALE_DAYS in state → entered before this key.
  const waitingStaleCutoff = addDaysToDateKey(today, -WAITING_STALE_DAYS);

  // Primary query: every Today-state task (dated AND undated). The digest cannot
  // render "Your day" without this, so a failure here throws (unlike the
  // auxiliary lenses below, which degrade to empty).
  const { data: todayRows, error: todayError } = await supabase
    .from('tasks')
    .select(DIGEST_SELECT)
    .eq('user_id', userId)
    .eq('state', 'today');

  if (todayError) {
    throw new Error(`Unable to fetch today tasks: ${todayError.message || todayError.toString()}`);
  }

  const todayTasks = todayRows || [];
  const todayBySection = groupTodayBySection(todayTasks);

  // Over-cap sections (a "Needs a decision" exception) — derived, not queried.
  const overCapSections = [];
  for (const section of TODAY_SECTION_ORDER) {
    const count = todayBySection[section].length;
    const cap = SOFT_CAP_BY_SECTION[section];
    if (cap && count > cap) overCapSections.push({ section, count, cap });
  }

  // Carried-forward summary: Must Do carried from yesterday are Today tasks with
  // carried_count > 0 (A1 only carries Must Do forward inside Today).
  const mustDoCarried = todayTasks.filter((t) => (t.carried_count || 0) > 0).length;
  // Carried-3-days exception: Today tasks that have been carried the threshold
  // number of consecutive days.
  const carried3Days = todayTasks.filter((t) => (t.carried_count || 0) >= CARRY_NUDGE_THRESHOLD);

  const [
    overdue,
    inbox,
    snoozedToday,
    thriceSnoozed,
    waitingRows,
    thisWeekCarried,
    ideasResult,
  ] = await Promise.all([
    // Overdue exceptions: due before today, not already in Today (surfaced in
    // "Your day") and not done.
    safeRows(() =>
      supabase
        .from('tasks')
        .select(DIGEST_SELECT)
        .eq('user_id', userId)
        .lt('due_date', today)
        .not('state', 'in', '("today","done")')
        .or(`snoozed_until.is.null,snoozed_until.lte.${today}`)
        .order('due_date', { ascending: true })
        .order('created_at', { ascending: true })
    ),
    // Inbox awaiting triage (F3): captured/promoted/pulled items not yet triaged.
    // Snooze-aware and excluding done (triage clears inbox, so the guard is
    // defensive).
    safeRows(() =>
      supabase
        .from('tasks')
        .select(DIGEST_SELECT)
        .eq('user_id', userId)
        .eq('inbox', true)
        .neq('state', 'done')
        .or(`snoozed_until.is.null,snoozed_until.lte.${today}`)
        .order('created_at', { ascending: true })
    ),
    // Snooze returns today (F2): the task chose to reappear now, so it needs a
    // decision this morning.
    safeRows(() =>
      supabase
        .from('tasks')
        .select(DIGEST_SELECT)
        .eq('user_id', userId)
        .eq('snoozed_until', today)
        .not('state', 'in', '("today","done")')
        .order('created_at', { ascending: true })
    ),
    // Snoozed 3+ times (F2): a repeatedly-deferred item that should be decided.
    safeRows(() =>
      supabase
        .from('tasks')
        .select(DIGEST_SELECT)
        .eq('user_id', userId)
        .gte('snooze_count', 3)
        .not('state', 'in', '("today","done")')
        .or(`snoozed_until.is.null,snoozed_until.lte.${today}`)
        .order('snooze_count', { ascending: false })
        .order('created_at', { ascending: true })
    ),
    // All 'waiting' tasks — stale ones are filtered in JS below (two rules that
    // are awkward to express as one PostgREST predicate).
    safeRows(() =>
      supabase
        .from('tasks')
        .select(DIGEST_SELECT)
        .eq('user_id', userId)
        .eq('state', 'waiting')
        .or(`snoozed_until.is.null,snoozed_until.lte.${today}`)
    ),
    // Count of items now in This Week that were carried there (A1 demotion).
    safeCount(() =>
      supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('state', 'this_week')
        .not('carried_section', 'is', null)
    ),
    // Ideas due for review (F4) — reuse the shared service.
    listIdeasDueForReview({ supabase, userId }).catch(() => ({ data: [] })),
  ]);

  // Stale waiting follow-ups: follow_up_date has passed, OR no follow_up_date and
  // the task has sat in 'waiting' for more than WAITING_STALE_DAYS.
  const staleWaiting = (waitingRows || []).filter((task) => {
    const followUp = normalizeDueDate(task?.follow_up_date);
    if (followUp) return followUp < today;
    if (!waitingStaleCutoff) return false;
    const enteredKey = task?.entered_state_at ? getLondonDateKey(new Date(task.entered_state_at)) : null;
    return enteredKey !== null && enteredKey < waitingStaleCutoff;
  });

  const ideas = ideasResult?.data || [];

  const digest = {
    todayDateKey: today,
    todayBySection,
    carried: {
      mustDoCarried,
      thisWeekCarried,
    },
    decisions: {
      inbox,
      snoozedToday,
      overdue,
      overCapSections,
      staleWaiting,
      thriceSnoozed,
      carried3Days,
    },
    ideas,
  };

  return { dueToday: todayTasks, overdue, inboxCount: inbox.length, digest };
}

// --- Rendering helpers (pure) ---------------------------------------------

function renderTodayTaskText(task) {
  const name = task?.name || '(Untitled task)';
  const project = getProjectName(task);
  const chips = getChipLabels(task?.chips);
  const chipSuffix = chips.length ? ` — ${chips.join(', ')}` : '';
  return `- ${name} (${project})${chipSuffix}`;
}

function renderTodayTaskHtml(task) {
  const name = escapeHtml(task?.name || '(Untitled task)');
  const project = escapeHtml(getProjectName(task));
  const chips = getChipLabels(task?.chips);
  const chipSuffix = chips.length
    ? ` <span style="color:#888;font-size:12px;">[${escapeHtml(chips.join(', '))}]</span>`
    : '';
  return `<li>${name} <span style="color:#555;">(${project})</span>${chipSuffix}</li>`;
}

function renderDecisionTaskText(task, { timeZone, withDue } = {}) {
  const name = task?.name || '(Untitled task)';
  const project = getProjectName(task);
  const due = withDue ? normalizeDueDate(task?.due_date) : null;
  const dueSuffix = due ? ` — due ${formatDueDateLabel(due, timeZone)}` : '';
  return `- ${name} (${project})${dueSuffix}`;
}

function renderDecisionTaskHtml(task, { timeZone, withDue } = {}) {
  const name = escapeHtml(task?.name || '(Untitled task)');
  const project = escapeHtml(getProjectName(task));
  const due = withDue ? normalizeDueDate(task?.due_date) : null;
  const dueSuffix = due ? ` <span style="color:#555;">— due ${escapeHtml(formatDueDateLabel(due, timeZone))}</span>` : '';
  return `<li>${name} <span style="color:#555;">(${project})</span>${dueSuffix}</li>`;
}

// --- Pure builder ----------------------------------------------------------

/**
 * Build the morning-brief email from plain data structures — no Supabase, no
 * Graph — so it is fully unit-testable. Returns { subject, html, text }, or null
 * when there is nothing to send.
 *
 * @param {object} data
 * @param {string} data.todayDateKey
 * @param {object} [data.todayBySection] { must_do, good_to_do, quick_wins } arrays
 * @param {object} [data.carried] { mustDoCarried, thisWeekCarried }
 * @param {object} [data.decisions] { inbox, snoozedToday, overdue, overCapSections, staleWaiting, thriceSnoozed, carried3Days }
 * @param {object[]} [data.ideas] { title, area }
 * @param {string} [data.dashboardUrl]
 * @param {string} [data.timeZone]
 */
export function buildDigestEmail(data = {}) {
  const timeZone = data.timeZone || LONDON_TIME_ZONE;
  const today = data.todayDateKey || getLondonDateKey();
  const dateLabel = formatDateLabel(today, timeZone);

  const rawSections = data.todayBySection || {};
  // Sort each Today section by the F1 comparator (todayKey = today's London date)
  // so "Your day" is pre-ranked. Done here (not in the fetch) so the pure builder
  // owns ordering and tests can pass unsorted input.
  const todayBySection = {};
  let todayCount = 0;
  for (const section of TODAY_SECTION_ORDER) {
    const list = Array.isArray(rawSections[section]) ? rawSections[section] : [];
    todayBySection[section] = sortTasksByPriority(list, { todayKey: today });
    todayCount += list.length;
  }

  const carried = data.carried || {};
  const mustDoCarried = carried.mustDoCarried || 0;
  const thisWeekCarried = carried.thisWeekCarried || 0;
  const hasCarried = mustDoCarried > 0 || thisWeekCarried > 0;

  const decisions = data.decisions || {};
  const overCapSections = decisions.overCapSections || [];

  // Dedup the task-based decision lists by id in precedence order, so a task that
  // matches several lenses (e.g. overdue AND snoozed-returns-today) is listed and
  // counted in only its highest-precedence group. overCapSections is section-based
  // and not deduped.
  const seenDecision = new Set();
  const dedupeDecision = (list) => {
    const out = [];
    for (const t of (list || [])) {
      const id = t && t.id != null ? t.id : null;
      if (id != null) {
        if (seenDecision.has(id)) continue;
        seenDecision.add(id);
      }
      out.push(t);
    }
    return out;
  };
  const inbox = dedupeDecision(decisions.inbox);
  const snoozedToday = dedupeDecision(decisions.snoozedToday);
  const overdue = dedupeDecision(decisions.overdue);
  const staleWaiting = dedupeDecision(decisions.staleWaiting);
  const thriceSnoozed = dedupeDecision(decisions.thriceSnoozed);
  const carried3Days = dedupeDecision(decisions.carried3Days);

  const decisionCount =
    inbox.length +
    snoozedToday.length +
    overdue.length +
    overCapSections.length +
    staleWaiting.length +
    thriceSnoozed.length +
    carried3Days.length;

  const ideas = Array.isArray(data.ideas) ? data.ideas : [];

  // Nothing to say → no email (preserves the route's "no_outstanding_tasks").
  if (todayCount === 0 && decisionCount === 0 && ideas.length === 0 && !hasCarried) {
    return null;
  }

  const safeDashboardUrl = data.dashboardUrl || process.env.NEXTAUTH_URL || 'https://planner.orangejelly.co.uk';
  const dashboardLink = safeDashboardUrl.endsWith('/dashboard')
    ? safeDashboardUrl
    : `${safeDashboardUrl.replace(/\/$/, '')}/dashboard`;

  // --- Subject ---
  const subjectBits = [];
  if (todayCount) subjectBits.push(`${todayCount} ${pluralise(todayCount, 'task')} today`);
  if (decisionCount) subjectBits.push(`${decisionCount} to decide`);
  if (!todayCount && !decisionCount && ideas.length) {
    subjectBits.push(`${ideas.length} ${pluralise(ideas.length, 'idea')} to revisit`);
  }
  if (!subjectBits.length) subjectBits.push('your morning brief');
  const subject = `Planner: ${subjectBits.join(', ')} (${dateLabel})`;

  const textParts = [];
  const htmlParts = [];

  textParts.push(`Planner — morning brief for ${dateLabel}`);
  textParts.push('');
  htmlParts.push(`<h2 style="margin:0 0 12px 0;">Planner — morning brief</h2>`);
  htmlParts.push(`<p style="margin:0 0 16px 0;color:#555;">${escapeHtml(dateLabel)}</p>`);

  // --- 1. Your day ---
  if (todayCount) {
    textParts.push(`YOUR DAY (${todayCount})`);
    htmlParts.push(`<h3 style="margin:18px 0 8px 0;">Your day (${todayCount})</h3>`);
    for (const section of TODAY_SECTION_ORDER) {
      const list = todayBySection[section];
      if (!list.length) continue;
      const header = SECTION_HEADER_LABELS[section];
      textParts.push(`${header} (${list.length})`);
      textParts.push(...list.map((t) => renderTodayTaskText(t)));
      textParts.push('');
      htmlParts.push(`<p style="margin:12px 0 4px 0;"><strong>${escapeHtml(header)}</strong> (${list.length})</p>`);
      htmlParts.push('<ul style="margin:0 0 8px 18px;padding:0;">');
      htmlParts.push(...list.map((t) => renderTodayTaskHtml(t)));
      htmlParts.push('</ul>');
    }
  }

  // --- 2. Carried forward ---
  if (hasCarried) {
    const bits = [];
    if (mustDoCarried) bits.push(`${mustDoCarried} Must Do carried from yesterday`);
    if (thisWeekCarried) bits.push(`${thisWeekCarried} ${pluralise(thisWeekCarried, 'item')} currently carried in This Week`);
    const line = `Carried forward: ${bits.join('; ')}.`;
    textParts.push(line);
    textParts.push('');
    htmlParts.push(`<p style="margin:18px 0 8px 0;color:#555;"><strong>Carried forward:</strong> ${escapeHtml(bits.join('; '))}.</p>`);
  }

  // --- 3. Needs a decision ---
  const decisionGroups = [
    { key: 'inbox', label: 'Inbox — awaiting triage', list: inbox, withDue: false },
    { key: 'snoozedToday', label: 'Snooze returns today', list: snoozedToday, withDue: false },
    { key: 'overdue', label: 'Overdue', list: overdue, withDue: true },
    { key: 'staleWaiting', label: 'Waiting — needs a chase', list: staleWaiting, withDue: false },
    { key: 'thriceSnoozed', label: 'Snoozed 3+ times — decide', list: thriceSnoozed, withDue: false },
    { key: 'carried3Days', label: 'Carried 3+ days — still today?', list: carried3Days, withDue: false },
  ];

  if (decisionCount) {
    textParts.push(`NEEDS A DECISION (${decisionCount})`);
    htmlParts.push(`<h3 style="margin:18px 0 8px 0;">Needs a decision (${decisionCount})</h3>`);

    // Over-capacity sections render as note lines, not a task list.
    if (overCapSections.length) {
      textParts.push('Over capacity');
      htmlParts.push(`<p style="margin:12px 0 4px 0;"><strong>Over capacity</strong></p>`);
      htmlParts.push('<ul style="margin:0 0 8px 18px;padding:0;">');
      for (const { section, count, cap } of overCapSections) {
        const header = SECTION_HEADER_LABELS[section] || section;
        textParts.push(`- ${header}: ${count} (cap ${cap})`);
        htmlParts.push(`<li>${escapeHtml(header)}: ${count} (cap ${cap})</li>`);
      }
      htmlParts.push('</ul>');
      textParts.push('');
    }

    for (const group of decisionGroups) {
      if (!group.list.length) continue;
      const shown = group.list.slice(0, DECISION_LIST_CAP);
      const extra = group.list.length - shown.length;
      textParts.push(`${group.label} (${group.list.length})`);
      textParts.push(...shown.map((t) => renderDecisionTaskText(t, { timeZone, withDue: group.withDue })));
      if (extra > 0) textParts.push(`- +${extra} more`);
      textParts.push('');

      htmlParts.push(`<p style="margin:12px 0 4px 0;"><strong>${escapeHtml(group.label)}</strong> (${group.list.length})</p>`);
      htmlParts.push('<ul style="margin:0 0 8px 18px;padding:0;">');
      htmlParts.push(...shown.map((t) => renderDecisionTaskHtml(t, { timeZone, withDue: group.withDue })));
      if (extra > 0) htmlParts.push(`<li>+${extra} more</li>`);
      htmlParts.push('</ul>');
    }
  }

  // --- 4. Ideas to revisit ---
  if (ideas.length) {
    const shown = ideas.slice(0, IDEAS_CAP);
    const extra = ideas.length - shown.length;
    textParts.push(`IDEAS TO REVISIT (${ideas.length})`);
    htmlParts.push(`<h3 style="margin:18px 0 8px 0;">Ideas to revisit (${ideas.length})</h3>`);
    htmlParts.push('<ul style="margin:0 0 8px 18px;padding:0;">');
    for (const idea of shown) {
      const title = idea?.title || '(Untitled idea)';
      const area = idea?.area ? ` (${idea.area})` : '';
      textParts.push(`- ${title}${area}`);
      const areaHtml = idea?.area ? ` <span style="color:#555;">(${escapeHtml(idea.area)})</span>` : '';
      htmlParts.push(`<li>${escapeHtml(title)}${areaHtml}</li>`);
    }
    if (extra > 0) {
      textParts.push(`- +${extra} more`);
      htmlParts.push(`<li>+${extra} more</li>`);
    }
    htmlParts.push('</ul>');
    textParts.push('');
  }

  // --- 5. Single app link ---
  textParts.push(`Open Planner: ${dashboardLink}`);
  htmlParts.push(`<p style="margin:18px 0 0 0;"><a href="${escapeHtml(dashboardLink)}">Open Planner</a></p>`);

  return {
    subject,
    text: textParts.join('\n'),
    html: htmlParts.join('\n'),
  };
}

// --- Route-facing adapter --------------------------------------------------

// Fallback for a plain (non-digest-carrying) call: group the today-tasks array
// by section and treat the overdue array as the only decision lens available.
function buildLegacyData({ dueToday, overdue }) {
  const todayTasks = Array.isArray(dueToday) ? dueToday : [];
  return {
    todayBySection: groupTodayBySection(todayTasks),
    carried: { mustDoCarried: 0, thisWeekCarried: 0 },
    decisions: {
      inbox: [],
      snoozedToday: [],
      overdue: Array.isArray(overdue) ? overdue : [],
      overCapSections: [],
      staleWaiting: [],
      thriceSnoozed: [],
      carried3Days: [],
    },
    ideas: [],
  };
}

/**
 * Route-facing builder. Renders the assembled `digest` from fetchOutstandingTasks;
 * falls back to a degraded brief built from the plain arrays when no digest is
 * supplied (defensive / legacy callers).
 */
export function buildDailyTaskEmail({ todayDateKey, digest, dueToday, overdue, inboxCount, dashboardUrl, timeZone } = {}) {
  const base = digest || buildLegacyData({ dueToday, overdue, inboxCount });

  return buildDigestEmail({
    ...base,
    todayDateKey: todayDateKey || base.todayDateKey,
    dashboardUrl,
    timeZone,
  });
}
