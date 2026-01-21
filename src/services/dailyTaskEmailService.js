import { LONDON_TIME_ZONE, getLondonDateKey } from '@/lib/timezone';

const PRIORITY_ORDER = {
  High: 0,
  Medium: 1,
  Low: 2,
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

function formatLondonDateLabel(dateKey) {
  const safeDate = new Date(`${dateKey}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TIME_ZONE,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(safeDate);
}

function formatLondonDueDateLabel(dateKey) {
  const safeDate = new Date(`${dateKey}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TIME_ZONE,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(safeDate);
}

function taskSort(a, b) {
  const dueA = normalizeDueDate(a?.due_date) || '';
  const dueB = normalizeDueDate(b?.due_date) || '';

  if (dueA !== dueB) return dueA.localeCompare(dueB);

  const priA = PRIORITY_ORDER[a?.priority] ?? 99;
  const priB = PRIORITY_ORDER[b?.priority] ?? 99;
  if (priA !== priB) return priA - priB;

  return String(a?.name || '').localeCompare(String(b?.name || ''));
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

export async function fetchOutstandingTasks({ supabase, userId, todayDateKey }) {
  if (!supabase) throw new Error('fetchOutstandingTasks: supabase is required');
  if (!userId) throw new Error('fetchOutstandingTasks: userId is required');

  const today = todayDateKey || getLondonDateKey();

  const { data, error } = await supabase
    .from('tasks')
    .select('id, name, due_date, priority, project_id, projects(name)')
    .eq('user_id', userId)
    .eq('is_completed', false)
    .not('due_date', 'is', null)
    .lte('due_date', today);

  if (error) {
    throw new Error(`Unable to fetch tasks: ${error.message || error.toString()}`);
  }

  const dueToday = [];
  const overdue = [];

  for (const task of data || []) {
    const due = normalizeDueDate(task?.due_date);
    if (!due) continue;
    if (due === today) dueToday.push(task);
    else if (due < today) overdue.push(task);
  }

  dueToday.sort(taskSort);
  overdue.sort(taskSort);

  return { today, dueToday, overdue };
}

export function buildDailyTaskEmail({ todayDateKey, dueToday, overdue, dashboardUrl }) {
  const today = todayDateKey || getLondonDateKey();
  const dueTodayTasks = dueToday || [];
  const overdueTasks = overdue || [];

  const total = dueTodayTasks.length + overdueTasks.length;
  if (total === 0) {
    return null;
  }

  const dateLabel = formatLondonDateLabel(today);

  const subjectParts = [];
  if (overdueTasks.length) subjectParts.push(`${overdueTasks.length} overdue`);
  if (dueTodayTasks.length) subjectParts.push(`${dueTodayTasks.length} due today`);
  const subject = `Planner: ${subjectParts.join(', ')} (${dateLabel})`;

  const safeDashboardUrl = dashboardUrl || process.env.NEXTAUTH_URL || 'https://planner.orangejelly.co.uk';
  const dashboardLink = safeDashboardUrl.endsWith('/dashboard') ? safeDashboardUrl : `${safeDashboardUrl.replace(/\/$/, '')}/dashboard`;

  const formatTaskLineText = (task, includeDueDate) => {
    const projectName = task?.projects?.name || 'Unassigned';
    const priority = task?.priority ? `[${task.priority}] ` : '';
    const name = task?.name || '(Untitled task)';
    const due = normalizeDueDate(task?.due_date);
    const dueLabel = includeDueDate && due ? ` — due ${formatLondonDueDateLabel(due)}` : '';
    return `- ${priority}${name} (${projectName})${dueLabel}`;
  };

  const formatTaskLineHtml = (task, includeDueDate) => {
    const projectName = escapeHtml(task?.projects?.name || 'Unassigned');
    const priority = task?.priority ? `<strong>[${escapeHtml(task.priority)}]</strong> ` : '';
    const name = escapeHtml(task?.name || '(Untitled task)');
    const due = normalizeDueDate(task?.due_date);
    const dueLabel = includeDueDate && due ? ` <span style="color:#555;">— due ${escapeHtml(formatLondonDueDateLabel(due))}</span>` : '';
    return `<li>${priority}${name} <span style="color:#555;">(${projectName})</span>${dueLabel}</li>`;
  };

  const textSections = [];
  textSections.push(`Planner digest — ${dateLabel}`);
  textSections.push('');

  if (dueTodayTasks.length) {
    textSections.push(`Due today (${dueTodayTasks.length})`);
    textSections.push(...dueTodayTasks.map((t) => formatTaskLineText(t, false)));
    textSections.push('');
  }

  if (overdueTasks.length) {
    textSections.push(`Overdue (${overdueTasks.length})`);
    textSections.push(...overdueTasks.map((t) => formatTaskLineText(t, true)));
    textSections.push('');
  }

  textSections.push(`Open Planner: ${dashboardLink}`);

  const htmlSections = [];
  htmlSections.push(`<h2 style="margin:0 0 12px 0;">Planner digest — ${escapeHtml(dateLabel)}</h2>`);
  htmlSections.push(`<p style="margin:0 0 16px 0;color:#555;">Overdue: <strong>${overdueTasks.length}</strong> &nbsp;|&nbsp; Due today: <strong>${dueTodayTasks.length}</strong></p>`);

  if (dueTodayTasks.length) {
    htmlSections.push(`<h3 style="margin:18px 0 8px 0;">Due today (${dueTodayTasks.length})</h3>`);
    htmlSections.push('<ul style="margin:0 0 12px 18px;padding:0;">');
    htmlSections.push(...dueTodayTasks.map((t) => formatTaskLineHtml(t, false)));
    htmlSections.push('</ul>');
  }

  if (overdueTasks.length) {
    htmlSections.push(`<h3 style="margin:18px 0 8px 0;">Overdue (${overdueTasks.length})</h3>`);
    htmlSections.push('<ul style="margin:0 0 12px 18px;padding:0;">');
    htmlSections.push(...overdueTasks.map((t) => formatTaskLineHtml(t, true)));
    htmlSections.push('</ul>');
  }

  htmlSections.push(`<p style="margin:18px 0 0 0;"><a href="${escapeHtml(dashboardLink)}">Open Planner</a></p>`);

  return {
    subject,
    text: textSections.join('\n'),
    html: htmlSections.join('\n'),
  };
}
