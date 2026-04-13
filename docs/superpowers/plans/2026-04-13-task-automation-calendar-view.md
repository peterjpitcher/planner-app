# Task Auto-Demote, Backlog Sort & Calendar View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add daily/weekly task auto-demote crons with email notifications, sort backlog by due date, and build a calendar view with drag-and-drop date management.

**Architecture:** Four independent features sharing a common cron auth utility and the existing dnd-kit/Supabase/Microsoft Graph stack. Crons use Vercel serverless with idempotent claim-based execution. Calendar view is a new page with custom drag-hover month navigation built on dnd-kit droppables with timer logic.

**Tech Stack:** Next.js 15.3 App Router, Supabase (service-role), Microsoft Graph email, dnd-kit, date-fns, Heroicons + Lucide icons.

**Spec:** `docs/superpowers/specs/2026-04-13-task-automation-calendar-view-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `supabase/migrations/20260413000001_add_cron_runs_table.sql` | cron_runs idempotency table |
| `src/lib/cronAuth.js` | Shared cron auth verification (extracted from daily-task-email) |
| `src/app/api/cron/demote-today-tasks/route.js` | Daily 20:00 London — demote today→this_week |
| `src/app/api/cron/demote-week-tasks/route.js` | Sunday 20:00 London — demote this_week→backlog |
| `src/app/calendar/page.js` | Calendar page route (thin wrapper) |
| `src/components/calendar/CalendarView.jsx` | Page wrapper — DnD context, data fetching, month state |
| `src/components/calendar/CalendarGrid.jsx` | Month grid with day cells and week rows |
| `src/components/calendar/CalendarDayCell.jsx` | Droppable day cell with task pills and overflow |
| `src/components/calendar/CalendarTaskPill.jsx` | Draggable compact task pill |
| `src/components/calendar/CalendarSidebar.jsx` | Overdue & undated tasks panel |
| `src/components/calendar/MonthStrip.jsx` | 12-month navigation bar with drag-hover switching |
| `src/components/calendar/EdgeNavigator.jsx` | Left/right edge zones for adjacent month navigation |

### Modified Files

| File | Change |
|------|--------|
| `src/lib/taskSort.js` | Add `compareBacklogTasks` |
| `src/components/plan/PlanBoard.jsx` | Apply client-side backlog sort |
| `src/components/layout/TabBar.jsx` | Add Calendar tab |
| `src/components/layout/Sidebar.jsx` | Add Calendar nav item |
| `src/app/api/cron/daily-task-email/route.js` | Refactor to use shared cronAuth |
| `vercel.json` | Add 4 cron entries |

---

## Task 1: Database Migration — cron_runs Table

**Files:**
- Create: `supabase/migrations/20260413000001_add_cron_runs_table.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Migration: Add cron_runs table for idempotent cron execution tracking

CREATE TABLE public.cron_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation TEXT NOT NULL,
  run_date DATE NOT NULL,
  tasks_affected INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'claimed',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(operation, run_date)
);

ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.cron_runs TO service_role;
REVOKE ALL ON TABLE public.cron_runs FROM anon, authenticated;
```

- [ ] **Step 2: Verify migration file has no conflicts**

Run: `ls supabase/migrations/ | tail -5`

Check that `20260413000001` doesn't conflict with existing timestamps.

- [ ] **Step 3: Push the migration**

Run: `npx supabase db push`

Expected: Migration applies successfully, no errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260413000001_add_cron_runs_table.sql
git commit -m "feat: add cron_runs table for idempotent cron execution"
```

---

## Task 2: Shared Cron Auth Utility

**Files:**
- Create: `src/lib/cronAuth.js`
- Modify: `src/app/api/cron/daily-task-email/route.js`

- [ ] **Step 1: Create `src/lib/cronAuth.js`**

```javascript
import { getTimeZoneParts, LONDON_TIME_ZONE } from '@/lib/timezone';

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

/**
 * Multi-layer cron auth verification.
 * Supports: x-vercel-cron header, CRON_SECRET via x-cron-secret,
 * optional CRON_MANUAL_TOKEN for manual testing.
 *
 * @param {Request} request
 * @returns {{ authorized: boolean, dryRun: boolean, force: boolean }}
 */
export function verifyCronAuth(request) {
  const url = new URL(request.url);
  const isCron = request.headers.get('x-vercel-cron') === '1' ||
                 request.headers.get('x-vercel-cron') === 'true';

  const dryRun = url.searchParams.get('dryRun') === 'true';
  const force = url.searchParams.get('force') === 'true';

  const manualToken = url.searchParams.get('token');
  const manualTokenValid = Boolean(
    process.env.CRON_MANUAL_TOKEN &&
    manualToken &&
    manualToken === process.env.CRON_MANUAL_TOKEN
  );
  const allowManualControls = !isProduction() || manualTokenValid;

  const cronSecret = process.env.CRON_SECRET;
  const providedSecret = request.headers.get('x-cron-secret');

  // Check authorization
  if (cronSecret && !manualTokenValid && providedSecret !== cronSecret) {
    return { authorized: false, dryRun: false, force: false, status: 401 };
  }
  if (!cronSecret && isProduction() && !isCron && !manualTokenValid) {
    return { authorized: false, dryRun: false, force: false, status: 403 };
  }

  return {
    authorized: true,
    dryRun: allowManualControls && dryRun,
    force: allowManualControls && force,
  };
}

/**
 * Check if the current London hour matches the target.
 * @param {number} targetHour — e.g. 20 for 8 PM London
 * @returns {boolean}
 */
export function isLondonHour(targetHour) {
  const parts = getTimeZoneParts(new Date(), LONDON_TIME_ZONE);
  return parts.hour === targetHour;
}

/**
 * Get the day of week in London timezone (0=Sunday, 6=Saturday).
 * @returns {number}
 */
export function getLondonDayOfWeek() {
  const parts = getTimeZoneParts(new Date(), LONDON_TIME_ZONE);
  // Construct a date from London parts to get correct day of week
  const londonDate = new Date(`${parts.dateKey}T12:00:00`);
  return londonDate.getDay();
}

/**
 * Atomic idempotency claim for cron runs.
 * Uses INSERT-first pattern — catches unique violation (23505).
 *
 * @param {{ supabase: any, operation: string, runDate: string }} params
 * @returns {{ claimed: boolean, runId: string|null, reason?: string }}
 */
export async function claimCronRun({ supabase, operation, runDate }) {
  try {
    const { data, error } = await supabase
      .from('cron_runs')
      .insert({
        operation,
        run_date: runDate,
        status: 'claimed',
      })
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') {
        return { claimed: false, reason: 'already_run' };
      }
      throw error;
    }

    return { claimed: true, runId: data?.id || null };
  } catch (error) {
    // If cron_runs table doesn't exist yet, allow execution
    if (String(error?.message || '').toLowerCase().includes('does not exist')) {
      return { claimed: true, runId: null, reason: 'no_tracking_table' };
    }
    throw error;
  }
}

/**
 * Update a cron run record with final status.
 * @param {{ supabase: any, runId: string|null, patch: object }} params
 */
export async function updateCronRun({ supabase, runId, patch }) {
  if (!runId) return;
  await supabase.from('cron_runs').update(patch).eq('id', runId);
}
```

