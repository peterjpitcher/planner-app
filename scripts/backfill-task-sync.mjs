import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith('#')) continue;
    const match = line.match(/^([^=]+)=\"?(.*)\"?$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].replace(/"$/,'').trim();
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}

loadEnvFile(path.resolve(__dirname, '..', '.vercel', '.env.development.local'));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('Missing Supabase configuration in environment.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const [,, userId] = process.argv;
if (!userId) {
  console.error('Usage: node scripts/backfill-task-sync.mjs <user-id>');
  process.exit(1);
}

async function ensureProjectMappings(projectIds, accessToken) {
  if (projectIds.length === 0) return;

  const { data: existingMappings, error } = await supabase
    .from('project_outlook_lists')
    .select('project_id')
    .eq('user_id', userId)
    .in('project_id', projectIds);

  if (error) {
    console.error('[backfill] Failed to verify project mappings', error);
    return;
  }

  const mappedSet = new Set((existingMappings || []).map((row) => row.project_id));
  const missingProjects = projectIds.filter((id) => !mappedSet.has(id));

  if (missingProjects.length === 0) {
    return;
  }

  console.warn(`[backfill] The following projects have no Outlook list: ${missingProjects.join(', ')}`);
  console.warn('[backfill] Ensure the user triggers a sync or reconnects Outlook to provision them.');
}

const TERMINAL_PROJECT_STATUSES = new Set(['Completed', 'Cancelled']);

async function enqueueTaskJobs() {
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('id, project_id, is_completed, name, projects(status), task_sync_state(graph_task_id)')
    .eq('user_id', userId);

  if (error) {
    console.error('[backfill] Failed to fetch tasks', error);
    process.exit(1);
  }

  const needsCreate = [];
  let skippedTerminalProjects = 0;
  const projectIds = new Set();

  for (const task of tasks || []) {
    const projectStatus = task.projects?.status || null;
    const isTerminalProject = projectStatus ? TERMINAL_PROJECT_STATUSES.has(projectStatus) : false;

    if (isTerminalProject) {
      skippedTerminalProjects += 1;
      continue;
    }

    if (task.project_id) {
      projectIds.add(task.project_id);
    }
    if (!task.task_sync_state?.graph_task_id) {
      if (!task.name || !task.name.trim()) {
        console.warn(`[backfill] Skipping task ${task.id} (empty name)`);
        continue;
      }
      needsCreate.push(task);
    }
  }

  console.log(
    `[backfill] ${tasks?.length || 0} tasks total (${skippedTerminalProjects} skipped for terminal projects), ${needsCreate.length} missing sync state.`
  );

  await ensureProjectMappings(Array.from(projectIds), null);

  let created = 0;
  for (const task of needsCreate) {
    const payload = {
      user_id: userId,
      task_id: task.id,
      action: 'create',
      payload: { projectId: task.project_id },
      status: 'pending',
      scheduled_at: new Date().toISOString()
    };

    const { error: insertError } = await supabase
      .from('task_sync_jobs')
      .insert(payload);

    if (insertError) {
      if (insertError.code === '23505') {
        console.warn(`[backfill] Duplicate job skipped for task ${task.id}`);
        continue;
      }
      console.error(`[backfill] Failed to enqueue job for task ${task.id}`, insertError);
    } else {
      created += 1;
    }
  }

  console.log(`[backfill] Enqueued ${created} create jobs.`);

  const { error: fullSyncError } = await supabase
    .from('task_sync_jobs')
    .insert({
      user_id: userId,
      task_id: null,
      action: 'full_sync',
      status: 'pending',
      scheduled_at: new Date(Date.now() + 2000).toISOString()
    });

  if (fullSyncError && fullSyncError.code !== '23505') {
    console.error('[backfill] Failed to enqueue full sync job', fullSyncError);
  } else {
    console.log('[backfill] Enqueued a full_sync job.');
  }
}

enqueueTaskJobs().then(() => {
  console.log('[backfill] Done.');
  process.exit(0);
}).catch((err) => {
  console.error('[backfill] Unexpected error', err);
  process.exit(1);
});
