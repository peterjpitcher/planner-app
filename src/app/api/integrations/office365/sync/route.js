import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { syncOffice365All } from '@/services/office365SyncService';

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await syncOffice365All({ userId: session.user.id });
    revalidatePath('/tasks');
    return NextResponse.json({ synced: true, ...result });
  } catch (err) {
    console.error('Office365 sync error:', err);
    return NextResponse.json({ error: 'Office365 sync failed' }, { status: 500 });
  }
}

