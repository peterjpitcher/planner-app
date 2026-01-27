import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { deleteOffice365Connection } from '@/services/office365ConnectionService';

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await deleteOffice365Connection({ userId: session.user.id });
    return NextResponse.json(result);
  } catch (err) {
    console.error('Office365 disconnect error:', err);
    return NextResponse.json({ error: 'Unable to disconnect Office365' }, { status: 500 });
  }
}

