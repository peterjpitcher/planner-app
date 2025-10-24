import { NextResponse } from 'next/server';

import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { enqueueTaskSyncJob } from '@/services/taskSyncQueue';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const validationToken = searchParams.get('validationToken');

  if (validationToken) {
    return new Response(validationToken, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  return NextResponse.json({ error: 'Missing validation token' }, { status: 400 });
}

export async function POST(request) {
  try {
    const payload = await request.json();

    if (!Array.isArray(payload?.value)) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const subscriptionIds = [...new Set(payload.value.map((item) => item.subscriptionId).filter(Boolean))];

    if (subscriptionIds.length === 0) {
      return NextResponse.json({ success: true }, { status: 202 });
    }

    const supabase = getSupabaseServiceRole();
    const { data, error } = await supabase
      .from('outlook_connections')
      .select('user_id, subscription_id')
      .in('subscription_id', subscriptionIds);

    if (error) {
      return NextResponse.json({ error: 'Failed to load subscriptions' }, { status: 500 });
    }

    await Promise.all(
      (data || []).map((connection) =>
        enqueueTaskSyncJob({
          userId: connection.user_id,
          action: 'full_sync'
        })
      )
    );

    return NextResponse.json({ success: true }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Webhook processing failed' }, { status: 500 });
  }
}
