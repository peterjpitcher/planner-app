import { getTimeZoneParts, LONDON_TIME_ZONE } from '@/lib/timezone';

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

/**
 * Multi-layer cron authentication check.
 * Checks x-vercel-cron header, CRON_SECRET via x-cron-secret, and optional
 * CRON_MANUAL_TOKEN for manual testing.
 *
 * @param {Request} request
 * @returns {{ authorized: boolean, dryRun: boolean, force: boolean, status?: number }}
 */
export function verifyCronAuth(request) {
  const url = new URL(request.url);
  const isCron = (() => {
    const header = request.headers.get('x-vercel-cron');
    return header === '1' || header === 'true';
  })();

  const manualToken = url.searchParams.get('token');
  const manualTokenValid = Boolean(
    process.env.CRON_MANUAL_TOKEN &&
    manualToken &&
    manualToken === process.env.CRON_MANUAL_TOKEN
  );
  const allowManualControls = !isProduction() || manualTokenValid;

  const cronSecret = process.env.CRON_SECRET;
  const providedSecret = request.headers.get('x-cron-secret');

  if (cronSecret && !manualTokenValid && providedSecret !== cronSecret) {
    return { authorized: false, dryRun: false, force: false, status: 401 };
  }

  if (!cronSecret && isProduction() && !isCron && !manualTokenValid) {
    return { authorized: false, dryRun: false, force: false, status: 403 };
  }

  const dryRun = allowManualControls && url.searchParams.get('dryRun') === 'true';
  const force = allowManualControls && url.searchParams.get('force') === 'true';

  return { authorized: true, dryRun, force };
}

/**
 * Checks whether the current London hour matches the target hour.
 *
 * @param {number} targetHour
 * @returns {boolean}
 */
export function isLondonHour(targetHour) {
  const parts = getTimeZoneParts(new Date(), LONDON_TIME_ZONE);
  return parts.hour === targetHour;
}

/**
 * Returns the current day of the week in London timezone (0=Sunday, 6=Saturday).
 *
 * @returns {number}
 */
export function getLondonDayOfWeek() {
  const date = new Date();
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TIME_ZONE,
    weekday: 'short',
  });
  const weekday = formatter.format(date);
  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return dayMap[weekday] ?? date.getDay();
}

/**
 * Atomic INSERT-first claim for a cron run. Catches unique violation (23505).
 *
 * @param {{ supabase: any, operation: string, runDate: string }}
 * @returns {Promise<{ claimed: boolean, runId: string|null, reason?: string }>}
 */
export async function claimCronRun({ supabase, operation, runDate }) {
  try {
    const { data, error } = await supabase
      .from('cron_runs')
      .insert({
        operation,
        run_date: runDate,
        status: 'claimed',
      })
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') {
        return { claimed: false, runId: null, reason: 'already_run' };
      }

      if (String(error.message || '').toLowerCase().includes('does not exist')) {
        return { claimed: true, runId: null, reason: 'no_tracking_table' };
      }

      throw error;
    }

    return { claimed: true, runId: data?.id || null };
  } catch (error) {
    if (String(error?.message || '').toLowerCase().includes('does not exist')) {
      return { claimed: true, runId: null, reason: 'no_tracking_table' };
    }
    throw error;
  }
}

/**
 * Updates a cron run record with the given patch.
 *
 * @param {{ supabase: any, runId: string, patch: object }}
 */
export async function updateCronRun({ supabase, runId, patch }) {
  if (!runId) return;
  await supabase.from('cron_runs').update(patch).eq('id', runId);
}
