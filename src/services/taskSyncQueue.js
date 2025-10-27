import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';

export async function enqueueTaskSyncJob({ userId, taskId, action, metadata = {}, scheduleAt }) {
  if (!userId || !action) {
    return false;
  }

  const supabase = getSupabaseServiceRole();

  if (action === 'full_sync') {
    const { data: existingJob, error: lookupError } = await supabase
      .from('task_sync_jobs')
      .select('id')
      .eq('user_id', userId)
      .eq('action', 'full_sync')
      .in('status', ['pending', 'processing'])
      .maybeSingle();

    if (lookupError) {
      console.error('Failed to check existing full_sync job', lookupError);
    } else if (existingJob?.id) {
      return false;
    }
  }

  const payload = {
    user_id: userId,
    task_id: taskId || null,
    action,
    payload: metadata,
    scheduled_at: scheduleAt || new Date().toISOString()
  };

  const { error } = await supabase
    .from('task_sync_jobs')
    .insert(payload);

  if (error) {
    if (action === 'full_sync' && error.code === '23505') {
      return false;
    }
    console.error('Failed to enqueue task sync job', error);
    return false;
  }

  return true;
}

export async function claimTaskSyncJobs(limit = 25, workerId) {
  const supabase = getSupabaseServiceRole();
  const { data, error } = await supabase.rpc('claim_task_sync_jobs', {
    job_limit: limit,
    worker_uuid: workerId || null
  });

  if (error) {
    console.error('Failed to claim task sync jobs', error);
    return [];
  }

  return data || [];
}

export async function markTaskSyncJobCompleted(jobId, attempts) {
  const supabase = getSupabaseServiceRole();
  await supabase
    .from('task_sync_jobs')
    .update({
      status: 'completed',
      attempts,
      last_error: null,
      processed_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', jobId);
}

export async function markTaskSyncJobFailed(jobId, errorMessage, attempts) {
  const supabase = getSupabaseServiceRole();
  await supabase
    .from('task_sync_jobs')
    .update({
      status: 'failed',
      last_error: errorMessage?.slice(0, 1000) || null,
      attempts,
      heartbeat_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', jobId);
}

export async function markTaskSyncJobDeferred(jobId, attempts, retrySeconds, errorMessage) {
  const supabase = getSupabaseServiceRole();
  const delay = Math.max(retrySeconds || 1, 1);
  await supabase
    .from('task_sync_jobs')
    .update({
      status: 'pending',
      last_error: errorMessage?.slice(0, 1000) || null,
      attempts,
      scheduled_at: new Date(Date.now() + delay * 1000).toISOString(),
      heartbeat_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', jobId);
}

export async function updateTaskSyncJobHeartbeat(jobId) {
  const supabase = getSupabaseServiceRole();
  await supabase
    .from('task_sync_jobs')
    .update({
      heartbeat_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', jobId);
}
