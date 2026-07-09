import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { verifyCronAuth } from '@/lib/cronAuth';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { syncOffice365All } from '@/services/office365SyncService';

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
      results.push({ userId, ok: true, ...result });
    } catch (err) {
      console.error('Office365 cron: sync failed for user:', userId, err);
      results.push({ userId, ok: false, error: String(err?.message || err) });
    }
  }

  const okCount = results.filter((r) => r.ok && !r.skipped).length;

  if (okCount > 0) {
    revalidatePath('/tasks');
  }

  return NextResponse.json({
    ok: true,
    syncedUsers: okCount,
    totalUsers: results.length,
    results,
  });
}
