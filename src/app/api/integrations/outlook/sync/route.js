import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';

import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { processTaskSyncJobs } from '@/services/outlookSyncService';
import { enqueueTaskSyncJob } from '@/services/taskSyncQueue';

function isAuthorizedCron(request) {
  const secret = process.env.OUTLOOK_SYNC_JOB_SECRET;
  if (!secret) {
    return true;
  }

  const bearer = request.headers.get('authorization');
  if (bearer === `Bearer ${secret}`) {
    return true;
  }

  const legacySecret = request.headers.get('x-outlook-sync-secret');
  return legacySecret === secret;
}

async function handleSyncQueue(request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit = parseInt(request.headers.get('x-sync-limit') || '25', 10);

  try {
    const results = await processTaskSyncJobs(Number.isNaN(limit) ? 25 : limit);
    return NextResponse.json({ processed: results.length, results });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Failed to process sync jobs' }, { status: 500 });
  }
}

export async function POST(request) {
  return handleSyncQueue(request);
}

export async function GET(request) {
  return handleSyncQueue(request);
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
