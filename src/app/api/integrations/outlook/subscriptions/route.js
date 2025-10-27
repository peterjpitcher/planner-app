import { NextResponse } from 'next/server';

import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { getConnection } from '@/services/outlookSyncService';
import { createTodoSubscription, renewTodoSubscription } from '@/lib/microsoftGraphClient';
import { isAuthorizedCron } from '@/lib/cronAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;
export const preferredRegion = 'fra1';

const MAX_TODO_SUBSCRIPTION_MINUTES = 4230; // documented Graph maximum for todoTask subscriptions

function getRenewBeforeMinutes() {
  const minutes = parseInt(process.env.OUTLOOK_RENEW_BEFORE_MIN ?? '360', 10);
  return Number.isNaN(minutes) ? 360 : Math.max(minutes, 1);
}

function getRequestedDurationMinutes() {
  const requested = parseInt(process.env.OUTLOOK_SUBSCRIPTION_DURATION_MIN ?? '1440', 10);
  if (Number.isNaN(requested)) {
    return 1440;
  }
  return Math.min(requested, MAX_TODO_SUBSCRIPTION_MINUTES);
}

async function listActiveProjectLists(supabase) {
  const { data, error } = await supabase
    .from('project_outlook_lists')
    .select('id, user_id, graph_list_id, subscription_id, subscription_expires_at')
    .eq('is_active', true);

  if (error) {
    throw error;
  }

  return data || [];
}

async function createOrRenewSubscription({
  supabase,
  connection,
  projectList,
  expiresMinutes,
  renewBeforeMinutes,
  webhookUrl,
  clientState
}) {
  if (!webhookUrl) {
    throw new Error('Missing OUTLOOK_WEBHOOK_URL environment variable');
  }

  const now = Date.now();
  const expiresAt = projectList.subscription_expires_at
    ? new Date(projectList.subscription_expires_at).getTime()
    : 0;
  const minutesLeft = Math.floor((expiresAt - now) / 60000);
  const needsCreate = !projectList.subscription_id;
  const needsRenew = !needsCreate && minutesLeft < renewBeforeMinutes;

  if (!needsCreate && !needsRenew) {
    return null;
  }

  if (needsCreate) {
    const created = await createTodoSubscription(
      connection.accessToken,
      projectList.graph_list_id,
      webhookUrl,
      expiresMinutes,
      clientState
    );

    await supabase
      .from('project_outlook_lists')
      .update({
        subscription_id: created.id,
        subscription_expires_at: created.expirationDateTime
      })
      .eq('id', projectList.id);

    return { action: 'created', listId: projectList.graph_list_id };
  }

  try {
    const renewed = await renewTodoSubscription(
      connection.accessToken,
      projectList.subscription_id,
      expiresMinutes
    );

    await supabase
      .from('project_outlook_lists')
      .update({ subscription_expires_at: renewed?.expirationDateTime ?? new Date(Date.now() + expiresMinutes * 60000).toISOString() })
      .eq('id', projectList.id);

    return { action: 'renewed', listId: projectList.graph_list_id };
  } catch (error) {
    if (error?.status === 404) {
      // Subscription no longer exists; clear it so the next run recreates
      await supabase
        .from('project_outlook_lists')
        .update({ subscription_id: null, subscription_expires_at: null })
        .eq('id', projectList.id);
      return { action: 'reset', listId: projectList.graph_list_id };
    }
    throw error;
  }
}

export async function POST(request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabaseServiceRole();
  const webhookUrl = process.env.OUTLOOK_WEBHOOK_URL;
  const clientState = process.env.OUTLOOK_CLIENT_STATE;
  const renewBeforeMinutes = getRenewBeforeMinutes();
  const requestedDuration = getRequestedDurationMinutes();

  const projectLists = await listActiveProjectLists(supabase);
  if (projectLists.length === 0) {
    return NextResponse.json({ processed: 0, results: [] });
  }

  const results = [];
  const connectionCache = new Map();

  for (const list of projectLists) {
    if (!connectionCache.has(list.user_id)) {
      const connection = await getConnection(list.user_id).catch(() => null);
      connectionCache.set(list.user_id, connection);
    }

    const connection = connectionCache.get(list.user_id);
    if (!connection) {
      results.push({ listId: list.graph_list_id, status: 'skipped', reason: 'no_connection' });
      continue;
    }

    try {
      const outcome = await createOrRenewSubscription({
        supabase,
        connection,
        projectList: list,
        expiresMinutes: requestedDuration,
        renewBeforeMinutes,
        webhookUrl,
        clientState
      });

      if (outcome) {
        results.push({ listId: list.graph_list_id, status: outcome.action });
      }
    } catch (error) {
      console.error('Subscription maintenance failed', {
        listId: list.graph_list_id,
        userId: list.user_id,
        error: error?.message || error
      });
      results.push({ listId: list.graph_list_id, status: 'failed', error: error?.message || String(error) });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}

export async function GET() {
  return NextResponse.json(
    { error: 'Method Not Allowed' },
    {
      status: 405,
      headers: {
        Allow: 'POST'
      }
    }
  );
}
