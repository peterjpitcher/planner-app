import { NextResponse } from 'next/server';
import { verifyCronAuth, isLondonHour, getLondonDayOfWeek, claimCronRun, updateCronRun } from '@/lib/cronAuth';
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

    if (!auth.force && getLondonDayOfWeek() !== 0) {
      return NextResponse.json(
        { skipped: true, reason: 'not_sunday' },
        { status: 200 }
      );
    }

    if (!auth.force && !isLondonHour(20)) {
      return NextResponse.json(
        { skipped: true, reason: 'outside_window' },
        { status: 200 }
      );
    }

    const supabase = getSupabaseServiceRole();
    const runDate = getLondonDateKey();

    const claim = await claimCronRun({ supabase, operation: 'demote_week', runDate });
    if (!claim.claimed) {
      return NextResponse.json(
        { skipped: true, reason: claim.reason },
        { status: 200 }
      );
    }

    const digestUserEmail = (
      process.env.DIGEST_USER_EMAIL ||
      process.env.DAILY_TASK_EMAIL_TO ||
      process.env.MICROSOFT_USER_EMAIL ||
      ''
    ).trim();
    const userId = await resolveDigestUserId({ supabase, email: digestUserEmail });

    const { data: tasks, error: fetchError } = await supabase
      .from('tasks')
      .select('id, name, due_date, projects(name)')
      .eq('state', 'this_week')
      .eq('user_id', userId);

    if (fetchError) {
      await updateCronRun({
        supabase,
        runId: claim.runId,
        patch: { status: 'failed', error: String(fetchError.message) },
      });
      throw fetchError;
    }

    if (!tasks || tasks.length === 0) {
      await updateCronRun({
        supabase,
        runId: claim.runId,
        patch: { tasks_affected: 0, status: 'success' },
      });
      return NextResponse.json(
        { skipped: true, reason: 'no_tasks' },
        { status: 200 }
      );
    }

    if (auth.dryRun) {
      await updateCronRun({
        supabase,
        runId: claim.runId,
        patch: { tasks_affected: tasks.length, status: 'dry_run' },
      });
      return NextResponse.json(
        { dryRun: true, tasksCount: tasks.length },
        { status: 200 }
      );
    }

    let demotedCount = 0;
    for (const task of tasks) {
      const result = await updateTask({
        supabase,
        userId,
        taskId: task.id,
        updates: { state: 'backlog' },
        options: { skipProjectTouch: true },
      });
      if (!result.error) {
        demotedCount++;
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
    if (fromEmail && toEmail) {
      const taskListHtml = tasks
        .map((t) => {
          const projectName = t.projects?.name ? ` (${escapeHtml(t.projects.name)})` : '';
          const dueDate = t.due_date ? ` &mdash; due ${escapeHtml(t.due_date)}` : '';
          return `<li>${escapeHtml(t.name)}${projectName}${dueDate}</li>`;
        })
        .join('\n');

      const subject = `Weekly Review: ${demotedCount} task${demotedCount !== 1 ? 's' : ''} moved from This Week to Backlog`;
      const html = `<p>${subject}</p>\n<ul>\n${taskListHtml}\n</ul>`;
      const text = tasks
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
        console.error('Demote week email failed:', emailError);
        emailStatus = 'failed';
      }
    }

    const finalStatus = emailStatus === 'failed' ? 'partial' : 'success';
    try {
      await updateCronRun({
        supabase,
        runId: claim.runId,
        patch: { tasks_affected: demotedCount, status: finalStatus },
      });
    } catch (runUpdateError) {
      console.error('Failed to update cron_runs status:', runUpdateError);
    }

    return NextResponse.json(
      { demoted: demotedCount, emailStatus },
      { status: 200 }
    );
  } catch (error) {
    console.error('Demote week tasks cron failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
