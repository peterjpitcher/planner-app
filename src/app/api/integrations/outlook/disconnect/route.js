import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';

import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { deleteSecret } from '@/lib/supabaseVault';

export async function POST() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabaseServiceRole();

  const { data: connection, error: fetchError } = await supabase
    .from('outlook_connections')
    .select('refresh_token_secret')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: 'Failed to load Outlook connection' }, { status: 500 });
  }

  await supabase
    .from('task_sync_state')
    .delete()
    .eq('user_id', session.user.id);

  const { error: deleteError } = await supabase
    .from('outlook_connections')
    .delete()
    .eq('user_id', session.user.id);

  if (deleteError) {
    return NextResponse.json({ error: 'Failed to remove Outlook connection' }, { status: 500 });
  }

  if (connection?.refresh_token_secret) {
    try {
      await deleteSecret(connection.refresh_token_secret);
    } catch (secretError) {
      console.error('Failed to delete Outlook refresh token secret:', secretError);
    }
  }

  return NextResponse.json({ success: true });
}
