import { NextResponse } from 'next/server';
import { getTimeZoneParts, LONDON_TIME_ZONE } from '@/lib/timezone';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { sendMicrosoftEmail } from '@/lib/microsoftGraph';
import { buildDailyTaskEmail, fetchOutstandingTasks, resolveDigestUserId } from '@/services/dailyTaskEmailService';

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function isVercelCronRequest(request) {
  const header = request.headers.get('x-vercel-cron');
  const userAgent = request.headers.get('user-agent') || '';
  return header === '1' || header === 'true' || userAgent.includes('vercel-cron');
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getBooleanSearchParam(url, name) {
  return url.searchParams.get(name) === 'true';
}

function getDigestTimeZone() {
  const value = (process.env.DAILY_TASK_EMAIL_TIME_ZONE || LONDON_TIME_ZONE).trim();
  return value || LONDON_TIME_ZONE;
}

function isTimeWindowInZone({ date = new Date(), hour, minute, windowMinutes = 0, timeZone }) {
  const parts = getTimeZoneParts(date, timeZone);
  if (parts.hour !== hour) return false;

  if (!windowMinutes || windowMinutes <= 0) {
    return parts.minute === minute;
  }

  return parts.minute >= minute && parts.minute < (minute + windowMinutes);
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

      // Allow sending even if the tracking table is not deployed yet.
      if (String(error.message || '').toLowerCase().includes('does not exist')) {
        return { claimed: true, runId: null, reason: 'no_tracking_table' };
      }

      throw error;
    }

    return { claimed: true, runId: data?.id || null };
  } catch (error) {
    if (String(error?.message || '').toLowerCase().includes('does not exist')) {
      return { claimed: true, runId: null, reason: 'no_tracking_table' };
    }
    throw error;
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
    const manualTokenValid = Boolean(
      process.env.CRON_MANUAL_TOKEN &&
      manualToken &&
      manualToken === process.env.CRON_MANUAL_TOKEN
    );
    const allowManualControls = !isProduction() || manualTokenValid;

    const cronSecret = process.env.CRON_SECRET;
    const providedSecret = request.headers.get('x-cron-secret');
    if (cronSecret && !manualTokenValid && providedSecret !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!cronSecret && isProduction() && !isCron && !manualTokenValid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const digestTimeZone = getDigestTimeZone();
    const sendHour = parseNumber(process.env.DAILY_TASK_EMAIL_HOUR, 8);
    const sendMinute = parseNumber(process.env.DAILY_TASK_EMAIL_MINUTE, 0);
    const windowMinutes = parseNumber(process.env.DAILY_TASK_EMAIL_WINDOW_MINUTES, 12);

    const now = new Date();
    const shouldSendNow =
      (allowManualControls && force) ||
      isTimeWindowInZone({
        date: now,
        hour: sendHour,
        minute: sendMinute,
        windowMinutes,
        timeZone: digestTimeZone,
      });

    if (!shouldSendNow) {
      return NextResponse.json(
        {
          skipped: true,
          reason: 'outside_send_window',
          sendHour,
          sendMinute,
          windowMinutes,
          digestTimeZone,
        },
        { status: 200 }
      );
    }

    const fromEmail = (process.env.DAILY_TASK_EMAIL_FROM || process.env.MICROSOFT_USER_EMAIL || '').trim();
    const toEmail = (process.env.DAILY_TASK_EMAIL_TO || process.env.MICROSOFT_USER_EMAIL || '').trim();
    if (!fromEmail || !toEmail) {
      return NextResponse.json(
        { error: 'Missing DAILY_TASK_EMAIL_FROM/TO (or MICROSOFT_USER_EMAIL fallback)' },
        { status: 500 }
      );
    }

    const digestUserEmail = (process.env.DIGEST_USER_EMAIL || toEmail || fromEmail).trim();
    const runDateKey = getTimeZoneParts(now, digestTimeZone).dateKey;
    const supabase = getSupabaseServiceRole();
    const userId = await resolveDigestUserId({ supabase, email: digestUserEmail });

    const { dueToday, overdue } = await fetchOutstandingTasks({
      supabase,
      userId,
      todayDateKey: runDateKey,
    });

    const email = buildDailyTaskEmail({
      todayDateKey: runDateKey,
      dueToday,
      overdue,
      dashboardUrl: process.env.DIGEST_DASHBOARD_URL,
      timeZone: digestTimeZone,
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
      runDateKey,
      toEmail,
      counts,
    });

    if (!claim.claimed) {
      return NextResponse.json({ sent: false, reason: claim.reason }, { status: 200 });
    }

    try {
      await sendMicrosoftEmail({
        fromUser: fromEmail,
        to: toEmail,
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
