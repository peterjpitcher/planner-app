import { AUTOPILOT_LEVEL } from '@/lib/constants';

// Wave 4 — automation heartbeat. Turns the raw run-tracking rows (cron_runs,
// daily_task_email_runs) and the Outlook connection into a friendly, per-
// automation health list the owner can read at a glance, so a silently-stopped
// cron surfaces in-app instead of just "no emails flowing". Rules-only, no
// secrets: the connection row is read on SAFE columns only and none of the
// token/secret ids ever reach this layer.

// A DAILY automation that has not been seen in longer than this is flagged
// stale ("hasn't run recently"). 48h gives a missed day plenty of slack before
// it reads as a problem. Only daily jobs are checked — the weekly tidy and the
// continuous Outlook sync run on their own cadence.
const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000;

// cron_runs.status → health status. 'claimed' (started, not yet finished) and
// any unexpected value fall through to 'partial' so an incomplete run reads as
// "ran with problems" rather than silently as "working".
const CRON_STATUS_MAP = { success: 'ok', partial: 'partial', failed: 'failed' };
// daily_task_email_runs.status → health status. 'claimed' (send in progress /
// crashed mid-send) falls through to 'partial'.
// 'skipped' = the cron ran but there was nothing to send (a healthy no-op). It
// is recorded so lastRunAt tracks the last cron EXECUTION, not the last send —
// otherwise a run of genuinely-empty days would falsely read as "stopped".
const EMAIL_STATUS_MAP = { sent: 'ok', skipped: 'ok', failed: 'failed' };

// The cron_runs operations surfaced in the heartbeat. Excludes the
// 'office365-sync-lock:*' advisory-lock rows, which are not automations.
export const TRACKED_CRON_OPERATIONS = ['morning-autopilot', 'demote_today', 'demote_week'];

// The automations shown, in display order. `source` picks the normaliser;
// `cadence` drives the stale check. Labels/descriptions are British and
// outcome-focused so a non-technical owner can tell what each one does.
const AUTOMATIONS = [
  {
    key: 'morning_autopilot',
    label: 'Morning autopilot',
    description: "Builds today's plan when you haven't",
    source: 'cron',
    operation: 'morning-autopilot',
    cadence: 'daily',
  },
  {
    key: 'evening_tidy',
    label: 'Evening tidy',
    description: 'Moves unfinished Today items to This Week',
    source: 'cron',
    operation: 'demote_today',
    cadence: 'daily',
  },
  {
    key: 'weekly_tidy',
    label: 'Weekly tidy',
    description: 'Moves stale This Week items to Backlog',
    source: 'cron',
    operation: 'demote_week',
    cadence: 'weekly',
  },
  {
    key: 'digest',
    label: 'Morning digest email',
    description: 'Emails your morning brief',
    source: 'email',
    cadence: 'daily',
  },
  {
    key: 'outlook_sync',
    label: 'Outlook sync',
    description: 'Keeps your tasks and Outlook in step',
    source: 'outlook',
    cadence: 'continuous',
  },
];

// A daily automation is stale when its last run is older than the threshold.
// 'off' and never-run rows are never stale (nothing is expected of them), and a
// missing/unparseable timestamp is treated as not stale.
function computeStale(cadence, status, lastRunAt, nowMs) {
  if (cadence !== 'daily') return false;
  if (status === 'off' || status === 'never') return false;
  if (!lastRunAt) return false;
  const ranAtMs = Date.parse(lastRunAt);
  if (Number.isNaN(ranAtMs)) return false;
  return nowMs - ranAtMs > STALE_THRESHOLD_MS;
}

function makeRow(auto, { status, lastRunAt, detail, nowMs }) {
  const normalisedLastRunAt = lastRunAt || null;
  return {
    key: auto.key,
    label: auto.label,
    description: auto.description,
    lastRunAt: normalisedLastRunAt,
    status,
    detail,
    stale: computeStale(auto.cadence, status, normalisedLastRunAt, nowMs),
  };
}

function cronDetail(status, row) {
  if (status === 'ok') return 'Ran successfully';
  if (status === 'failed') return row?.error ? String(row.error) : 'Last run failed';
  if (status === 'partial') return row?.error ? String(row.error) : 'Ran with problems';
  return 'Ran';
}

function normaliseCronAutomation(auto, row, settings, nowMs) {
  // Morning autopilot is the only cron with an owner-facing off switch.
  if (auto.key === 'morning_autopilot' && settings.autopilot_level === AUTOPILOT_LEVEL.OFF) {
    return makeRow(auto, { status: 'off', lastRunAt: row?.created_at || null, detail: 'Turned off', nowMs });
  }
  if (!row) {
    return makeRow(auto, { status: 'never', lastRunAt: null, detail: 'Not run yet', nowMs });
  }
  const status = CRON_STATUS_MAP[row.status] || 'partial';
  return makeRow(auto, { status, lastRunAt: row.created_at || null, detail: cronDetail(status, row), nowMs });
}

function emailDetail(status, row) {
  if (status === 'ok') return row?.status === 'skipped' ? 'Ran — nothing to send' : 'Sent';
  if (status === 'failed') return row?.error ? String(row.error) : 'Last send failed';
  return 'In progress';
}