- [ ] **Step 2: Refactor `daily-task-email/route.js` to use shared auth**

In `src/app/api/cron/daily-task-email/route.js`, replace the inline auth functions. Change the imports at the top:

```javascript
import { NextResponse } from 'next/server';
import { getTimeZoneParts, LONDON_TIME_ZONE } from '@/lib/timezone';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { sendMicrosoftEmail } from '@/lib/microsoftGraph';
import { buildDailyTaskEmail, fetchOutstandingTasks, resolveDigestUserId } from '@/services/dailyTaskEmailService';
import { verifyCronAuth } from '@/lib/cronAuth';
```

Replace the inline `isProduction`, `isVercelCronRequest`, `getBooleanSearchParam` functions and the auth block in `GET()` (lines 83-105) with:

```javascript
export async function GET(request) {
  try {
    const auth = verifyCronAuth(request);
    if (!auth.authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    }

    const url = new URL(request.url);
```

Keep `parseNumber`, `getDigestTimeZone`, `isTimeWindowInZone`, `claimDailyRun`, `updateDailyRun` and the rest of the function unchanged. Replace references to `allowManualControls && dryRun` with `auth.dryRun` and `allowManualControls && force` with `auth.force`.

- [ ] **Step 3: Test the refactored daily-task-email still works**

Run: `npm run build`

Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/cronAuth.js src/app/api/cron/daily-task-email/route.js
git commit -m "refactor: extract shared cron auth utility from daily-task-email"
```

---

## Task 3: Demote Today Tasks Cron

**Files:**
- Create: `src/app/api/cron/demote-today-tasks/route.js`

- [ ] **Step 1: Create the cron route**

```javascript
import { NextResponse } from 'next/server';
import { getLondonDateKey } from '@/lib/timezone';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { sendMicrosoftEmail } from '@/lib/microsoftGraph';
import { resolveDigestUserId } from '@/services/dailyTaskEmailService';
import { updateTask } from '@/services/taskService';
import { verifyCronAuth, isLondonHour, claimCronRun, updateCronRun } from '@/lib/cronAuth';

