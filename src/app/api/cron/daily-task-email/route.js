import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { isLondonTimeWindow, getLondonDateKey } from '@/lib/timezone';
import { sendMicrosoftEmail } from '@/lib/microsoftGraph';
import { buildDailyTaskEmail, fetchOutstandingTasks, resolveDigestUserId } from '@/services/dailyTaskEmailService';

function getBooleanSearchParam(url, name) {
  return url.searchParams.get(name) === 'true';
}

function isVercelCronRequest(request) {
  const header = request.headers.get('x-vercel-cron');
  return header === '1' || header === 'true';
}

async function claimDailyRun({ supabase, userId, runDateKey, toEmail, counts }) {
  try {
    const { data, error } = await supabase
      .from('daily_task_email_runs')
      .insert({
        user_id: userId,
        run_date: runDateKey,
        to_email: toEmail,
        status: 'claimed',
        due_today_count: counts?.dueToday ?? 0,
        overdue_count: counts?.overdue ?? 0,
      })
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') {
        return { claimed: false, reason: 'already_sent' };
      }

      // If the table isn't deployed yet, proceed without idempotency.
      if (String(error.message || '').toLowerCase().includes('does not exist')) {
        return { claimed: true, runId: null, reason: 'no_tracking_table' };
      }

      throw error;
    }

    return { claimed: true, runId: data?.id || null };
  } catch (err) {
    if (String(err?.message || '').toLowerCase().includes('does not exist')) {
      return { claimed: true, runId: null, reason: 'no_tracking_table' };
    }
    throw err;
  }
}

async function updateDailyRun({ supabase, runId, patch }) {
  if (!runId) return;
  await supabase.from('daily_task_email_runs').update(patch).eq('id', runId);
}

export async function GET(request) {
  try {
    const url = new URL(request.url);

    const isCron = isVercelCronRequest(request);
    const dryRun = getBooleanSearchParam(url, 'dryRun');
    const force = getBooleanSearchParam(url, 'force');
    const manualToken = url.searchParams.get('token');
    const manualTokenValid =
      !!process.env.CRON_MANUAL_TOKEN &&
      !!manualToken &&
      manualToken === process.env.CRON_MANUAL_TOKEN;
    const allowManualControls = process.env.NODE_ENV !== 'production' || manualTokenValid;

    if (process.env.NODE_ENV === 'production' && !isCron && !manualTokenValid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const windowMinutes = Number(process.env.DAILY_TASK_EMAIL_WINDOW_MINUTES || '5');
    const shouldSendNow =
      (allowManualControls && force) ||
      isLondonTimeWindow({ hour: 9, minute: 30, windowMinutes });

    if (!shouldSendNow) {
      return NextResponse.json(
        { skipped: true, reason: 'outside_send_window' },
        { status: 200 }
      );
    }

    const supabase = getSupabaseServer();
    const microsoftUserEmail = process.env.MICROSOFT_USER_EMAIL;
    if (!microsoftUserEmail) {
      return NextResponse.json({ error: 'Missing MICROSOFT_USER_EMAIL' }, { status: 500 });
    }

    const userId = await resolveDigestUserId({ supabase, email: microsoftUserEmail });
    const today = getLondonDateKey();
    const { dueToday, overdue } = await fetchOutstandingTasks({ supabase, userId, todayDateKey: today });

    const email = buildDailyTaskEmail({
      todayDateKey: today,
      dueToday,
      overdue,
      dashboardUrl: process.env.DIGEST_DASHBOARD_URL,
    });

    if (!email) {
      return NextResponse.json({ sent: false, reason: 'no_outstanding_tasks' }, { status: 200 });
    }

    const counts = { dueToday: dueToday.length, overdue: overdue.length };

    if (allowManualControls && dryRun) {
      return NextResponse.json({ sent: false, dryRun: true, counts }, { status: 200 });
    }

    const claim = await claimDailyRun({
      supabase,
      userId,
      runDateKey: today,
      toEmail: microsoftUserEmail,
      counts,
    });

    if (!claim.claimed) {
      return NextResponse.json({ sent: false, reason: claim.reason }, { status: 200 });
    }

    try {
      await sendMicrosoftEmail({
        fromUser: microsoftUserEmail,
        to: microsoftUserEmail,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });

      await updateDailyRun({
        supabase,
        runId: claim.runId,
        patch: { status: 'sent', sent_at: new Date().toISOString() },
      });

      return NextResponse.json({ sent: true, counts }, { status: 200 });
    } catch (sendError) {
      await updateDailyRun({
        supabase,
        runId: claim.runId,
        patch: {
          status: 'failed',
          error: String(sendError?.message || sendError),
        },
      });

      throw sendError;
    }
  } catch (error) {
    console.error('Daily task email cron failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
