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

export async function fetchPendingTaskSyncJobs(limit = 25) {
  const supabase = getSupabaseServiceRole();

  const { data, error } = await supabase
    .from('task_sync_jobs')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('Failed to fetch pending task sync jobs', error);
    return [];
  }

  return data || [];
}

export async function markTaskSyncJobProcessing(jobId, attempts) {
  const supabase = getSupabaseServiceRole();
  await supabase
    .from('task_sync_jobs')
    .update({ status: 'processing', attempts: (attempts || 0) + 1, updated_at: new Date().toISOString() })
    .eq('id', jobId);
}

export async function markTaskSyncJobCompleted(jobId) {
  const supabase = getSupabaseServiceRole();
  await supabase
    .from('task_sync_jobs')
    .update({ status: 'completed', processed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', jobId);
}

export async function markTaskSyncJobFailed(jobId, errorMessage, attempts) {
  const supabase = getSupabaseServiceRole();
  await supabase
    .from('task_sync_jobs')
    .update({
      status: 'failed',
      last_error: errorMessage?.slice(0, 1000) || null,
      attempts: (attempts || 0) + 1,
      updated_at: new Date().toISOString()
    })
    .eq('id', jobId);
}
