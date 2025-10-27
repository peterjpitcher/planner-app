import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith('#')) {
      continue;
    }
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
const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
const MICROSOFT_TENANT_ID = process.env.MICROSOFT_TENANT_ID || 'common';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('Missing Supabase environment variables.');
}

if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET) {
  throw new Error('Missing Microsoft OAuth client credentials.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

const TERMINAL_STATUSES = ['Completed', 'Cancelled'];
const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const AUTH_BASE_URL = 'https://login.microsoftonline.com';

async function getConnectionForUser(userId) {
  const { data: connection, error } = await supabase
    .from('outlook_connections')
    .select('user_id, access_token, access_token_expires_at, refresh_token_secret')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error(`[cleanup] Failed to load connection for user ${userId}`, error);
    return null;
  }

  if (!connection) {
    return null;
  }

  let { access_token: accessToken, access_token_expires_at: expiresAtIso, refresh_token_secret: refreshSecretId } = connection;
  const expireThreshold = Date.now() + 2 * 60 * 1000;
  const expiresAt = expiresAtIso ? new Date(expiresAtIso).getTime() : 0;

  if (!accessToken || !expiresAt || expiresAt <= expireThreshold) {
    if (!refreshSecretId) {
      console.warn(`[cleanup] Missing refresh secret for user ${userId}`);
      return null;
    }

    const { data: refreshToken, error: secretError } = await supabase.rpc('public.vault_get_secret', {
      secret_id: refreshSecretId
    });

    if (secretError) {
      console.error(`[cleanup] Failed to load refresh token for user ${userId}`, secretError);
      return null;
    }

    if (!refreshToken) {
      console.warn(`[cleanup] Empty refresh token for user ${userId}`);
      return null;
    }

    const params = new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID,
      client_secret: MICROSOFT_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: 'offline_access Tasks.ReadWrite User.Read'
    });

    const tokenResponse = await fetch(`${AUTH_BASE_URL}/${MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });

    if (!tokenResponse.ok) {
      const errBody = await tokenResponse.json().catch(() => ({}));
      console.error(`[cleanup] Failed to refresh token for user ${userId}`, errBody);
      return null;
    }

    const refreshed = await tokenResponse.json();
    accessToken = refreshed.access_token;
    const newExpiresAt = new Date(Date.now() + (refreshed.expires_in - 60) * 1000).toISOString();

    await supabase
      .from('outlook_connections')
      .update({
        access_token: accessToken,
        access_token_expires_at: newExpiresAt
      })
      .eq('user_id', userId);

    if (refreshed.refresh_token && refreshed.refresh_token !== refreshToken) {
      await supabase.rpc('public.vault_update_secret', {
        secret_id: refreshSecretId,
        secret: refreshed.refresh_token
      });
    }
  }

  return { accessToken: accessToken, refreshSecretId };
}

async function deleteTodoList({ accessToken, listId }) {
  if (!listId) {
    return true;
  }

  const response = await fetch(`${GRAPH_BASE_URL}/me/todo/lists/${listId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (response.status === 404) {
    return true;
  }

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    console.error('[cleanup] Failed to delete list', listId, errBody);
    return false;
  }

  return true;
}

async function archiveClosedProjects() {
  const { data: rows, error } = await supabase
    .from('project_outlook_lists')
    .select('id, user_id, project_id, graph_list_id, is_active, projects(status)')
    .eq('is_active', true);

  if (error) {
    console.error('[cleanup] Failed to fetch project mappings', error);
    process.exit(1);
  }

  const targets = (rows || []).filter((row) => {
    const status = row.projects?.status;
    return row.graph_list_id && status && TERMINAL_STATUSES.includes(status);
  });

  console.log(`[cleanup] Found ${targets.length} closed projects with active Outlook lists.`);

  for (const row of targets) {
    const { user_id: userId, project_id: projectId, graph_list_id: listId, id: mappingId } = row;
    try {
      const connection = await getConnectionForUser(userId);
      if (!connection?.accessToken) {
        console.warn(`[cleanup] Skipping project ${projectId} (user ${userId}) - no connection.`);
        continue;
      }

      const deleted = await deleteTodoList({ accessToken: connection.accessToken, listId });

      await supabase
        .from('project_outlook_lists')
        .update({
          is_active: false,
          graph_list_id: null,
          graph_etag: null,
          subscription_id: null,
          subscription_expires_at: null,
          delta_token: null
        })
        .eq('id', mappingId);

      const { data: tasks } = await supabase
        .from('tasks')
        .select('id')
        .eq('project_id', projectId);

      const taskIds = (tasks || []).map((task) => task.id);

      if (taskIds.length > 0) {
        await supabase
          .from('task_sync_state')
          .delete()
          .in('task_id', taskIds);

        await supabase
          .from('task_sync_jobs')
          .delete()
          .in('task_id', taskIds);
      }

      console.log(`[cleanup] Archived project ${projectId} (user ${userId})${deleted ? '' : ' (list already absent)'}.`);
    } catch (err) {
      console.error(`[cleanup] Failed to archive project ${row.project_id} for user ${row.user_id}`, err);
    }
  }

  console.log('[cleanup] Done.');
}

archiveClosedProjects().then(() => process.exit(0)).catch((err) => {
  console.error('[cleanup] Unexpected error', err);
  process.exit(1);
});
