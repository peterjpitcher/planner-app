import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';

import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabaseServiceRole();
  const { data, error } = await supabase
    .from('outlook_connections')
    .select('planner_list_id, access_token_expires_at, subscription_expiration, delta_token, updated_at, created_at')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'Failed to load Outlook connection status' }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    plannerListId: data.planner_list_id,
    connectedAt: data.created_at,
    updatedAt: data.updated_at,
    accessTokenExpiresAt: data.access_token_expires_at,
    subscriptionExpiresAt: data.subscription_expiration,
    hasDeltaToken: Boolean(data.delta_token)
  });
}
