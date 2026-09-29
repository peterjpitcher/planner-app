import { LONDON_TIME_ZONE, getLondonDateKey } from '@/lib/timezone';
import { sortTasksByPriority } from '@/lib/taskSort';
import { STATE, TODAY_SECTION, closedStatesFilter } from '@/lib/constants';

// The morning email, cut back on 29 Sep 2026 to be simple and to the point:
// today's plan (Must Do first, then the rest of Today) and what has slipped past
// its due date. Everything else Planner tracks (inbox, snoozes, chases, ideas,
// stalled projects) stays in the app. The one-tap action buttons went too; they
// had never been used.

// Overdue rows shown before the list collapses to "and N more in Planner".
const OVERDUE_CAP = 5;

// Enough for the F1 priority comparator (chips, due_date, entered_state_at,
// sort_order, created_at, name, id) plus what the email prints.
const TASK_SELECT =
  'id, name, due_date, state, today_section, chips, entered_state_at, sort_order, created_at, projects(name)';

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

// "Fri 4 Sept" for a YYYY-MM-DD key. Noon UTC keeps the key on the same calendar
// day in any zone.
function formatShortDate(dateKey, timeZone) {
  const safeDate = new Date(`${dateKey}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(safeDate);
}

function getProjectName(task) {
  const project = Array.isArray(task?.projects) ? task.projects[0] : task?.projects;
  return project?.name || null;
}

function pluralise(count, singular, plural) {
  return count === 1 ? singular : (plural || `${singular}s`);
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

/**
 * Fetch what the morning email needs: every Today task (dated or not) and every
 * overdue task outside Today. Both are the email's whole content, so a failed
 * query throws rather than sending a silently incomplete email.
 *
 * Returns { dueToday, overdue }, the raw task arrays.
 */
export async function fetchOutstandingTasks({ supabase, userId, todayDateKey }) {
  if (!supabase) throw new Error('fetchOutstandingTasks: supabase is required');
  if (!userId) throw new Error('fetchOutstandingTasks: userId is required');

  const today = todayDateKey || getLondonDateKey();

  const [todayResult, overdueResult] = await Promise.all([
    supabase
      .from('tasks')
      .select(TASK_SELECT)
      .eq('user_id', userId)
      .eq('state', STATE.TODAY),
    // Overdue: due before today, not already in Today (those are in the plan),
    // not finished, and not snoozed beyond today.
    supabase
      .from('tasks')
      .select(TASK_SELECT)
      .eq('user_id', userId)
      .lt('due_date', today)
      .not('state', 'in', closedStatesFilter([STATE.TODAY]))
      .or(`snoozed_until.is.null,snoozed_until.lte.${today}`),
  ]);

  if (todayResult.error) {
    throw new Error(`Unable to fetch today tasks: ${todayResult.error.message || todayResult.error.toString()}`);
  }
  if (overdueResult.error) {
    throw new Error(`Unable to fetch overdue tasks: ${overdueResult.error.message || overdueResult.error.toString()}`);
  }

  return { dueToday: todayResult.data || [], overdue: overdueResult.data || [] };
}

// --- Rendering (pure) ------------------------------------------------------

function renderTaskText(task, dueLabel) {
  const name = task?.name || '(Untitled task)';
  const project = getProjectName(task);
  const projectSuffix = project ? ` (${project})` : '';
  const dueSuffix = dueLabel ? `, due ${dueLabel}` : '';
  return `- ${name}${projectSuffix}${dueSuffix}`;
}

function renderTaskHtml(task, dueLabel) {
  const name = escapeHtml(task?.name || '(Untitled task)');
  const project = getProjectName(task);
  const projectSuffix = project ? ` <span style="color:#555;">(${escapeHtml(project)})</span>` : '';
  const dueSuffix = dueLabel ? `<span style="color:#555;">, due ${escapeHtml(dueLabel)}</span>` : '';
  return `<li>${name}${projectSuffix}${dueSuffix}</li>`;
}

/**
 * Build the morning email from plain task arrays, with no Supabase and no Graph,
 * so it is fully unit-testable. Returns { subject, html, text }, or null when
 * there is nothing planned and nothing overdue.
 *
 * @param {object} data
 * @param {string} [data.todayDateKey] London date, YYYY-MM-DD
 * @param {object[]} [data.dueToday] every Today-state task
 * @param {object[]} [data.overdue] overdue tasks outside Today, in any order
 * @param {string} [data.dashboardUrl]
 * @param {string} [data.timeZone]
 */
export function buildDailyTaskEmail({ todayDateKey, dueToday, overdue, dashboardUrl, timeZone } = {}) {
  const zone = timeZone || LONDON_TIME_ZONE;
  const today = todayDateKey || getLondonDateKey();
  const todayTasks = Array.isArray(dueToday) ? dueToday : [];
  // Newest overdue first, so the capped list shows what has just slipped rather
  // than the same long-ignored tasks every morning. Same due date: oldest
  // created first.
  const overdueTasks = (Array.isArray(overdue) ? [...overdue] : []).sort((a, b) => {
    const dueA = normalizeDueDate(a?.due_date) || '';
    const dueB = normalizeDueDate(b?.due_date) || '';
    if (dueA !== dueB) return dueA < dueB ? 1 : -1;
    return String(a?.created_at || '').localeCompare(String(b?.created_at || ''));
  });

  // Must Do first, then Good to Do, then Quick Wins, each ranked by the F1
  // comparator so the email matches the order the app would suggest.
  const rank = (list) => sortTasksByPriority(list, { todayKey: today });
  const mustDo = rank(todayTasks.filter((t) => t?.today_section === TODAY_SECTION.MUST_DO));
  const rest = [
    ...rank(todayTasks.filter((t) => t?.today_section === TODAY_SECTION.GOOD_TO_DO)),
    ...rank(todayTasks.filter((t) => t?.today_section === TODAY_SECTION.QUICK_WINS)),
  ];
  const todayCount = mustDo.length + rest.length;

  if (todayCount === 0 && overdueTasks.length === 0) return null;

  const baseUrl = dashboardUrl || process.env.NEXTAUTH_URL || 'https://planner.orangejelly.co.uk';
  const dashboardLink = baseUrl.endsWith('/dashboard')
    ? baseUrl
    : `${baseUrl.replace(/\/$/, '')}/dashboard`;

  // The date stays in the subject so Outlook does not thread each morning's
  // email into one conversation.
  const subjectBits = [];
  if (todayCount) subjectBits.push(`${todayCount} ${pluralise(todayCount, 'task')} today`);
  if (overdueTasks.length) subjectBits.push(`${overdueTasks.length} overdue`);
  const subject = `Planner: ${subjectBits.join(', ')} (${formatShortDate(today, zone)})`;

  const textParts = [];
  const htmlParts = [];

  const addSection = (title, rows, { dueDates = false, extra = 0 } = {}) => {
    const dueLabelFor = (task) => {
      if (!dueDates) return null;
      const due = normalizeDueDate(task?.due_date);
      return due ? formatShortDate(due, zone) : null;
    };
    textParts.push(title.toUpperCase());
    textParts.push(...rows.map((t) => renderTaskText(t, dueLabelFor(t))));
    if (extra > 0) textParts.push(`- and ${extra} more in Planner`);
    textParts.push('');

    htmlParts.push(`<p style="margin:0 0 4px 0;"><strong>${escapeHtml(title)}</strong></p>`);
    htmlParts.push('<ul style="margin:0 0 16px 18px;padding:0;">');
    htmlParts.push(...rows.map((t) => renderTaskHtml(t, dueLabelFor(t))));
    if (extra > 0) htmlParts.push(`<li style="color:#555;">and ${extra} more in Planner</li>`);
    htmlParts.push('</ul>');
  };

  if (mustDo.length) addSection('Must Do', mustDo);
  if (rest.length) addSection(mustDo.length ? 'Also today' : 'Today', rest);
  if (overdueTasks.length) {
    const shown = overdueTasks.slice(0, OVERDUE_CAP);
    addSection(`Overdue (${overdueTasks.length})`, shown, {
      dueDates: true,
      extra: overdueTasks.length - shown.length,
    });
  }

  textParts.push(`Open Planner: ${dashboardLink}`);
  htmlParts.push(`<p style="margin:0;"><a href="${escapeHtml(dashboardLink)}">Open Planner</a></p>`);

  return {
    subject,
    text: textParts.join('\n'),
    html: htmlParts.join('\n'),
  };
}
