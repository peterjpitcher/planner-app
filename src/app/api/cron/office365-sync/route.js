import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { syncOffice365All } from '@/services/office365SyncService';

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

export async function GET(request) {
  const vercelCronHeader = request.headers.get('x-vercel-cron');
  const userAgent = request.headers.get('user-agent') || '';
  const isVercelCron = userAgent.includes('vercel-cron');
  const cronSecret = process.env.CRON_SECRET;
  const providedSecret = request.headers.get('x-cron-secret');
  if (cronSecret) {
    if (providedSecret !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else if (isProduction() && !vercelCronHeader && !isVercelCron) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabaseServiceRole();
  const { data: connections, error } = await supabase
    .from('office365_connections')
    .select('user_id')
    .eq('sync_enabled', true);

  if (error) {
    console.error('Office365 cron: failed to load connections:', error);
    return NextResponse.json({ error: 'Failed to load Office365 connections' }, { status: 500 });
  }

  const results = [];
  for (const connection of connections || []) {
    const userId = connection.user_id;
    if (!userId) continue;
    try {
      const result = await syncOffice365All({ userId });
      results.push({ userId, ok: true, ...result });
    } catch (err) {
      console.error('Office365 cron: sync failed for user:', userId, err);
      results.push({ userId, ok: false, error: String(err?.message || err) });
    }
  }

  const okCount = results.filter((r) => r.ok).length;

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
