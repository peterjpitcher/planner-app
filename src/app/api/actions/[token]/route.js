import { NextResponse } from 'next/server';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { verifyActionToken } from '@/lib/emailActionToken';
import { updateTask } from '@/services/taskService';
import { getLondonDateKey } from '@/lib/timezone';

// Wave 8 — signed email action route. The signed token is the ONLY authority:
// no app session is required. Security model (do not weaken):
//   - GET renders a confirmation page ONLY (side-effect free) so an email client
//     that PRE-FETCHES the link never performs the action.
//   - POST re-verifies the token, then ATOMICALLY claims single-use by inserting
//     the jti (PK) into email_action_tokens BEFORE performing the action. A
//     23505 unique violation means the link was already used -> stop.
//   - Every action is re-scoped to the token's uid (updateTask 404s a foreign
//     task; planning_sessions is upserted for uid only).
//   - The token, secret and jti are never logged.
export const dynamic = 'force-dynamic';

const HTML_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  // The confirm page and its outcome must never be cached by a proxy or client.
  'Cache-Control': 'no-store, max-age=0',
};

function htmlResponse(html, status = 200) {
  return new NextResponse(html, { status, headers: HTML_HEADERS });
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// Add whole days to a YYYY-MM-DD key using UTC arithmetic (handles month/year
// rollover). Mirrors the digest helper; kept local so the route is standalone.
function addDaysToDateKey(dateKey, days) {
  const [year, month, day] = String(dateKey).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(dt.getTime())) return null;
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function dashboardLink() {
  const raw =
    process.env.DIGEST_DASHBOARD_URL || process.env.NEXTAUTH_URL || 'https://planner.orangejelly.co.uk';
  let base;
  try {
    base = new URL(raw).origin;
  } catch {
    base = raw.replace(/\/+$/, '');
  }
  return `${base}/dashboard`;
}

// --- Self-contained pages (inline styles only; no external assets) ----------

function page({ title, heading, body, showAppLink = false }) {
  const link = showAppLink
    ? `<p style="margin-top:24px;"><a class="btn" href="${escapeHtml(dashboardLink())}">Open Planner</a></p>`
    : '';
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; background:#f4f5f7; color:#1a1a1a; }
  .card { max-width:520px; margin:48px auto; background:#ffffff; border-radius:12px; padding:32px; box-shadow:0 1px 3px rgba(0,0,0,0.12); }
  h1 { font-size:20px; margin:0 0 12px 0; }
  p { font-size:15px; line-height:1.5; color:#444; margin:0 0 12px 0; }
  .btn { display:inline-block; background:#2563eb; color:#ffffff; padding:12px 22px; border-radius:8px; text-decoration:none; font-weight:600; font-size:15px; border:0; cursor:pointer; }
  form { margin:20px 0 0 0; }
</style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(heading)}</h1>
    ${body}
    ${link}
  </div>
</body>
</html>`;
}

function invalidPage(message = 'This link is invalid or has expired.') {
  return page({
    title: 'Link unavailable',
    heading: 'Link unavailable',
    body: `<p>${escapeHtml(message)}</p><p>Open the app to make this change instead.</p>`,
    showAppLink: true,
  });
}

function alreadyUsedPage() {
  return page({
    title: 'Already done',
    heading: 'Already done',
    body: `<p>This link has already been used. No further change was made.</p>`,
    showAppLink: true,
  });
}

function errorPage(message) {
  return page({
    title: 'Something went wrong',
    heading: 'Something went wrong',
    body: `<p>${escapeHtml(message)}</p>`,
    showAppLink: true,
  });
}

function confirmPage(prompt) {
  // The form posts back to the SAME url (empty action) so the token never has to
  // be re-embedded in HTML, and a GET prefetch cannot trigger the POST.
  return page({
    title: 'Confirm',
    heading: 'Confirm',
    body: `<p>${escapeHtml(prompt)}</p>
    <form method="POST"><button class="btn" type="submit">Confirm</button></form>`,
  });
}

function donePage(message) {
  return page({
    title: 'Done',
    heading: 'Done',
    body: `<p>${escapeHtml(message)}</p>`,
    showAppLink: true,
  });
}

// Fetch a task's name, scoped to the owning user. Returns null when the task is
// missing or not the user's (used for the confirmation copy only).
async function fetchTaskName(uid, tid) {
  try {
    const supabase = getSupabaseServiceRole();
    const { data, error } = await supabase
      .from('tasks')
      .select('name')
      .eq('id', tid)
      .eq('user_id', uid)
      .maybeSingle();
    if (error || !data) return null;
    return data.name || '(Untitled task)';
  } catch {
    return null;
  }
}

// --- GET: render the confirmation page (side-effect free) -------------------

export async function GET(request, { params }) {
  const { token } = await params;
  const { valid, payload } = verifyActionToken(token);
  if (!valid) return htmlResponse(invalidPage(), 400);

  if (payload.act === 'confirm_plan') {
    return htmlResponse(confirmPage("Confirm today's plan?"), 200);
  }

  if (payload.act === 'task_done' || payload.act === 'task_defer') {
    if (!payload.tid) return htmlResponse(invalidPage(), 400);
    const name = await fetchTaskName(payload.uid, payload.tid);
    if (name === null) return htmlResponse(invalidPage('This task could not be found.'), 400);
    const prompt =
      payload.act === 'task_done' ? `Mark “${name}” as done?` : `Push “${name}” to later?`;
    return htmlResponse(confirmPage(prompt), 200);
  }

  return htmlResponse(invalidPage(), 400);
}

// --- POST: claim single-use, then perform the action ------------------------

export async function POST(request, { params }) {
  const { token } = await params;
  const { valid, payload } = verifyActionToken(token);
  if (!valid) return htmlResponse(invalidPage(), 400);

  const { jti, uid, act, tid } = payload;
  if ((act === 'task_done' || act === 'task_defer') && !tid) {
    return htmlResponse(invalidPage(), 400);
  }

  const supabase = getSupabaseServiceRole();

  // ATOMIC single-use claim: insert the jti (PK) BEFORE performing anything. If
  // the row already exists (23505) the link was already used — stop without
  // acting. Any other insert failure means we cannot guarantee single-use, so we
  // also refuse to act (fail-safe).
  const { error: claimError } = await supabase
    .from('email_action_tokens')
    .insert({ jti, user_id: uid, action: act, task_id: tid ?? null });

  if (claimError) {
    if (claimError.code === '23505') {
      return htmlResponse(alreadyUsedPage(), 200);
    }
    return htmlResponse(
      errorPage('We could not process this action just now. Please try again from the app.'),
      500
    );
  }

  // The jti is now claimed (spent). If the action itself fails from here we show
  // an error page but never un-claim the token — that keeps the link strictly
  // single-use and avoids re-entrancy.
  try {
    if (act === 'confirm_plan') {
      const windowDate = getLondonDateKey();
      const { error } = await supabase
        .from('planning_sessions')
        .upsert(
          {
            user_id: uid,
            window_type: 'daily',
            window_date: windowDate,
            reviewed_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,window_type,window_date' }
        );
      if (error) return htmlResponse(errorPage('We could not confirm today’s plan.'), 500);
      return htmlResponse(donePage('Today’s plan is confirmed.'), 200);
    }

    if (act === 'task_done') {
      const res = await updateTask({ supabase, userId: uid, taskId: tid, updates: { state: 'done' } });
      if (res?.error) return htmlResponse(errorPage('We could not mark this task as done.'), 500);
      return htmlResponse(donePage('Task marked as done.'), 200);
    }

    if (act === 'task_defer') {
      const newDue = addDaysToDateKey(getLondonDateKey(), 2);
      const res = await updateTask({ supabase, userId: uid, taskId: tid, updates: { due_date: newDue } });
      if (res?.error) return htmlResponse(errorPage('We could not reschedule this task.'), 500);
      return htmlResponse(donePage('Task pushed to a later date.'), 200);
    }

    return htmlResponse(invalidPage(), 400);
  } catch {
    // Never surface (or log) the token/jti — a generic failure page only.
    return htmlResponse(errorPage('Something went wrong performing this action.'), 500);
  }
}
