import { NextResponse } from 'next/server';
import { verifyCronAuth, claimCronRun, updateCronRun } from '@/lib/cronAuth';
import { getLondonDateKey } from '@/lib/timezone';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { reconcileAttachments } from '@/services/attachmentService';

/**
 * Weekly tidy-up of storage that got out of step with the database.
 *
 * Two cases, both normal rather than exceptional:
 *   - an upload that got a signed URL and a pending row but never finalised,
 *     because the browser was closed or the network dropped
 *   - a delete that marked the row and then failed to remove the object
 *
 * Database driven, not a bucket scan. storage.list() returns 100 objects by
 * default and lists a single folder level, so listing the bucket and comparing
 * would silently stop after 100 rows and never recurse into the per-user
 * folders, giving false confidence that there was nothing to clean up.
 *
 * The result is written to cron_runs like every other cron here, so a repeated
 * failure is visible rather than buried in serverless logs.
 */
export async function GET(request) {
  let supabase;
  let runId = null;
  try {
    const auth = verifyCronAuth(request);
    if (!auth.authorized) {
      const msg = auth.status === 401 ? 'Unauthorized' : 'Forbidden';
      return NextResponse.json({ error: msg }, { status: auth.status });
    }

    // Preview requests must not claim a run or touch Storage.
    if (auth.dryRun) {
      return NextResponse.json({ dryRun: true, skipped: true, reason: 'dry_run' });
    }

    supabase = getSupabaseServiceRole();
    const runDate = getLondonDateKey();
    const claim = await claimCronRun({
      supabase,
      operation: 'reconcile-attachments',
      runDate,
    });
    if (!claim.claimed) {
      return NextResponse.json({ skipped: true, reason: claim.reason }, { status: 200 });
    }
    runId = claim.runId;

    const { data } = await reconcileAttachments({ supabase });

    if (runId) {
      await updateCronRun({
        supabase,
        runId,
        patch: {
          // Failed runs are reclaimable on the same date. Cleanup preserves
          // unfinished rows, so a retry can safely finish only those remaining.
          status: data.failures > 0 ? 'failed' : 'success',
          tasks_affected: data.stalePendingRemoved + data.stuckDeletesCompleted,
          error: data.failures > 0 ? `${data.failures} attachment cleanup operation(s) failed` : null,
        },
      });
    }

    return NextResponse.json({ data }, { status: data.failures > 0 ? 500 : 200 });
  } catch (error) {
    console.error('GET /api/cron/reconcile-attachments error:', error);
    if (supabase && runId) {
      try {
        await updateCronRun({ supabase, runId, patch: { status: 'failed', error: String(error?.message || error) } });
      } catch (trackingError) {
        console.error('Attachment cleanup failure could not be recorded:', trackingError);
      }
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
