import { enqueueTaskSyncJob } from '@/services/taskSyncQueue';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function extractValidationToken(url) {
  const u = new URL(url);
  return (
    u.searchParams.get('validationToken') ||
    u.searchParams.get('validationtoken') ||
    null
  );
}

async function enqueueFullSyncsForSubscriptions(subscriptionIds = []) {
  if (subscriptionIds.length === 0) {
    return;
  }

  const supabase = getSupabaseServiceRole();
  const { data, error } = await supabase
    .from('project_outlook_lists')
    .select('user_id')
    .in('subscription_id', subscriptionIds);

  if (error) {
    console.error('Failed to resolve subscriptions', error);
    return;
  }

  const uniqueUserIds = Array.from(new Set((data || []).map((row) => row.user_id)));

  await Promise.all(
    uniqueUserIds.map((userId) =>
      enqueueTaskSyncJob({
        userId,
        action: 'full_sync'
      })
    )
  );
}

export async function GET(request) {
  const token = extractValidationToken(request.url);
  if (token) {
    return new Response(token, {
      status: 200,
      headers: { 'content-type': 'text/plain' }
    });
  }

  return new Response('OK', { status: 200 });
}

export async function POST(request) {
  const token = extractValidationToken(request.url);
  if (token) {
    return new Response(token, {
      status: 200,
      headers: { 'content-type': 'text/plain' }
    });
  }

  const payload = await request.json().catch(() => null);
  if (!payload?.value) {
    return new Response('Invalid payload', { status: 400 });
  }

  const expectedClientState = process.env.OUTLOOK_CLIENT_STATE;
  const trustedNotifications = expectedClientState
    ? payload.value.filter((item) => item.clientState === expectedClientState)
    : payload.value;

  if (trustedNotifications.length === 0) {
    return new Response(null, { status: 202 });
  }

  const subscriptionIds = Array.from(
    new Set(trustedNotifications.map((item) => item.subscriptionId).filter(Boolean))
  );

  await enqueueFullSyncsForSubscriptions(subscriptionIds);

  return new Response(null, { status: 202 });
}
