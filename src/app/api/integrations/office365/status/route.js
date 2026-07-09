import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { getOffice365Connection } from '@/services/office365ConnectionService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const connection = await getOffice365Connection({ userId: session.user.id });
    return NextResponse.json({
      connected: Boolean(connection && connection.sync_enabled),
      syncEnabled: Boolean(connection?.sync_enabled),
      lastSyncedAt: connection?.last_synced_at || null,
      microsoftUserEmail: connection?.microsoft_user_email || null,
      // FF-011: expose the expired/revoked-token state so the settings UI can
      // show a "reconnect needed" prompt instead of a healthy connection.
      syncError: connection?.sync_error || null,
      syncErrorAt: connection?.sync_error_at || null,
      reconnectRequired: Boolean(connection?.sync_error),
    });
  } catch (err) {
    console.error('Office365 status error:', err);
    return NextResponse.json({ error: 'Unable to read Office365 status' }, { status: 500 });
  }
}

