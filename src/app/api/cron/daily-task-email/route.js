import { NextResponse } from 'next/server';
import { getTimeZoneParts, LONDON_TIME_ZONE } from '@/lib/timezone';
import { verifyCronAuth } from '@/lib/cronAuth';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { sendMicrosoftEmail } from '@/lib/microsoftGraph';
import { buildDailyTaskEmail, fetchOutstandingTasks, resolveDigestUserId } from '@/services/dailyTaskEmailService';

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
    const auth = verifyCronAuth(request);
    if (!auth.authorized) {
      const msg = auth.status === 401 ? 'Unauthorized' : 'Forbidden';
      return NextResponse.json({ error: msg }, { status: auth.status });
    }

    const digestTimeZone = getDigestTimeZone();
    const sendHour = parseNumber(process.env.DAILY_TASK_EMAIL_HOUR, 8);
    const sendMinute = parseNumber(process.env.DAILY_TASK_EMAIL_MINUTE, 0);
    const windowMinutes = parseNumber(process.env.DAILY_TASK_EMAIL_WINDOW_MINUTES, 12);

    const now = new Date();
    const shouldSendNow =
      auth.force ||
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

    // Wave 4 digest gating: honour the owner's Morning digest email off switch.
    // Only skip when the setting is explicitly false — an absent row, a null, or
    // a failed read all fall through and send, so the digest never stops
    // silently on a transient error. Mirrors the other early-return skips (no
    // run row recorded), leaving idempotency untouched.
    const { data: digestSettings } = await supabase
      .from('user_settings')
      .select('digest_enabled')
      .eq('user_id', userId)
      .maybeSingle();
    if (digestSettings?.digest_enabled === false) {
      return NextResponse.json({ sent: false, reason: 'digest_disabled' }, { status: 200 });
    }

    const { dueToday, overdue, inboxCount, digest } = await fetchOutstandingTasks({
      supabase,
      userId,
      todayDateKey: runDateKey,
    });

    const email = buildDailyTaskEmail({
      todayDateKey: runDateKey,
      digest,
      dueToday,
      overdue,
      inboxCount,
      dashboardUrl: process.env.DIGEST_DASHBOARD_URL,
      timeZone: digestTimeZone,
    });

    if (!email) {
      // Record a lightweight 'skipped' run so the automation heartbeat tracks the
      // last cron EXECUTION, not just the last send — otherwise a run of genuinely
      // empty days would falsely read as "hasn't run recently". Skip on dry-run.
      if (!auth.dryRun) {
        const claim = await claimDailyRun({ supabase, userId, runDateKey, toEmail, counts: { dueToday: 0, overdue: 0 } });
        if (claim.claimed && claim.runId) {
          await updateDailyRun({ supabase, runId: claim.runId, patch: { status: 'skipped' } });
        }
      }
      return NextResponse.json({ sent: false, reason: 'no_outstanding_tasks' }, { status: 200 });
    }

    // Run-tracking counts recorded on daily_task_email_runs. Since the A4 digest
    // rebuild, dueToday is ALL Today-state tasks (not only those due today) and
    // overdue is every overdue task not in Today/done — broader populations than
    // the original due-today/overdue-in-Today columns implied. Kept for volume
    // tracking; not used for user-facing content.
    const counts = { dueToday: dueToday.length, overdue: overdue.length };

    if (auth.dryRun) {
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
