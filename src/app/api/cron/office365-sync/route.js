import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { verifyCronAuth } from '@/lib/cronAuth';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { syncOffice365All } from '@/services/office365SyncService';
import { clearOffice365SyncFailure, recordOffice365SyncFailure } from '@/services/office365ConnectionService';

// Minimum minutes since a user's last completed sync before the cron will start
// another one. Lightweight guard (FF-041) against the every-minute cron piling
// on top of the fire-and-forget auto-sync fired by GET /api/tasks, which can
// create duplicate remote tasks/lists. It mirrors maybeAutoSyncOffice365's
// interval check. NOTE: this is a mitigation, not a hard lock — two syncs that
// both read a still-stale last_synced_at can still overlap; true per-user
// serialisation belongs inside the sync service.
function getMinSyncIntervalMinutes() {
  const value = Number(process.env.OFFICE365_AUTO_SYNC_MINUTES || 2);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export async function GET(request) {
  // Shared cron auth (FF-009): accepts the Vercel `Authorization: Bearer
  // <CRON_SECRET>` header and inherits the fail-closed behaviour of FF-018,
  // matching the other three cron routes.
  const auth = verifyCronAuth(request);
  if (!auth.authorized) {
    const msg = auth.status === 401 ? 'Unauthorized' : 'Forbidden';
    return NextResponse.json({ error: msg }, { status: auth.status });
  }

  const supabase = getSupabaseServiceRole();
  const { data: connections, error } = await supabase
    .from('office365_connections')
    .select('user_id, last_synced_at')
    .eq('sync_enabled', true);

  if (error) {
    console.error('Office365 cron: failed to load connections:', error);
    return NextResponse.json({ error: 'Failed to load Office365 connections' }, { status: 500 });
  }

  const minIntervalMinutes = auth.force ? 0 : getMinSyncIntervalMinutes();
  const now = Date.now();

  const results = [];
  for (const connection of connections || []) {
    const userId = connection.user_id;
    if (!userId) continue;

    // FF-041: skip users synced within the min interval to avoid overlapping
    // the tasks-GET auto-sync and creating duplicate remote tasks/lists.
    if (minIntervalMinutes > 0 && connection.last_synced_at) {
      const minutesSince = (now - new Date(connection.last_synced_at).getTime()) / 60000;
      if (Number.isFinite(minutesSince) && minutesSince < minIntervalMinutes) {
        results.push({ userId, ok: true, skipped: 'recent', minutesSince });
        continue;
      }
    }

    try {
      const result = await syncOffice365All({ userId });
      // A run that completed clears any failure recorded by an earlier one, so
      // a transient Graph blip does not leave a permanent warning on screen.
      await clearOffice365SyncFailure({ userId });
      results.push({ userId, ok: true, ...result });
    } catch (err) {
      // Record it on the connection, which is what the automations panel reads.
      // Previously this only logged to the console and still returned ok: true,
      // so a sync that had been dead for days reported "Syncing normally".
      console.error('Office365 cron: sync failed for user:', userId, err);
      await recordOffice365SyncFailure({ userId, message: err?.message || err });
      results.push({ userId, ok: false, error: String(err?.message || err) });
    }
  }

  const okCount = results.filter((r) => r.ok && !r.skipped).length;
  const failedCount = results.filter((r) => !r.ok).length;

  if (okCount > 0) {
    revalidatePath('/tasks');
  }

  // Report the truth in the status field too. This returned ok: true whatever
  // happened, so an external check on the endpoint could never see a failure.
  return NextResponse.json(
    {
      ok: failedCount === 0,
      syncedUsers: okCount,
      failedUsers: failedCount,
      totalUsers: results.length,
      results,
    },
    { status: failedCount > 0 ? 500 : 200 }
  );
}
