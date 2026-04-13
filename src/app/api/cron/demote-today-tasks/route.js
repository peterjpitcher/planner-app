import { NextResponse } from 'next/server';
import { verifyCronAuth, isLondonHour, claimCronRun, updateCronRun } from '@/lib/cronAuth';
import { getLondonDateKey } from '@/lib/timezone';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { sendMicrosoftEmail } from '@/lib/microsoftGraph';
import { resolveDigestUserId } from '@/services/dailyTaskEmailService';
import { updateTask } from '@/services/taskService';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function GET(request) {
  try {
    const auth = verifyCronAuth(request);
    if (!auth.authorized) {
      const msg = auth.status === 401 ? 'Unauthorized' : 'Forbidden';
      return NextResponse.json({ error: msg }, { status: auth.status });
    }

    if (!auth.force && !isLondonHour(20)) {
      return NextResponse.json(
        { skipped: true, reason: 'outside_window' },
        { status: 200 }
      );
    }

    const supabase = getSupabaseServiceRole();
    const runDate = getLondonDateKey();

    // Dry runs skip the idempotency claim so they don't block the real cron
    let runId = null;
    if (!auth.dryRun) {
      const claim = await claimCronRun({ supabase, operation: 'demote_today', runDate });
      if (!claim.claimed) {
        return NextResponse.json(
          { skipped: true, reason: claim.reason },
          { status: 200 }
        );
      }
      runId = claim.runId;
    }

    const digestUserEmail = (
      process.env.DIGEST_USER_EMAIL ||
      process.env.DAILY_TASK_EMAIL_TO ||
      process.env.MICROSOFT_USER_EMAIL ||
      ''
    ).trim();
    let userId;
    try {
      userId = await resolveDigestUserId({ supabase, email: digestUserEmail });
    } catch (err) {
      try { await updateCronRun({ supabase, runId, patch: { status: 'failed', error: String(err.message) } }); } catch {}
      throw err;
    }

    const { data: tasks, error: fetchError } = await supabase
      .from('tasks')
      .select('id, name, due_date, projects(name)')
      .eq('state', 'today')
      .eq('user_id', userId);

    if (fetchError) {
      try { await updateCronRun({ supabase, runId, patch: { status: 'failed', error: String(fetchError.message) } }); } catch {}
      throw fetchError;
    }

    if (!tasks || tasks.length === 0) {
      try { await updateCronRun({ supabase, runId, patch: { tasks_affected: 0, status: 'success' } }); } catch {}
      return NextResponse.json(
        { skipped: true, reason: 'no_tasks' },
        { status: 200 }
      );
    }

    if (auth.dryRun) {
      return NextResponse.json(
        { dryRun: true, tasksCount: tasks.length },
        { status: 200 }
      );
    }

    const demotedTasks = [];
    for (const task of tasks) {
      const result = await updateTask({
        supabase,
        userId,
        taskId: task.id,
        updates: { state: 'this_week' },
        options: { skipProjectTouch: true },
      });
      if (!result.error) {
        demotedTasks.push(task);
      }
    }

    const fromEmail = (
      process.env.DAILY_TASK_EMAIL_FROM ||
      process.env.MICROSOFT_USER_EMAIL ||
      ''
    ).trim();
    const toEmail = (
      process.env.DIGEST_USER_EMAIL ||
      process.env.DAILY_TASK_EMAIL_TO ||
      ''
    ).trim();

    let emailStatus = 'no_email';
    if (fromEmail && toEmail && demotedTasks.length > 0) {
      const taskListHtml = demotedTasks
        .map((t) => {
          const projectName = t.projects?.name ? ` (${escapeHtml(t.projects.name)})` : '';
          const dueDate = t.due_date ? ` &mdash; due ${escapeHtml(t.due_date)}` : '';
          return `<li>${escapeHtml(t.name)}${projectName}${dueDate}</li>`;
        })
        .join('\n');

      const subject = `Daily Review: ${demotedTasks.length} task${demotedTasks.length !== 1 ? 's' : ''} moved from Today to This Week`;
      const html = `<p>${subject}</p>\n<ul>\n${taskListHtml}\n</ul>`;
      const text = demotedTasks
        .map((t) => {
          const projectName = t.projects?.name ? ` (${t.projects.name})` : '';
          const dueDate = t.due_date ? ` - due ${t.due_date}` : '';
          return `- ${t.name}${projectName}${dueDate}`;
        })
        .join('\n');

      try {
        await sendMicrosoftEmail({
          fromUser: fromEmail,
          to: toEmail,
          subject,
          html,
          text,
        });
        emailStatus = 'sent';
      } catch (emailError) {
        console.error('Demote today email failed:', emailError);
        emailStatus = 'failed';
      }
    }

    const finalStatus = emailStatus === 'failed' ? 'partial' : 'success';
    try {
      await updateCronRun({
        supabase,
        runId,
        patch: { tasks_affected: demotedTasks.length, status: finalStatus },
      });
    } catch (runUpdateError) {
      console.error('Failed to update cron_runs status:', runUpdateError);
    }

    return NextResponse.json(
      { demoted: demotedTasks.length, emailStatus },
      { status: 200 }
    );
  } catch (error) {
    console.error('Demote today tasks cron failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