function buildDemoteEmail({ tasks, fromState, toState }) {
  const taskLines = tasks.map((t) => {
    const project = t.project_name ? `Project: ${t.project_name}` : 'No project';
    const due = t.due_date ? `Due: ${new Date(t.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'No due date';
    return `<li>${escapeHtml(t.name)} (${project}, ${due})</li>`;
  }).join('\n');

  const subject = `Daily Review: ${tasks.length} task${tasks.length === 1 ? '' : 's'} moved from ${fromState} to ${toState}`;
  const html = `
    <p>Hi Peter,</p>
    <p>The following tasks weren't completed today and have been moved back to ${toState}:</p>
    <ul>${taskLines}</ul>
    <p>You can review and re-prioritise them in your planner.</p>
  `;
  const text = `Hi Peter,\n\nThe following tasks weren't completed today and have been moved back to ${toState}:\n\n${tasks.map(t => `- ${t.name}`).join('\n')}\n\nYou can review and re-prioritise them in your planner.`;

  return { subject, html, text };
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function GET(request) {
  try {
    // 1. Auth
    const auth = verifyCronAuth(request);
    if (!auth.authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    }

    // 2. London-hour guard (skip unless force)
    if (!auth.force && !isLondonHour(20)) {
      return NextResponse.json({ skipped: true, reason: 'not_london_20' });
    }

    // 3. Idempotency claim
    const runDate = getLondonDateKey();
    const supabase = getSupabaseServiceRole();

    const claim = await claimCronRun({ supabase, operation: 'demote_today', runDate });
    if (!claim.claimed) {
      return NextResponse.json({ skipped: true, reason: claim.reason });
    }

    // 4. Resolve user
    const toEmail = (process.env.DEMOTE_EMAIL_TO || process.env.DAILY_TASK_EMAIL_TO || '').trim();
    const fromEmail = (process.env.DAILY_TASK_EMAIL_FROM || process.env.MICROSOFT_USER_EMAIL || '').trim();
    if (!toEmail || !fromEmail) {
      return NextResponse.json({ error: 'Missing email config' }, { status: 500 });
    }

    const digestUserEmail = (process.env.DIGEST_USER_EMAIL || toEmail).trim();
    const userId = await resolveDigestUserId({ supabase, email: digestUserEmail });

    // 5. Query today tasks
    const { data: todayTasks, error: fetchError } = await supabase
      .from('tasks')
      .select('id, name, due_date, project_id, projects(name)')
      .eq('user_id', userId)
      .eq('state', 'today');

    if (fetchError) throw new Error(`Failed to fetch tasks: ${fetchError.message}`);

    // 6. No tasks — skip email
    if (!todayTasks || todayTasks.length === 0) {
      await updateCronRun({ supabase, runId: claim.runId, patch: { tasks_affected: 0, status: 'success' } });
      return NextResponse.json({ skipped: true, reason: 'no_tasks', tasks_affected: 0 });
    }

    if (auth.dryRun) {
      return NextResponse.json({ dryRun: true, tasks_affected: todayTasks.length });
    }

    // 7. Demote each task via updateTask (preserves O365 sync + triggers)
    const demotedTasks = [];
    for (const task of todayTasks) {
      const result = await updateTask({
        supabase,
        userId,
        taskId: task.id,
        updates: { state: 'this_week' },
        options: { skipProjectTouch: true },
      });
      if (!result.error) {
        demotedTasks.push({
          ...task,
          project_name: task.projects?.name || null,
        });
      }
    }

    // 8. Send email
    let emailStatus = 'success';
    try {
      const email = buildDemoteEmail({
        tasks: demotedTasks,
        fromState: 'Today',
        toState: 'This Week',
      });
      await sendMicrosoftEmail({
        fromUser: fromEmail,
        to: toEmail,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
    } catch (emailError) {
      console.error('Demote email failed:', emailError);
      emailStatus = 'failed';
    }

    // 9. Update cron run
    await updateCronRun({
      supabase,
      runId: claim.runId,
      patch: {
        tasks_affected: demotedTasks.length,
        status: emailStatus,
        ...(emailStatus === 'failed' ? { error: 'Email send failed' } : {}),
      },
    });

    return NextResponse.json({
      success: true,
      tasks_affected: demotedTasks.length,
      email_status: emailStatus,
    });
  } catch (error) {
    console.error('Demote today tasks cron failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/demote-today-tasks/route.js
git commit -m "feat: add daily demote-today-tasks cron endpoint"
```

---

## Task 4: Demote Week Tasks Cron

**Files:**
- Create: `src/app/api/cron/demote-week-tasks/route.js`

- [ ] **Step 1: Create the cron route**

```javascript
import { NextResponse } from 'next/server';
import { getLondonDateKey } from '@/lib/timezone';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { sendMicrosoftEmail } from '@/lib/microsoftGraph';
import { resolveDigestUserId } from '@/services/dailyTaskEmailService';
import { updateTask } from '@/services/taskService';
import { verifyCronAuth, isLondonHour, getLondonDayOfWeek, claimCronRun, updateCronRun } from '@/lib/cronAuth';

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildDemoteEmail({ tasks }) {
  const taskLines = tasks.map((t) => {
    const project = t.project_name ? `Project: ${t.project_name}` : 'No project';
    const due = t.due_date ? `Due: ${new Date(t.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'No due date';
    return `<li>${escapeHtml(t.name)} (${project}, ${due})</li>`;
  }).join('\n');

  const subject = `Weekly Review: ${tasks.length} task${tasks.length === 1 ? '' : 's'} moved from This Week to Backlog`;
  const html = `
    <p>Hi Peter,</p>
    <p>The following tasks weren't completed this week and have been moved to the Backlog:</p>
    <ul>${taskLines}</ul>
    <p>You can review and re-prioritise them in your planner.</p>
  `;
  const text = `Hi Peter,\n\nThe following tasks weren't completed this week and have been moved to the Backlog:\n\n${tasks.map(t => `- ${t.name}`).join('\n')}\n\nYou can review and re-prioritise them in your planner.`;

  return { subject, html, text };
}

export async function GET(request) {
  try {
    // 1. Auth
    const auth = verifyCronAuth(request);
    if (!auth.authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    }

    // 2. London-hour guard
    if (!auth.force && !isLondonHour(20)) {
      return NextResponse.json({ skipped: true, reason: 'not_london_20' });
    }

    // 3. Sunday check (0 = Sunday)
    if (!auth.force && getLondonDayOfWeek() !== 0) {
      return NextResponse.json({ skipped: true, reason: 'not_sunday' });
    }

    // 4. Idempotency claim
    const runDate = getLondonDateKey();
    const supabase = getSupabaseServiceRole();

    const claim = await claimCronRun({ supabase, operation: 'demote_week', runDate });
    if (!claim.claimed) {
      return NextResponse.json({ skipped: true, reason: claim.reason });
    }

    // 5. Resolve user
    const toEmail = (process.env.DEMOTE_EMAIL_TO || process.env.DAILY_TASK_EMAIL_TO || '').trim();
    const fromEmail = (process.env.DAILY_TASK_EMAIL_FROM || process.env.MICROSOFT_USER_EMAIL || '').trim();
    if (!toEmail || !fromEmail) {
      return NextResponse.json({ error: 'Missing email config' }, { status: 500 });
    }

    const digestUserEmail = (process.env.DIGEST_USER_EMAIL || toEmail).trim();
    const userId = await resolveDigestUserId({ supabase, email: digestUserEmail });

    // 6. Query this_week tasks
    const { data: weekTasks, error: fetchError } = await supabase
      .from('tasks')
      .select('id, name, due_date, project_id, projects(name)')
      .eq('user_id', userId)
      .eq('state', 'this_week');

    if (fetchError) throw new Error(`Failed to fetch tasks: ${fetchError.message}`);

    // 7. No tasks — skip
    if (!weekTasks || weekTasks.length === 0) {
      await updateCronRun({ supabase, runId: claim.runId, patch: { tasks_affected: 0, status: 'success' } });
      return NextResponse.json({ skipped: true, reason: 'no_tasks', tasks_affected: 0 });
    }

    if (auth.dryRun) {
      return NextResponse.json({ dryRun: true, tasks_affected: weekTasks.length });
    }

    // 8. Demote each task
    const demotedTasks = [];
    for (const task of weekTasks) {
      const result = await updateTask({
        supabase,
        userId,
        taskId: task.id,
        updates: { state: 'backlog' },
        options: { skipProjectTouch: true },
      });
      if (!result.error) {
        demotedTasks.push({
          ...task,
          project_name: task.projects?.name || null,
        });
      }
    }

    // 9. Send email
    let emailStatus = 'success';
    try {
      const email = buildDemoteEmail({ tasks: demotedTasks });
      await sendMicrosoftEmail({
        fromUser: fromEmail,
        to: toEmail,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
    } catch (emailError) {
      console.error('Weekly demote email failed:', emailError);
      emailStatus = 'failed';
    }

    // 10. Update cron run
    await updateCronRun({
      supabase,
      runId: claim.runId,
      patch: {
        tasks_affected: demotedTasks.length,
        status: emailStatus,
        ...(emailStatus === 'failed' ? { error: 'Email send failed' } : {}),
      },
    });

    return NextResponse.json({
      success: true,
      tasks_affected: demotedTasks.length,
      email_status: emailStatus,
    });
  } catch (error) {
    console.error('Demote week tasks cron failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/demote-week-tasks/route.js
git commit -m "feat: add weekly demote-week-tasks cron endpoint"
```

---

## Task 5: Vercel Cron Configuration

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Add the 4 new cron entries**

Update `vercel.json` to:

```json
{
  "version": 2,
  "crons": [
    {
      "path": "/api/cron/daily-task-email",
      "schedule": "0 7 * * *"
    },
    {
      "path": "/api/cron/daily-task-email",
      "schedule": "0 8 * * *"
    },
    {
      "path": "/api/cron/office365-sync",
      "schedule": "* * * * *"
    },
    {
      "path": "/api/cron/demote-today-tasks",
      "schedule": "0 19 * * *"
    },
    {
      "path": "/api/cron/demote-today-tasks",
      "schedule": "0 20 * * *"
    },
    {
      "path": "/api/cron/demote-week-tasks",
      "schedule": "0 19 * * *"
    },
    {
      "path": "/api/cron/demote-week-tasks",
      "schedule": "0 20 * * *"
    }
  ]
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "feat: add demote cron schedules to vercel.json"
```

---

## Task 6: Backlog Sort Function

**Files:**
- Modify: `src/lib/taskSort.js`

- [ ] **Step 1: Write the test**

Create `src/lib/__tests__/taskSort.backlog.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { compareBacklogTasks } from '../taskSort';

describe('compareBacklogTasks', () => {
  it('should sort tasks with due dates before tasks without', () => {
    const a = { due_date: '2026-04-15', sort_order: 100 };
    const b = { due_date: null, sort_order: 50 };
    expect(compareBacklogTasks(a, b)).toBeLessThan(0);
  });

  it('should sort earlier due dates first', () => {
    const a = { due_date: '2026-04-15', sort_order: 100 };
    const b = { due_date: '2026-04-20', sort_order: 50 };
    expect(compareBacklogTasks(a, b)).toBeLessThan(0);
  });

  it('should use sort_order as tiebreaker for same due date', () => {
    const a = { due_date: '2026-04-15', sort_order: 200 };
    const b = { due_date: '2026-04-15', sort_order: 100 };
    expect(compareBacklogTasks(a, b)).toBeGreaterThan(0);
  });

  it('should use sort_order for two undated tasks', () => {
    const a = { due_date: null, sort_order: 50 };
    const b = { due_date: null, sort_order: 100 };
    expect(compareBacklogTasks(a, b)).toBeLessThan(0);
  });

  it('should use created_at as final tiebreaker', () => {
    const a = { due_date: null, sort_order: 100, created_at: '2026-04-10T10:00:00Z' };
    const b = { due_date: null, sort_order: 100, created_at: '2026-04-12T10:00:00Z' };
    expect(compareBacklogTasks(a, b)).toBeLessThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/taskSort.backlog.test.js`

Expected: FAIL — `compareBacklogTasks` is not exported.

- [ ] **Step 3: Implement `compareBacklogTasks` in `src/lib/taskSort.js`**

Add at the bottom of the file:

```javascript
export function compareBacklogTasks(a, b) {
  // Tier 1: due date ascending (dated before undated)
  const dueA = toTimestamp(a?.due_date);
  const dueB = toTimestamp(b?.due_date);

  if (dueA === null && dueB !== null) return 1;
  if (dueA !== null && dueB === null) return -1;
  if (dueA !== null && dueB !== null && dueA !== dueB) {
    return dueA - dueB;
  }

  // Tier 2: sort_order ascending
  const sortA = a?.sort_order ?? Infinity;
  const sortB = b?.sort_order ?? Infinity;
  if (sortA !== sortB) return sortA - sortB;

  // Tiebreaker: created_at ascending
  const createdA = toTimestamp(a?.created_at);
  const createdB = toTimestamp(b?.created_at);

  if (createdA === null && createdB !== null) return 1;
  if (createdA !== null && createdB === null) return -1;
  if (createdA !== null && createdB !== null && createdA !== createdB) {
    return createdA - createdB;
  }

  const nameDiff = (a?.name || '').localeCompare(b?.name || '');
  if (nameDiff !== 0) return nameDiff;

  return String(a?.id || '').localeCompare(String(b?.id || ''));
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/__tests__/taskSort.backlog.test.js`

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/taskSort.js src/lib/__tests__/taskSort.backlog.test.js
git commit -m "feat: add compareBacklogTasks sort function with tests"
```

---

## Task 7: Apply Backlog Sort to PlanBoard

**Files:**
- Modify: `src/components/plan/PlanBoard.jsx`

- [ ] **Step 1: Import the sort function**

Add to the imports at the top of `PlanBoard.jsx`:

```javascript
import { compareBacklogTasks } from '@/lib/taskSort';
```

- [ ] **Step 2: Apply sort when setting backlog column data**

In the `loadAllColumns` callback (around line 241-264), after setting columns, sort the backlog. Find:

```javascript
setColumns({
  [STATE.TODAY]: today ?? [],
  [STATE.THIS_WEEK]: thisWeek ?? [],
  [STATE.BACKLOG]: backlog ?? [],
  [STATE.WAITING]: waiting ?? [],
});
```

Replace with:

```javascript
setColumns({
  [STATE.TODAY]: today ?? [],
  [STATE.THIS_WEEK]: thisWeek ?? [],
  [STATE.BACKLOG]: backlog ? [...backlog].sort(compareBacklogTasks) : [],
  [STATE.WAITING]: waiting ?? [],
});
```

- [ ] **Step 3: Also sort when loading more backlog**

In `handleLoadMoreBacklog` (around line 274-295), find:

```javascript
setColumns((prev) => ({
  ...prev,
  [STATE.BACKLOG]: [...prev[STATE.BACKLOG], ...more],
}));
```

Replace with:

```javascript
setColumns((prev) => ({
  ...prev,
  [STATE.BACKLOG]: [...prev[STATE.BACKLOG], ...more].sort(compareBacklogTasks),
}));
```

- [ ] **Step 4: Verify build**

Run: `npm run build`

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/plan/PlanBoard.jsx
git commit -m "feat: sort backlog column by due date then sort order"
```

---

## Task 8: Navigation — Add Calendar Tab

**Files:**
- Modify: `src/components/layout/TabBar.jsx`
- Modify: `src/components/layout/Sidebar.jsx`

- [ ] **Step 1: Update TabBar**

In `src/components/layout/TabBar.jsx`, update the import:

```javascript
import { CalendarIcon, CalendarDaysIcon, ViewColumnsIcon, FolderOpenIcon, LightBulbIcon } from '@heroicons/react/24/outline';
```

Update the tabs array:

```javascript
const tabs = [
  { name: 'Today', href: '/today', icon: CalendarIcon },
  { name: 'Plan', href: '/plan', icon: ViewColumnsIcon },
  { name: 'Calendar', href: '/calendar', icon: CalendarDaysIcon },
  { name: 'Projects', href: '/projects', icon: FolderOpenIcon },
  { name: 'Ideas', href: '/ideas', icon: LightBulbIcon },
];
```

- [ ] **Step 2: Update Sidebar**

In `src/components/layout/Sidebar.jsx`, add `Calendar` to the lucide-react import:

```javascript
import {
    CalendarCheck,
    Calendar,
    Columns3,
    FolderOpen,
    Lightbulb,
    PieChart,
    Plug,
    LogOut,
    X
} from 'lucide-react';
```

Update the navigation array — add Calendar between Plan and Projects:

```javascript
const navigation = [
    { name: 'Today', href: '/today', icon: CalendarCheck },
    { name: 'Plan', href: '/plan', icon: Columns3 },
    { name: 'Calendar', href: '/calendar', icon: Calendar },
    { name: 'Projects', href: '/projects', icon: FolderOpen },
    { name: 'Ideas', href: '/ideas', icon: Lightbulb },
    { name: 'Reports', href: '/completed-report', icon: PieChart },
    { name: 'Integrations', href: '/settings/integrations', icon: Plug },
];
```

- [ ] **Step 3: Verify build**

Run: `npm run build`

Expected: Build succeeds (the `/calendar` page doesn't exist yet so the link will 404, but navigation renders).

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/TabBar.jsx src/components/layout/Sidebar.jsx
git commit -m "feat: add Calendar tab to navigation"
```

---

## Task 9: Calendar Page Route

**Files:**
- Create: `src/app/calendar/page.js`

- [ ] **Step 1: Create the page**

```javascript
import CalendarView from '@/components/calendar/CalendarView';

export default function CalendarPage() {
  return <CalendarView />;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/calendar/page.js
git commit -m "feat: add calendar page route"
```

---

## Task 10: CalendarTaskPill Component

**Files:**
- Create: `src/components/calendar/CalendarTaskPill.jsx`

- [ ] **Step 1: Create the component**

```jsx
'use client';

import { useDraggable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';

const STATE_COLOURS = {
  today: 'border-l-blue-500',
  this_week: 'border-l-indigo-500',
  backlog: 'border-l-gray-400',
  waiting: 'border-l-amber-500',
};

export default function CalendarTaskPill({ task, isDragOverlay = false }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  const colourClass = STATE_COLOURS[task.state] || STATE_COLOURS.backlog;

  return (
    <div
      ref={!isDragOverlay ? setNodeRef : undefined}
      style={style}
      className={cn(
        'flex items-center gap-1 rounded border-l-2 bg-white px-1.5 py-0.5 text-xs shadow-sm cursor-grab',
        'truncate max-w-full',
        colourClass,
        isDragging && !isDragOverlay && 'opacity-30',
        isDragOverlay && 'shadow-lg ring-2 ring-indigo-300 rotate-2'
      )}
      {...(!isDragOverlay ? { ...attributes, ...listeners } : {})}
    >
      <span className="truncate font-medium text-gray-800">{task.name}</span>
      {task.project_name && (
        <span className="hidden sm:inline truncate text-gray-400 text-[10px]">
          {task.project_name}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/calendar/CalendarTaskPill.jsx
git commit -m "feat: add CalendarTaskPill draggable component"
```

---

## Task 11: CalendarDayCell Component

**Files:**
- Create: `src/components/calendar/CalendarDayCell.jsx`

- [ ] **Step 1: Create the component**

```jsx
'use client';

import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import CalendarTaskPill from './CalendarTaskPill';

const MAX_VISIBLE = 3;

export default function CalendarDayCell({ date, dateKey, tasks, isCurrentMonth, isToday }) {
  const [showOverflow, setShowOverflow] = useState(false);
  const { setNodeRef, isOver } = useDroppable({ id: `day-${dateKey}` });

  const dayNumber = date.getDate();
  const sortedTasks = [...tasks].sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity));
  const visibleTasks = sortedTasks.length > MAX_VISIBLE
    ? sortedTasks.slice(0, MAX_VISIBLE - 1)
    : sortedTasks;
  const overflowCount = sortedTasks.length - visibleTasks.length;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'relative flex flex-col gap-0.5 border border-gray-100 p-1 min-h-[80px] lg:min-h-[100px]',
        isCurrentMonth ? 'bg-white' : 'bg-gray-50',
        isOver && 'bg-indigo-50 ring-1 ring-indigo-300',
        isToday && 'ring-2 ring-blue-400'
      )}
    >
      <span
        className={cn(
          'text-xs font-medium mb-0.5 self-end w-6 h-6 flex items-center justify-center rounded-full',
          isToday ? 'bg-blue-600 text-white' : isCurrentMonth ? 'text-gray-700' : 'text-gray-400'
        )}
      >
        {dayNumber}
      </span>

      <div className="flex flex-col gap-0.5 overflow-hidden flex-1">
        {visibleTasks.map((task) => (
          <CalendarTaskPill key={task.id} task={task} />
        ))}

        {overflowCount > 0 && (
          <button
            type="button"
            onClick={() => setShowOverflow(true)}
            className="text-[10px] text-indigo-600 hover:text-indigo-800 font-medium text-left px-1"
          >
            +{overflowCount} more
          </button>
        )}
      </div>

      {/* Overflow popover */}
      {showOverflow && (
        <div className="absolute top-full left-0 z-50 mt-1 w-48 rounded-lg border bg-white shadow-lg p-2">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs font-semibold text-gray-600">
              {date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </span>
            <button
              type="button"
              onClick={() => setShowOverflow(false)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Close
            </button>
          </div>
          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
            {sortedTasks.map((task) => (
              <CalendarTaskPill key={task.id} task={task} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/calendar/CalendarDayCell.jsx
git commit -m "feat: add CalendarDayCell droppable component"
```

---

## Task 12: CalendarGrid Component

**Files:**
- Create: `src/components/calendar/CalendarGrid.jsx`

- [ ] **Step 1: Create the component**

```jsx
'use client';

import { useMemo } from 'react';
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, format, isSameMonth, isToday as isDateToday } from 'date-fns';
import CalendarDayCell from './CalendarDayCell';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function CalendarGrid({ currentMonth, tasks }) {
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    // week starts on Monday (weekStartsOn: 1)
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [currentMonth]);

  const tasksByDate = useMemo(() => {
    const map = {};
    for (const task of tasks) {
      if (!task.due_date) continue;
      const key = task.due_date.slice(0, 10); // YYYY-MM-DD
      if (!map[key]) map[key] = [];
      map[key].push(task);
    }
    return map;
  }, [tasks]);

  // Split into weeks
  const weeks = useMemo(() => {
    const result = [];
    for (let i = 0; i < calendarDays.length; i += 7) {
      result.push(calendarDays.slice(i, i + 7));
    }
    return result;
  }, [calendarDays]);

  return (
    <div className="flex flex-col">
      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b border-gray-200">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="px-2 py-1.5 text-xs font-semibold text-gray-500 text-center">
            {label}
          </div>
        ))}
      </div>

      {/* Day cells */}
      {weeks.map((week, weekIdx) => (
        <div key={weekIdx} className="grid grid-cols-7">
          {week.map((day) => {
            const dateKey = format(day, 'yyyy-MM-dd');
            return (
              <CalendarDayCell
                key={dateKey}
                date={day}
                dateKey={dateKey}
                tasks={tasksByDate[dateKey] || []}
                isCurrentMonth={isSameMonth(day, currentMonth)}
                isToday={isDateToday(day)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/calendar/CalendarGrid.jsx
git commit -m "feat: add CalendarGrid month grid component"
```

---

## Task 13: CalendarSidebar Component

**Files:**
- Create: `src/components/calendar/CalendarSidebar.jsx`

- [ ] **Step 1: Create the component**

```jsx
'use client';

import { useMemo } from 'react';
import CalendarTaskPill from './CalendarTaskPill';

export default function CalendarSidebar({ tasks, today }) {
  const todayStr = today.toISOString().slice(0, 10);

  const { overdue, undated } = useMemo(() => {
    const overdueList = [];
    const undatedList = [];

    for (const task of tasks) {
      if (!task.due_date) {
        undatedList.push(task);
      } else if (task.due_date.slice(0, 10) < todayStr) {
        overdueList.push(task);
      }
    }

    // Sort overdue by due_date ASC (most overdue first)
    overdueList.sort((a, b) => a.due_date.localeCompare(b.due_date));
    // Sort undated by created_at DESC (newest first)
    undatedList.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

    return { overdue: overdueList, undated: undatedList };
  }, [tasks, todayStr]);

  if (overdue.length === 0 && undated.length === 0) {
    return (
      <div className="p-3 text-sm text-gray-400 text-center">
        No overdue or undated tasks
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3 overflow-y-auto max-h-[calc(100vh-200px)]">
      {overdue.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-red-600 uppercase tracking-wider mb-1.5">
            Overdue ({overdue.length})
          </h3>
          <div className="flex flex-col gap-1">
            {overdue.map((task) => (
              <div key={task.id}>
                <CalendarTaskPill task={task} />
                <span className="text-[10px] text-gray-400 pl-2">
                  was {new Date(task.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {undated.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
            No date ({undated.length})
          </h3>
          <div className="flex flex-col gap-1">
            {undated.map((task) => (
              <CalendarTaskPill key={task.id} task={task} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/calendar/CalendarSidebar.jsx
git commit -m "feat: add CalendarSidebar for overdue and undated tasks"
```

---

## Task 14: MonthStrip Component

**Files:**
- Create: `src/components/calendar/MonthStrip.jsx`

- [ ] **Step 1: Create the component**

```jsx
'use client';

import { useMemo, useRef, useCallback } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { addMonths, format, isSameMonth } from 'date-fns';
import { cn } from '@/lib/utils';

function MonthButton({ month, isActive, onNavigate, onDragHover }) {
  const monthKey = format(month, 'yyyy-MM');
  const { setNodeRef, isOver } = useDroppable({ id: `month-${monthKey}` });
  const timerRef = useRef(null);

  // When drag hovers over this month for 400ms, navigate
  const handleDragState = useCallback(() => {
    if (isOver && !isActive) {
      timerRef.current = setTimeout(() => onDragHover(month), 400);
    } else {
      if (timerRef.current) clearTimeout(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isOver, isActive, month, onDragHover]);

  // Use effect equivalent via ref callback
  if (isOver && !isActive && !timerRef.current) {
    timerRef.current = setTimeout(() => {
      onDragHover(month);
      timerRef.current = null;
    }, 400);
  } else if (!isOver && timerRef.current) {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => onNavigate(month)}
      className={cn(
        'px-2 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap',
        isActive
          ? 'bg-indigo-600 text-white'
          : isOver
            ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300'
            : 'text-gray-600 hover:bg-gray-100'
      )}
    >
      {format(month, 'MMM')}
    </button>
  );
}

export default function MonthStrip({ currentMonth, onNavigate, onDragHover }) {
  const months = useMemo(() => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return Array.from({ length: 12 }, (_, i) => addMonths(start, i));
  }, []);

  return (
    <div className="flex items-center gap-1 overflow-x-auto px-2 py-1.5 border-b border-gray-200 bg-gray-50 scrollbar-thin">
      {months.map((month) => (
        <MonthButton
          key={format(month, 'yyyy-MM')}
          month={month}
          isActive={isSameMonth(month, currentMonth)}
          onNavigate={onNavigate}
          onDragHover={onDragHover}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/calendar/MonthStrip.jsx
git commit -m "feat: add MonthStrip with drag-hover month navigation"
```

---

## Task 15: EdgeNavigator Component

**Files:**
- Create: `src/components/calendar/EdgeNavigator.jsx`

- [ ] **Step 1: Create the component**

```jsx
'use client';

import { useRef } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { cn } from '@/lib/utils';

function EdgeZone({ id, direction, onNavigate, minMonth, maxMonth, currentMonth }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const timerRef = useRef(null);

  const isAtBoundary =
    (direction === 'prev' && currentMonth <= minMonth) ||
    (direction === 'next' && currentMonth >= maxMonth);

  // Timer-based navigation on drag hover
  if (isOver && !isAtBoundary && !timerRef.current) {
    timerRef.current = setTimeout(() => {
      onNavigate(direction);
      timerRef.current = null;
    }, 500);
  } else if (!isOver && timerRef.current) {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  const Icon = direction === 'prev' ? ChevronLeftIcon : ChevronRightIcon;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'absolute top-0 bottom-0 w-10 flex items-center justify-center z-10 transition-opacity',
        direction === 'prev' ? 'left-0' : 'right-0',
        isOver && !isAtBoundary ? 'opacity-100 bg-indigo-50/80' : 'opacity-0 pointer-events-none',
        isAtBoundary && 'hidden'
      )}
      style={{ pointerEvents: isOver ? 'auto' : 'none' }}
    >
      <Icon className={cn('h-6 w-6', isOver ? 'text-indigo-600 animate-pulse' : 'text-gray-300')} />
    </div>
  );
}

export default function EdgeNavigator({ currentMonth, minMonth, maxMonth, onNavigate }) {
  return (
    <>
      <EdgeZone
        id="edge-prev"
        direction="prev"
        onNavigate={onNavigate}
        minMonth={minMonth}
        maxMonth={maxMonth}
        currentMonth={currentMonth}
      />
      <EdgeZone
        id="edge-next"
        direction="next"
        onNavigate={onNavigate}
        minMonth={minMonth}
        maxMonth={maxMonth}
        currentMonth={currentMonth}
      />
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/calendar/EdgeNavigator.jsx
git commit -m "feat: add EdgeNavigator for drag-hover month scrolling"
```

---

## Task 16: CalendarView — Main Orchestrator

**Files:**
- Create: `src/components/calendar/CalendarView.jsx`

- [ ] **Step 1: Create the component**

```jsx
'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  pointerWithin,
} from '@dnd-kit/core';
import { addMonths, subMonths, format, isBefore, startOfMonth } from 'date-fns';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { apiClient } from '@/lib/apiClient';
import CalendarGrid from './CalendarGrid';
import CalendarSidebar from './CalendarSidebar';
import CalendarTaskPill from './CalendarTaskPill';
import MonthStrip from './MonthStrip';
import EdgeNavigator from './EdgeNavigator';

export default function CalendarView() {
  const today = useMemo(() => new Date(), []);
  const minMonth = useMemo(() => startOfMonth(today), [today]);
  const maxMonth = useMemo(() => addMonths(minMonth, 11), [minMonth]);

  const [currentMonth, setCurrentMonth] = useState(minMonth);
  const [tasks, setTasks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeDragTask, setActiveDragTask] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // ---- Data loading ----
  const loadTasks = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiClient.getAllTasks(null, {
        states: 'today,this_week,backlog,waiting',
      });
      setTasks(data);
    } catch (err) {
      setError(err.message || 'Failed to load tasks');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load on mount
  useState(() => { loadTasks(); });

  // ---- Month navigation ----
  const navigateMonth = useCallback((month) => {
    const target = startOfMonth(month);
    if (isBefore(target, minMonth) || isBefore(maxMonth, target)) return;
    setCurrentMonth(target);
  }, [minMonth, maxMonth]);

  const handleEdgeNavigate = useCallback((direction) => {
    setCurrentMonth((prev) => {
      const next = direction === 'prev' ? subMonths(prev, 1) : addMonths(prev, 1);
      if (isBefore(next, minMonth) || isBefore(maxMonth, next)) return prev;
      return next;
    });
  }, [minMonth, maxMonth]);

  const handlePrev = useCallback(() => {
    setCurrentMonth((prev) => {
      const next = subMonths(prev, 1);
      return isBefore(next, minMonth) ? prev : next;
    });
  }, [minMonth]);

  const handleNext = useCallback(() => {
    setCurrentMonth((prev) => {
      const next = addMonths(prev, 1);
      return isBefore(maxMonth, next) ? prev : next;
    });
  }, [maxMonth]);

  // ---- Drag & Drop ----
  const handleDragStart = useCallback((event) => {
    const task = event.active.data.current?.task;
    if (task) setActiveDragTask(task);
  }, []);

  const handleDragEnd = useCallback(async (event) => {
    setActiveDragTask(null);
    const { active, over } = event;
    if (!over || !active) return;

    const overId = String(over.id);
    // Only handle drops on day cells
    if (!overId.startsWith('day-')) return;

    const newDueDate = overId.replace('day-', ''); // 'YYYY-MM-DD'
    const taskId = active.id;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    // Skip if same date
    const currentDueDate = task.due_date?.slice(0, 10) || null;
    if (currentDueDate === newDueDate) return;

    // Optimistic update
    const previousTasks = [...tasks];
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, due_date: newDueDate } : t))
    );

    try {
      await apiClient.updateTask(taskId, { due_date: newDueDate });
    } catch (err) {
      console.error('Failed to update due date:', err);
      setTasks(previousTasks); // Revert
    }
  }, [tasks]);

  const handleDragCancel = useCallback(() => {
    setActiveDragTask(null);
  }, []);

  // ---- Render ----
  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-red-500">
        {error}
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex flex-col h-full">
        {/* Month header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
          <button type="button" onClick={handlePrev} className="p-1 hover:bg-gray-100 rounded" aria-label="Previous month">
            <ChevronLeftIcon className="h-5 w-5 text-gray-600" />
          </button>
          <h2 className="text-lg font-semibold text-gray-800">
            {format(currentMonth, 'MMMM yyyy')}
          </h2>
          <button type="button" onClick={handleNext} className="p-1 hover:bg-gray-100 rounded" aria-label="Next month">
            <ChevronRightIcon className="h-5 w-5 text-gray-600" />
          </button>
        </div>

        {/* Month strip */}
        <MonthStrip
          currentMonth={currentMonth}
          onNavigate={navigateMonth}
          onDragHover={navigateMonth}
        />

        {/* Main content */}
        <div className="flex flex-1 overflow-hidden relative">
          {/* Edge navigation zones */}
          <EdgeNavigator
            currentMonth={currentMonth}
            minMonth={minMonth}
            maxMonth={maxMonth}
            onNavigate={handleEdgeNavigate}
          />

          {/* Calendar grid */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-64 text-gray-400">
                Loading tasks...
              </div>
            ) : (
              <CalendarGrid currentMonth={currentMonth} tasks={tasks} />
            )}
          </div>

          {/* Sidebar */}
          <div className="w-56 border-l border-gray-200 bg-gray-50 hidden lg:block">
            <div className="px-3 py-2 border-b border-gray-200">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Overdue & Undated
              </h3>
            </div>
            <CalendarSidebar tasks={tasks} today={today} />
          </div>
        </div>
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeDragTask ? (
          <CalendarTaskPill task={activeDragTask} isDragOverlay />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/calendar/CalendarView.jsx
git commit -m "feat: add CalendarView with DnD, month navigation, and sidebar"
```

---

## Task 17: Mobile Calendar Fallback

**Files:**
- Modify: `src/components/calendar/CalendarView.jsx`

- [ ] **Step 1: Add mobile week-strip view**

After the sidebar div in CalendarView, add a mobile sidebar that appears below on small screens:

```jsx
{/* Mobile sidebar — below calendar */}
<div className="lg:hidden border-t border-gray-200 bg-gray-50">
  <div className="px-3 py-2 border-b border-gray-200">
    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
      Overdue & Undated
    </h3>
  </div>
  <CalendarSidebar tasks={tasks} today={today} />
</div>
```

Note: Full mobile week-strip view is a future enhancement. For now, the month grid renders on mobile with the sidebar below. Drag-and-drop still works on touch devices via PointerSensor — a tap-for-date-picker fallback would be a separate task.

- [ ] **Step 2: Commit**

```bash
git add src/components/calendar/CalendarView.jsx
git commit -m "feat: add mobile sidebar layout for calendar view"
```

---

## Task 18: Final Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Run lint**

Run: `npm run lint`

Expected: Zero errors, zero warnings.

- [ ] **Step 2: Run existing tests**

Run: `npm test`

Expected: All existing tests pass.

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: Production build succeeds.

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`

Check:
1. `/calendar` page loads with month grid
2. Navigation tabs show Calendar between Plan and Projects
3. Month prev/next arrows work
4. Month strip shows 12 months and clicking navigates
5. `/plan` backlog column sorts by due date first
6. Build the full project: `npm run build` — zero errors

- [ ] **Step 5: Final commit if any lint fixes were needed**

```bash
git add -A
git commit -m "chore: fix lint issues from calendar and cron implementation"
```

---

## Summary

| Task | Feature | Files |
|------|---------|-------|
| 1 | Migration | `supabase/migrations/20260413000001_add_cron_runs_table.sql` |
| 2 | Cron auth | `src/lib/cronAuth.js`, refactor `daily-task-email/route.js` |
| 3 | Today demote | `src/app/api/cron/demote-today-tasks/route.js` |
| 4 | Week demote | `src/app/api/cron/demote-week-tasks/route.js` |
| 5 | Cron config | `vercel.json` |
| 6 | Backlog sort | `src/lib/taskSort.js` + test |
| 7 | Backlog apply | `src/components/plan/PlanBoard.jsx` |
| 8 | Navigation | `TabBar.jsx`, `Sidebar.jsx` |
| 9 | Calendar page | `src/app/calendar/page.js` |
| 10 | Task pill | `CalendarTaskPill.jsx` |
| 11 | Day cell | `CalendarDayCell.jsx` |
| 12 | Grid | `CalendarGrid.jsx` |
| 13 | Sidebar | `CalendarSidebar.jsx` |
| 14 | Month strip | `MonthStrip.jsx` |
| 15 | Edge nav | `EdgeNavigator.jsx` |
| 16 | Calendar view | `CalendarView.jsx` |
| 17 | Mobile | `CalendarView.jsx` update |
| 18 | Verification | Build + lint + test |
