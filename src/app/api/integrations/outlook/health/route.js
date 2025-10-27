import { NextResponse } from 'next/server';

import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { isAuthorizedCron } from '@/lib/cronAuth';

function addWarning(warnings, condition, message) {
  if (condition) {
    warnings.push(message);
  }
}

export async function GET(request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabaseServiceRole();

  const [
    connectionsCountRes,
    expiringConnectionsRes,
    activeListsCountRes,
    missingListMappingsRes,
    pendingJobsRes,
    processingJobsRes,
    failedJobsRes,
    oldestPendingRes,
    lastCompletedRes,
    lastFailedRes
  ] = await Promise.all([
    supabase.from('outlook_connections').select('user_id', { count: 'exact', head: true }),
    supabase
      .from('outlook_connections')
      .select('user_id, access_token_expires_at')
      .not('access_token_expires_at', 'is', null),
    supabase
      .from('project_outlook_lists')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true),
    supabase
      .from('project_outlook_lists')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .is('graph_list_id', null),
    supabase
      .from('task_sync_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    supabase
      .from('task_sync_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'processing'),
    supabase
      .from('task_sync_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed'),
    supabase
      .from('task_sync_jobs')
      .select('scheduled_at')
      .eq('status', 'pending')
      .order('scheduled_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('task_sync_jobs')
      .select('processed_at')
      .eq('status', 'completed')
      .order('processed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('task_sync_jobs')
      .select('updated_at, last_error')
      .eq('status', 'failed')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  const warnings = [];

  const totalConnections = connectionsCountRes.count || 0;
  const expiringSoon = (expiringConnectionsRes.data || []).filter((row) => {
    if (!row.access_token_expires_at) {
      return false;
    }
    return new Date(row.access_token_expires_at).getTime() <= Date.now() + 60 * 60 * 1000;
  }).length;

  const pendingJobs = pendingJobsRes.count || 0;
  const processingJobs = processingJobsRes.count || 0;
  const failedJobs = failedJobsRes.count || 0;
  const activeLists = activeListsCountRes.count || 0;
  const missingActiveLists = missingListMappingsRes.count || 0;

  addWarning(warnings, expiringSoon > 0, `${expiringSoon} connection(s) have tokens expiring within 1 hour.`);
  addWarning(warnings, pendingJobs > 50, `Queue backlog high: ${pendingJobs} pending job(s).`);
  addWarning(warnings, failedJobs > 0, `${failedJobs} job(s) are marked failed.`);
  addWarning(warnings, missingActiveLists > 0, `${missingActiveLists} active project(s) lack a Graph list id.`);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    connections: {
      total: totalConnections,
      expiringWithinHour: expiringSoon
    },
    lists: {
      active: activeLists,
      activeWithoutGraphId: missingActiveLists
    },
    queue: {
      pending: pendingJobs,
      processing: processingJobs,
      failed: failedJobs,
      oldestPendingScheduledAt: oldestPendingRes.data?.scheduled_at || null,
      lastCompletedAt: lastCompletedRes.data?.processed_at || null,
      lastFailure: lastFailedRes.data
        ? {
            at: lastFailedRes.data.updated_at,
            error: lastFailedRes.data.last_error
          }
        : null
    },
    warnings
  });
}
