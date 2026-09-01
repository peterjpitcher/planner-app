# Task Lifecycle — Discovery Spec

**Date:** 2026-04-20
**Status:** Discovery / root-cause analysis (no fixes proposed yet)
**Scope:** Four user-reported bugs affecting the task lifecycle (rollover, weekly cleanup, digest email, quick capture)
**Author:** Claude, from paired investigation with Peter

---

## Executive summary

Four separate user-reported bugs resolve, on inspection, into **two underlying architectural issues** in Planner 2.0:

1. **Lifecycle transitions are cron-driven, not page-load driven.** Every state transition that users perceive as "automatic" (today → this_week, this_week → backlog, digest email send) is done by a nightly Vercel cron job. If those crons are not firing in production — missing env vars, auth rejection, or silent Microsoft Graph failure — three of the four reported symptoms appear at once.
2. **Mutation → refetch signalling is inconsistent.** Some mutation paths dispatch a `planning-complete` custom event that multiple listening views consume to refetch. Others (notably the bottom plus button / `QuickCapture`) write to the database but emit no signal, so the visible lists never refresh.

Both causes are load-bearing. Fixing the crons alone would not fix bug #4; adding event dispatch alone would not fix bugs #1–#3.

---

## Architecture primer

### Task state machine

Tasks carry a `state` column, not a pair of (`due_date`, `is_completed`) flags. The key values:

- `today` — on the Today view
- `this_week` — on the This Week view
- `backlog` — in the backlog
- `done` — completed
- `waiting` — blocked on a follow-up

A task's `due_date` is independent of its `state`. A task in `state='today'` with `due_date='2026-04-10'` is valid and will continue to appear in the Today view — there is no invariant tying `state` to `due_date`.

This is important: **no view computes "today" by comparing `due_date` to the current date**. Everything is driven by the `state` column.

### Lifecycle transitions

The state machine is advanced almost entirely by two nightly cron jobs registered in [`vercel.json`](../../vercel.json):

