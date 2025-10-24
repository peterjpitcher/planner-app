import { NextResponse } from 'next/server';

import { renewOutlookSubscriptions } from '@/services/outlookSyncService';

function isAuthorized(request) {
  const secret = process.env.OUTLOOK_SYNC_JOB_SECRET;
  if (!secret) {
    return true;
  }

  return request.headers.get('x-outlook-sync-secret') === secret;
}

export async function POST(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const thresholdMinutes = parseInt(request.headers.get('x-renew-threshold') || '30', 10);

  try {
    const results = await renewOutlookSubscriptions(Number.isNaN(thresholdMinutes) ? 30 : thresholdMinutes);
    return NextResponse.json({ processed: results.length, results });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Failed to renew subscriptions' }, { status: 500 });
  }
}
