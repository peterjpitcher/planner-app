import { getTimeZoneParts, LONDON_TIME_ZONE } from '@/lib/timezone';

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

/**
 * Multi-layer cron authentication check.
 *
 * Auth model:
 *  - If CRON_SECRET is set it is mandatory: the request must present it via the
 *    `x-cron-secret` header or an `Authorization: Bearer <secret>` header
 *    (Vercel Cron sends the Bearer form), or carry a valid CRON_MANUAL_TOKEN.
 *  - If CRON_SECRET is NOT set we fail closed in production. A client-settable
 *    `x-vercel-cron` header is spoofable and is no longer trusted as proof of
 *    origin (FF-018). Non-production stays open so local/dev cron testing works.
 *
 * @param {Request} request
 * @returns {{ authorized: boolean, dryRun: boolean, force: boolean, status?: number }}
 */
export function verifyCronAuth(request) {
  const url = new URL(request.url);

  const manualToken = url.searchParams.get('token');
  const manualTokenValid = Boolean(
    process.env.CRON_MANUAL_TOKEN &&
    manualToken &&
    manualToken === process.env.CRON_MANUAL_TOKEN
  );
  const allowManualControls = !isProduction() || manualTokenValid;

  const cronSecret = process.env.CRON_SECRET;
  const providedSecret = request.headers.get('x-cron-secret');
  const authHeader = request.headers.get('authorization') || '';
  const bearerSecret = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const secretValid = cronSecret && (providedSecret === cronSecret || bearerSecret === cronSecret);

  if (cronSecret && !manualTokenValid && !secretValid) {
    return { authorized: false, dryRun: false, force: false, status: 401 };
  }

  // Fail closed in production when no secret is configured. A spoofable
  // x-vercel-cron header must never authenticate on its own (FF-018); only a
  // valid manual token (itself a configured secret) is accepted here.
  if (!cronSecret && isProduction() && !manualTokenValid) {
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
 * Returns the day of the week in London timezone (0=Sunday, 6=Saturday).
 *
 * @param {Date} [date] instant to evaluate (defaults to now).
 * @returns {number}
 */
export function getLondonDayOfWeek(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TIME_ZONE,
    weekday: 'short',
  });
  const weekday = formatter.format(date);
  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return dayMap[weekday] ?? date.getDay();
}

/**
 * True when the London day is Saturday or Sunday. Used to keep the automated
 * planner and digest email to the Monday–Friday working week.
 *
 * @param {Date} [date] instant to evaluate (defaults to now).
 * @returns {boolean}
 */
export function isLondonWeekend(date = new Date()) {
  const day = getLondonDayOfWeek(date);
  return day === 0 || day === 6;
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
        // A row already exists for this (operation, run_date). If the previous
        // attempt FAILED, allow a retry to reclaim it so one transient error
        // doesn't skip the whole day (FF-022). Otherwise the day is done.
        const { data: existing, error: fetchError } = await supabase
          .from('cron_runs')
          .select('id, status')
          .eq('operation', operation)
          .eq('run_date', runDate)
          .maybeSingle();

        if (fetchError) throw fetchError;

        if (existing?.status === 'failed') {
          // Conditional update on status='failed' makes the reclaim atomic:
          // if a concurrent retry flipped it to 'claimed' first, no row matches
          // and we fall through to already_run.
          const { data: reclaimed, error: reclaimError } = await supabase
            .from('cron_runs')
            .update({ status: 'claimed', error: null })
            .eq('id', existing.id)
            .eq('status', 'failed')
            .select('id')
            .maybeSingle();

          if (reclaimError) throw reclaimError;
          if (reclaimed?.id) {
            return { claimed: true, runId: reclaimed.id, reason: 'reclaimed' };
          }
        }

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