| Cron path | Schedule (UTC) | File | What it does |
|---|---|---|---|
| `/api/cron/demote-today-tasks` | `55 19 * * *` | [route.js:97](../../src/app/api/cron/demote-today-tasks/route.js#L97) | `state='today'` → `state='this_week'` for all tasks; emails the list |
| `/api/cron/demote-week-tasks` | `55 19 * * *` (Sunday-only guard) | [route.js:27](../../src/app/api/cron/demote-week-tasks/route.js#L27), [route.js:104](../../src/app/api/cron/demote-week-tasks/route.js#L104) | `state='this_week'` → `state='backlog'` for all tasks; emails the list |
| `/api/cron/daily-task-email` | `0 7 * * *` and `0 8 * * *` | [route.js](../../src/app/api/cron/daily-task-email/route.js) | Sends the daily-review digest email |
| `/api/cron/office365-sync` | `* * * * *` | [route.js](../../src/app/api/cron/office365-sync/route.js) | Calendar sync (not relevant to reported bugs) |

Both demote crons:

- Skip unless `londonHour ∈ {19, 20}` — accommodates BST (UTC+1) and GMT (UTC). The 19:55 UTC schedule lands on 19:55 GMT / 20:55 BST, both within the window.
- Do NOT modify `due_date`. They only flip `state`.
- Authenticate via [`verifyCronAuth`](../../src/lib/cronAuth.js) — expects either Vercel's `x-vercel-cron: 1` header or a matching `CRON_SECRET` bearer token.
- Log every run to the `cron_runs` table with `operation`, `run_date`, `status` (`success` | `partial` | `failed`), `tasks_affected`, and `error`.
- Send summary emails via Microsoft Graph ([`microsoftGraph.js`](../../src/lib/microsoftGraph.js)), not Resend/SendGrid.

### Mutation → view refresh

Client views (TodayView, CalendarView, PlanBoard) refetch their data in two situations:

1. On mount (initial load)
2. On the `planning-complete` `CustomEvent` fired from the `window` object

The event is dispatched from [`usePlanningPrompt.js:173`](../../src/hooks/usePlanningPrompt.js#L173) after the Planning Modal completes. No other code path fires it. Listeners:

- [`TodayView.jsx:175`](../../src/components/today/TodayView.jsx#L175)
- [`CalendarView.jsx:66`](../../src/components/calendar/CalendarView.jsx#L66)
- [`PlanBoard.jsx:274`](../../src/components/plan/PlanBoard.jsx#L274)

`apiClient.getTasks` does **not** use the `dedupedFetch` cache — it hits `/api/tasks` on every call. Only `getProjects` goes through `dedupedFetch` with a 5-second TTL. So for tasks, refresh behaviour is governed entirely by whether a component is re-running `loadData()`, not by cache timing.

### API layer

All writes go through Next.js route handlers under `/src/app/api/`, not server actions:

- [`POST /api/tasks`](../../src/app/api/tasks/route.js) → [`createTask` service](../../src/services/taskService.js) → Supabase insert. Returns the created row. Auth: NextAuth session via `getAuthContext`.
- [`POST /api/ideas`](../../src/app/api/ideas/route.js), [`/api/projects`](../../src/app/api/projects/route.js), etc. follow the same pattern.

The `QuickCapture` component ([src/components/shared/QuickCapture.jsx](../../src/components/shared/QuickCapture.jsx)) renders the floating `+` button (`fixed bottom-6 right-6 z-50`) and calls `apiClient.createTask` on Enter.

---

## Bug 1 — "Daily tasks aren't being moved out of Today if they're not done"

### Expected behaviour (user's mental model)

When a new day begins, incomplete tasks from yesterday leave the Today view.

### Actual behaviour

Tasks in `state='today'` remain in the Today view continuously until the `demote-today-tasks` cron fires at 19:55 UTC (20:55 BST in April). There is no calendar-boundary rollover, no midnight reset, no on-load cleanup, and no on-visibility-change cleanup.

### Evidence

- [`TodayView.jsx:113–170`](../../src/components/today/TodayView.jsx#L113) — `loadData` queries `apiClient.getTasks(null, { state: 'today' })`; no rollover logic on load.
- [`demote-today-tasks/route.js:97`](../../src/app/api/cron/demote-today-tasks/route.js#L97) — the only code that moves tasks out of `state='today'`.
- [`vercel.json`](../../vercel.json) — only one cron entry for this operation, at `55 19 * * *`.

### Root-cause hypotheses

1. **The cron is not firing in production.** Highest likelihood given the convergence with bugs #2 and #3. Either `CRON_SECRET` is mismatched (or missing) in Vercel, or Microsoft Graph auth fails when the summary email tries to send (note: email failure only sets `status='partial'` — the state flip should still have happened, but the cron body wraps everything in a single `try/catch` that could short-circuit earlier).
2. **Design-vs-expectation mismatch.** Even with a healthy cron, tasks due yesterday remain in "Today" all day. If the user expects "a task due yesterday shouldn't be in Today when I look at it at 9 AM", that's a design gap, not a bug — but it's a real UX problem.
3. **Secondary structural weakness.** `state` and `due_date` are not tied together. A task can be created with `state='today'` and a past `due_date`; nothing will flag or correct this.

### Recommended diagnostic

```sql
SELECT operation, run_date, status, error, tasks_affected
FROM cron_runs
WHERE operation = 'demote_today'
ORDER BY run_date DESC
LIMIT 14;
```

No rows → cron is not reaching the DB claim step (auth fail or routing fail).
All rows `status='failed'` → the fetch or update step is erroring; `error` column tells us what.
Rows `status='success'` with non-zero `tasks_affected` but user still sees tasks in Today → separate UI/cache problem.

---

## Bug 2 — "No emails are flowing"

### Expected behaviour

Daily digest of overdue / due-today tasks arrives in Peter's inbox each morning. Evening "tasks demoted" summary arrives after each demote cron.

### Actual behaviour

No emails received.

### Evidence

- Email transport is **Microsoft Graph** (not Resend, not SMTP). See [`microsoftGraph.js:16–40`](../../src/lib/microsoftGraph.js#L16) — requires `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_USER_EMAIL`.
- Digest triggered by [`daily-task-email/route.js`](../../src/app/api/cron/daily-task-email/route.js) at 07:00 and 08:00 UTC (two entries for idempotency + retry).
- Runs logged to `daily_task_email_runs` table (migration `20260121_create_daily_task_email_runs.sql`); failure is caught and written as `status='failed'` but never surfaces to the user.
- The demote-today and demote-week crons also send summary emails via the same `sendMicrosoftEmail` path ([demote-today-tasks/route.js:136–148](../../src/app/api/cron/demote-today-tasks/route.js#L136)).

### Root-cause hypotheses (descending likelihood)

1. **Vercel production env vars missing.** `.env.local` holds Microsoft credentials locally. Those do not deploy to Vercel automatically — each must be set via `vercel env add` or the Vercel dashboard. Missing `MICROSOFT_*` → `getMicrosoftGraphAccessToken()` throws → `sendMicrosoftEmail` throws → `daily_task_email_runs.status='failed'`, zero emails.
2. **Cron auth is rejected.** Same `CRON_SECRET` question as bug #1. If Vercel cron requests are returning 401/403, no digest run is attempted at all.
3. **Silent failure envelope.** Because failures only go to a Supabase table and never to the user, the system degrades invisibly. This is an architectural weakness even if the immediate cause is (1) or (2).
4. **Graph mailbox permission or throttling.** Less likely but possible — verify the service principal's `Mail.Send` permission on `peter@orangejelly.co.uk` has not been revoked.

### Recommended diagnostic

```sql
SELECT run_date, status, error
FROM daily_task_email_runs
ORDER BY run_date DESC
LIMIT 14;
```

Plus, from a shell:

```bash
vercel env ls production | grep -E 'MICROSOFT_|DIGEST_|DAILY_TASK_EMAIL|CRON_SECRET'
```

Plus: Vercel dashboard → Project → Functions → Crons → inspect recent invocation history for all five cron entries.

---

## Bug 3 — "Weekly planning isn't clearing out todos that weren't done that week"

### Expected behaviour

When opening the planning modal for this week, incomplete tasks from last week appear — either carried into this week, or surfaced as "overdue" that need re-planning.

### Actual behaviour

Tasks that were in `state='this_week'` last week and never completed **disappear entirely** from the planning modal if the Sunday `demote-week-tasks` cron did not fire.

### Evidence

The weekly planning modal fetches from [`/api/planning-candidates`](../../src/app/api/planning-candidates/route.js). In `windowType='weekly'` mode ([route.js:87–108](../../src/app/api/planning-candidates/route.js#L87)):

```javascript
// Bucket 1: dueThisWeek
.gte('due_date', windowDate)     // this week's Monday
.lte('due_date', weekEndStr)     // this week's Sunday
.not('state', 'in', '("today","done")')

// Bucket 2: overdue
.lt('due_date', windowDate)
.not('state', 'in', '("this_week","today","done")')
```

A task with `due_date` from last week and `state='this_week'`:

- Fails the `dueThisWeek` filter (date is before this Monday)
- Fails the `overdue` filter (state is excluded)

So it is **not returned by the candidates API at all**, and the user has no way to see or re-plan it from the planning flow.

These tasks only become visible in next week's planning modal after the Sunday-evening [`demote-week-tasks`](../../src/app/api/cron/demote-week-tasks/route.js#L104) cron moves them from `this_week` to `backlog` — at which point they satisfy the `overdue` filter.

### Root-cause hypotheses

1. **`demote-week-tasks` is not firing in production.** Exactly the same root-cause domain as bug #1.
2. **The filter design has no graceful degradation.** Even if the cron is healthy, the candidates API excludes `state='this_week'` from the overdue bucket unconditionally. If the cron fails just once on a Sunday, a week's worth of unfinished tasks becomes invisible until the next healthy cron run.
3. **Window-boundary race.** A user planning on Sunday afternoon (before 19:55 UTC) hits the same invisibility.

### Recommended diagnostic

```sql
SELECT operation, run_date, status, error, tasks_affected
FROM cron_runs
WHERE operation = 'demote_week'
ORDER BY run_date DESC
LIMIT 10;

-- Check for "stuck" tasks
SELECT id, name, state, due_date
FROM tasks
WHERE user_id = '<peter-user-id>'
  AND state = 'this_week'
  AND due_date < date_trunc('week', (now() AT TIME ZONE 'Europe/London'))::date
ORDER BY due_date;
```

If the second query returns rows, those are exactly the "disappeared" tasks.

---

## Bug 4 — "Tasks aren't being created when I use the bottom plus button"

### Expected behaviour

Tap the `+` button, type a task, press Enter — the task appears in the relevant view immediately.

### Actual behaviour

The task **is** being created and persisted to the database. The QuickCapture panel shows a "Task captured" / "Added to Today" success flash. But the task does not appear in any visible list, making the user believe creation failed.

This is a **display** bug, not a **persistence** bug. (Important distinction — the data is safe.)

### Evidence — the full click-to-DB flow

1. [`QuickCapture.jsx:117–138`](../../src/components/shared/QuickCapture.jsx#L117) — floating `+` button, `fixed bottom-6 right-6`.
2. [`QuickCapture.jsx:53–107`](../../src/components/shared/QuickCapture.jsx#L53) — `handleKeyDown` branches on input:
   - `Enter` → `apiClient.createTask({ name, state: 'backlog' })`
   - `Shift+Enter` → `apiClient.createTask({ name, state: 'today', today_section: 'good_to_do' })`
   - `!<space>...` → `apiClient.createIdea({ title })`
3. [`apiClient.js:134–167`](../../src/lib/apiClient.js#L134) — POSTs to `/api/tasks`. **Does not call `clearCache` or dispatch any event after the successful response.**
4. [`/api/tasks` POST handler](../../src/app/api/tasks/route.js) — authenticates, validates, inserts, returns 201 with the created row.
5. `QuickCapture` displays `'Task captured'` or `'Added to Today'` flash, clears the input, and returns focus to the input.

**Nothing tells any of the views to refetch.** `TodayView`, `CalendarView`, and `PlanBoard` all listen for `planning-complete`, which is only dispatched by [`usePlanningPrompt.js:173`](../../src/hooks/usePlanningPrompt.js#L173).

### Asymmetric architecture

`QuickCapture` is the outlier. Compare:

| Mutation path | Emits refresh signal? |
|---|---|
| Planning modal (`usePlanningPrompt`) | ✅ Dispatches `planning-complete` |
| Task completion in-view (`TodayView.handleComplete`) | ✅ Optimistic local state update |
| Task edit via drawer | ✅ Updates shared state |
| `QuickCapture` Enter (backlog) | ❌ No event, no local update |
| `QuickCapture` Shift+Enter (today) | ❌ No event, no local update |
| `apiClient.createProject` | ✅ Calls `clearCache('projects-true' / 'false')` |
| `apiClient.createTask` | ❌ No cache clear, no event |

### Side effect of the Enter-vs-Shift+Enter split

The help text in QuickCapture reads: `Enter = Backlog · Shift+Enter = Today · ! = Idea`. Even if refetch signalling is fixed:

- Enter creates a task in `state='backlog'`. It correctly won't appear in Today. If the user is on Today view and expects "press + and see my task", plain Enter is inherently counter-intuitive.
- Shift+Enter creates a task in `state='today'`, `today_section='good_to_do'`. This should appear — and currently doesn't, because of the refetch gap.

### Root-cause hypotheses (ranked)

1. **No refresh signal after create.** Highest confidence. `apiClient.createTask` finishes without dispatching `planning-complete` or calling any cache-invalidation helper; no listener refetches. Verified against all consumer components.
2. **Enter-vs-Shift+Enter discoverability.** Secondary. Users reaching for "+ to add a task to today" are liable to press Enter and then be confused when nothing appears in Today — by design (the task is in Backlog) but indistinguishable from bug (1) from the user's seat.
3. **Silent error envelope.** If the API POST fails with a 500 or the session is stale, `QuickCapture` does show a flash — so pure backend failure would be visible. This is not a likely contributor.

### Recommended diagnostic

```sql
-- Sanity-check that QuickCapture tasks are in the DB
SELECT id, name, state, today_section, due_date, created_at
FROM tasks
WHERE user_id = '<peter-user-id>'
ORDER BY created_at DESC
LIMIT 20;
```

Tasks with `state='backlog'` or `state='today', today_section='good_to_do'` created right after a plus-button session that "didn't work" → confirms the display-bug diagnosis.

---

## The two architectural themes

### Theme 1 — Cron health is a single point of failure

Three reported symptoms (bugs #1, #2, #3) all dissolve if the Vercel crons are running and successfully writing to `cron_runs` / `daily_task_email_runs`. The symptoms are distinguishable from one another in the user's lived experience, but in the code they share:

- The same auth layer (`verifyCronAuth`)
- The same Microsoft Graph email transport
- The same `.env.local` → Vercel production env-var drift risk
- The same silent-failure envelope (errors → DB rows, never → user)

**Architectural weakness:** no user-visible cron health surface. The user cannot tell whether "no emails" means "no tasks to mention today" or "cron has been broken for a week". A dashboard widget showing `SELECT max(run_date), status FROM cron_runs GROUP BY operation` would surface this immediately.

### Theme 2 — Mutation-refresh contract is undocumented and inconsistent

The `planning-complete` CustomEvent is the de facto broadcast mechanism for "tasks changed, refetch". Some mutation paths fire it; others don't. There is no linter, type, or interface enforcing the contract. Every future write path is vulnerable to the same bug that QuickCapture has.

**Candidate directions (not decisions):**

- Dispatch a more general `tasks-changed` event from every task mutation (rename `planning-complete` or introduce a sibling).
- Replace event-bus pattern with a shared task store (Zustand, Jotai, or React Context with a reducer) so mutations optimistically update the store and views derive from it.
- At minimum: audit every `apiClient.create*` / `update*` / `delete*` method and either clear the relevant cache or dispatch the event.

---

## Diagnostics to run before proposing fixes

Running these three checks, in order, will determine which of the four bugs share a root cause and which are independent:

1. **Cron health.**
   ```sql
   SELECT operation, run_date, status, error, tasks_affected, created_at
   FROM cron_runs
   ORDER BY created_at DESC
   LIMIT 30;

   SELECT run_date, status, error, created_at
   FROM daily_task_email_runs
   ORDER BY created_at DESC
   LIMIT 30;
   ```

2. **Vercel env parity.**
   ```bash
   vercel env ls production | grep -E 'MICROSOFT_|DIGEST_|DAILY_TASK_EMAIL|CRON_SECRET|NEXTAUTH_'
   ```
   Compare the list to `.env.local` keys. Any `MICROSOFT_*` or `CRON_SECRET` missing from production is a probable root cause for bugs #1–#3.

3. **QuickCapture DB trace.**
   Open Today view. Click `+`. Type "test plus button". Press Shift+Enter. Verify the flash says "Added to Today". Then:
   ```sql
   SELECT id, name, state, today_section, created_at
   FROM tasks
   WHERE name = 'test plus button'
   ORDER BY created_at DESC
   LIMIT 1;
   ```
   If the row exists with `state='today'` but the view doesn't show it until a full page reload → confirms bug #4 is a display bug, not a persistence bug.

Only after these diagnostics come back should we plan fixes. The shape of the cron evidence (no rows vs. all `failed` vs. all `success`) changes the fix strategy materially.

---

## Open questions

- Is `CRON_SECRET` expected to be set in production? The `verifyCronAuth` code allows the `x-vercel-cron` header as a fallback, so Vercel's built-in cron signing may be sufficient. But if any manual `curl` testing has been done with `--header "Authorization: Bearer <secret>"`, that path requires the secret to be set.
- Was there a conscious decision to have `Enter = Backlog` on the plus button? Or is that a leftover from an earlier UX? The hint text suggests intent, but the disconnect from the Today view is a consistent user frustration.
- Should `demote-today-tasks` and `demote-week-tasks` continue to also send emails, or should the digest email be the sole user-facing surface? Bundling the demote state change with an email send means an SMTP failure can mark the cron `status='partial'` even though the demote succeeded — confusing for later diagnosis.

---

## Not in scope for this document

- Proposed fixes (per the Iron Law of root-cause investigation — fixes come after diagnostics)
- UI redesign of the plus-button flow
- Migration away from Microsoft Graph to Resend/SMTP
- Reworking the state machine to be date-derived rather than state-derived
