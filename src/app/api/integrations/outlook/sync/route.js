import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';

import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { processTaskSyncJobs } from '@/services/outlookSyncService';
import { enqueueTaskSyncJob } from '@/services/taskSyncQueue';
import { isAuthorizedCron } from '@/lib/cronAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;
export const preferredRegion = 'fra1';

function parseRequestedLimit(request) {
  const headerValue = request.headers.get('x-sync-limit');
  const parsed = parseInt(headerValue ?? '25', 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return 25;
  }
  return Math.min(parsed, 250);
}

async function handleSyncQueue(request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit = parseRequestedLimit(request);

  try {
    const results = await processTaskSyncJobs(limit);
    return NextResponse.json({ processed: results.length, results });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || 'Failed to process sync jobs' },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  return handleSyncQueue(request);
}

export async function GET() {
  return NextResponse.json(
    { error: 'Method Not Allowed' },
    {
      status: 405,
      headers: {
        Allow: 'POST, PUT'
      }
    }
  );
}

export async function PUT() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await enqueueTaskSyncJob({
    userId: session.user.id,
    action: 'full_sync'
  });

  return NextResponse.json({ success: true });
}