function normaliseEmailAutomation(auto, row, settings, nowMs) {
  if (settings.digest_enabled === false) {
    const lastRunAt = row ? row.sent_at || row.created_at || null : null;
    return makeRow(auto, { status: 'off', lastRunAt, detail: 'Turned off', nowMs });
  }
  if (!row) {
    return makeRow(auto, { status: 'never', lastRunAt: null, detail: 'Not run yet', nowMs });
  }
  const status = EMAIL_STATUS_MAP[row.status] || 'partial';
  const lastRunAt = row.sent_at || row.created_at || null;
  return makeRow(auto, { status, lastRunAt, detail: emailDetail(status, row), nowMs });
}

function normaliseOutlookAutomation(auto, connection, nowMs) {
  if (!connection) {
    return makeRow(auto, { status: 'off', lastRunAt: null, detail: 'Not connected', nowMs });
  }
  if (connection.sync_enabled === false) {
    return makeRow(auto, { status: 'off', lastRunAt: connection.last_synced_at || null, detail: 'Sync turned off', nowMs });
  }
  if (connection.sync_error) {
    return makeRow(auto, { status: 'failed', lastRunAt: connection.last_synced_at || null, detail: String(connection.sync_error), nowMs });
  }
  const lastRunAt = connection.last_synced_at || null;
  return makeRow(auto, {
    status: 'ok',
    lastRunAt,
    detail: lastRunAt ? 'Syncing normally' : 'Connected, not yet synced',
    nowMs,
  });
}

/**
 * PURE normaliser: turn plain run data into one health row per automation.
 *
 * @param {object} input
 * @param {Record<string, object>} [input.cronRuns] latest cron_runs row keyed by operation
 *        ('morning-autopilot' | 'demote_today' | 'demote_week').
 * @param {object|null} [input.lastEmailRun] latest daily_task_email_runs row for the user.
 * @param {object|null} [input.connection] the user's office365_connections row (SAFE columns only).
 * @param {number} [input.nowMs] current time in ms, for the stale check.
 * @param {object} [input.settings] { autopilot_level, digest_enabled }.
 * @returns {Array<{ key, label, description, lastRunAt, status, detail, stale }>}
 *          status is one of 'ok' | 'partial' | 'failed' | 'off' | 'never'.
 */
export function normaliseAutomationHealth({
  cronRuns = {},
  lastEmailRun = null,
  connection = null,
  nowMs = Date.now(),
  settings = {},
} = {}) {
  return AUTOMATIONS.map((auto) => {
    if (auto.source === 'cron') {
      return normaliseCronAutomation(auto, cronRuns[auto.operation] || null, settings, nowMs);
    }
    if (auto.source === 'email') {
      return normaliseEmailAutomation(auto, lastEmailRun, settings, nowMs);
    }
    return normaliseOutlookAutomation(auto, connection, nowMs);
  });
}

// Run a query and degrade to null on any error/throw, so one broken sub-query
// downgrades a single automation to 'never'/'off' rather than failing the whole
// heartbeat.
async function safeSingle(queryFn) {
  try {
    const { data, error } = await queryFn();
    if (error) return null;
    return data ?? null;
  } catch {
    return null;
  }
}

/**
 * IO fetcher: read the latest run rows + Outlook connection for a user and hand
 * them to the pure normaliser. Resilient — a failing sub-query degrades that
 * automation, never the whole call. The connection is read on SAFE columns only
 * (never the token/secret ids).
 *
 * @param {object} input
 * @param {object} input.supabase service-role client (already user-scoped by user_id here).
 * @param {string} input.userId the user whose automations to report on.
 * @param {object} [input.settings] { autopilot_level, digest_enabled }.
 * @param {number} [input.nowMs] current time in ms.
 * @returns {Promise<Array>} the normalised health rows.
 */
export async function fetchAutomationHealth({ supabase, userId, settings = {}, nowMs = Date.now() }) {
  if (!supabase) throw new Error('fetchAutomationHealth: supabase is required');
  if (!userId) throw new Error('fetchAutomationHealth: userId is required');

  // Per-operation "latest row" queries: one operation running for weeks while
  // another is idle can't crowd the idle one out of a single top-N result set.
  const cronPromises = TRACKED_CRON_OPERATIONS.map((operation) =>
    safeSingle(() =>
      supabase
        .from('cron_runs')
        .select('operation, status, error, created_at')
        .eq('operation', operation)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    ).then((row) => [operation, row])
  );

  const emailPromise = safeSingle(() =>
    supabase
      .from('daily_task_email_runs')
      .select('status, error, sent_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  );

  // SAFE columns only — the office365_connections row also holds secret ids and
  // token expiry, which must never leave the server.
  const connectionPromise = safeSingle(() =>
    supabase
      .from('office365_connections')
      .select('sync_enabled, last_synced_at, sync_error, sync_error_at')
      .eq('user_id', userId)
      .maybeSingle()
  );

  const [cronEntries, lastEmailRun, connection] = await Promise.all([
    Promise.all(cronPromises),
    emailPromise,
    connectionPromise,
  ]);

  const cronRuns = {};
  for (const [operation, row] of cronEntries) {
    if (row) cronRuns[operation] = row;
  }

  return normaliseAutomationHealth({ cronRuns, lastEmailRun, connection, settings, nowMs });
}
