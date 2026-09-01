# Review Pack: task-lifecycle-bugs-discovery

**Generated:** 2026-04-20
**Mode:** C (A=Adversarial / B=Code / C=Spec Compliance)
**Project root:** `/Users/peterpitcher/Cursor/OJ-Planner2.0`
**Base ref:** `HEAD`
**HEAD:** `e962d5f`
**Diff range:** `HEAD`
**Stats:**  2 files changed, 2 insertions(+), 1 deletion(-)

> This pack is the sole input for reviewers. Do NOT read files outside it unless a specific finding requires verification. If a file not in the pack is needed, mark the finding `Needs verification` and describe what would resolve it.

## Changed Files

```
.claude/changes-manifest.log
.claude/worktrees/agent-a3bb846b/
.claude/worktrees/agent-a5a427dc/
.claude/worktrees/agent-a80610d4/
.claude/worktrees/agent-a9075dfa/
.claude/worktrees/agent-ae9feb54/
.claude/worktrees/agent-af627663/
.gitignore
supabase/.temp/cli-latest
```

## User Concerns

This is a discovery spec — a root-cause analysis of four user-reported bugs in Planner 2.0. Reviewers must verify the spec's factual claims against the real codebase. The spec references these files specifically — validate every line-number reference and every architectural claim by opening the real file: (1) src/app/api/planning-candidates/route.js — filter-logic claims about overdue/dueThisWeek buckets; (2) src/components/shared/QuickCapture.jsx — claim that QuickCapture dispatches no refresh event after createTask; (3) src/lib/apiClient.js — claim that createTask does NOT clearCache but createProject does, and that getTasks does NOT use dedupedFetch; (4) src/components/today/TodayView.jsx — claim that the only refetch trigger is the planning-complete event; (5) src/hooks/usePlanningPrompt.js — claim that line 173 is the sole dispatcher of planning-complete; (6) src/app/api/cron/demote-today-tasks/route.js — claim that line 97 flips state only and does not touch due_date; (7) src/app/api/cron/demote-week-tasks/route.js — claim of Sunday guard at line 27 and state flip at line 104; (8) vercel.json — claim of five cron entries and their schedules; (9) src/lib/microsoftGraph.js — claim that email transport requires MICROSOFT_TENANT_ID/CLIENT_ID/CLIENT_SECRET/USER_EMAIL; (10) src/lib/cronAuth.js — claim about CRON_SECRET + x-vercel-cron auth fallback. The spec makes a strong architectural claim that bugs #1, #2, #3 share one root cause (crons not firing in Vercel production) and bug #4 has a distinct cause (no refresh signal from QuickCapture). Challenge both. Also challenge the diagnostic SQL queries for correctness against the actual table schemas. The spec explicitly does NOT propose fixes — findings should focus on spec correctness and completeness, not fix recommendations.

## Spec

Source: `/Users/peterpitcher/Cursor/OJ-Planner2.0/docs/superpowers/specs/2026-04-20-task-lifecycle-bugs-discovery.md`

```markdown
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

[spec truncated at line 200 — original has 368 lines]
```

## Diff (`HEAD`)

```diff
diff --git a/.gitignore b/.gitignore
index af77059..ab7d550 100644
--- a/.gitignore
+++ b/.gitignore
@@ -44,3 +44,4 @@ yarn-error.log*
 next-env.d.ts
 .env*.local
 .superpowers/
+.claude/session-context.md
diff --git a/supabase/.temp/cli-latest b/supabase/.temp/cli-latest
index 1dd6178..0455888 100644
--- a/supabase/.temp/cli-latest
+++ b/supabase/.temp/cli-latest
@@ -1 +1 @@
-v2.75.0
\ No newline at end of file
+v2.90.0
\ No newline at end of file
```

## Changed File Contents

### `.claude/changes-manifest.log`

```
# manifest-version: 1
2026-04-17T09:57:24Z|EDIT|src/components/planning/PlanningModal.jsx|component|structure
2026-04-17T09:57:31Z|EDIT|src/components/planning/PlanningModal.jsx|component|structure
2026-04-17T09:57:40Z|EDIT|src/components/planning/PlanningModal.jsx|component|structure
2026-04-17T09:57:48Z|EDIT|src/components/planning/PlanningModal.jsx|component|structure
2026-04-17T09:58:05Z|EDIT|src/components/planning/PlanningModal.jsx|component|structure
2026-04-17T09:58:19Z|EDIT|src/components/planning/PlanningModal.jsx|component|structure
2026-04-17T09:58:55Z|EDIT|src/components/planning/PlanningModal.jsx|component|structure
2026-04-17T09:59:06Z|EDIT|src/components/planning/PlanningModal.jsx|component|structure
2026-04-17T10:14:36Z|EDIT|src/lib/dateUtils.js|utility|structure
2026-04-17T10:14:44Z|EDIT|src/lib/dateUtils.js|utility|structure
2026-04-17T10:14:57Z|EDIT|src/components/planning/PlanningModal.jsx|component|structure
2026-04-17T10:15:04Z|EDIT|src/components/planning/PlanningModal.jsx|component|structure
2026-04-17T10:15:14Z|EDIT|src/components/planning/PlanningModal.jsx|component|structure
2026-04-17T10:15:25Z|EDIT|src/components/planning/PlanningModal.jsx|component|structure
2026-04-17T10:15:29Z|EDIT|src/components/planning/PlanningModal.jsx|component|structure
2026-04-17T10:15:36Z|EDIT|src/components/planning/PlanningModal.jsx|component|structure
2026-04-17T10:15:43Z|EDIT|src/components/planning/PlanningModal.jsx|component|structure
2026-04-17T10:54:38Z|EDIT|src/components/planning/PlanningTaskRow.jsx|component|structure
2026-04-17T10:54:43Z|EDIT|src/components/planning/PlanningTaskRow.jsx|component|structure
2026-04-17T10:54:53Z|EDIT|src/components/planning/PlanningTaskRow.jsx|component|structure
2026-04-17T10:55:00Z|EDIT|src/components/planning/PlanningModal.jsx|component|structure
2026-04-17T10:55:06Z|EDIT|src/components/planning/PlanningModal.jsx|component|structure
2026-04-17T10:55:15Z|EDIT|src/components/planning/PlanningModal.jsx|component|structure
2026-04-17T11:19:40Z|EDIT|src/components/shared/TaskCard.jsx|component|structure
2026-04-17T11:19:47Z|EDIT|src/components/shared/TaskCard.jsx|component|structure
2026-04-17T11:19:54Z|EDIT|src/components/planning/PlanningTaskRow.jsx|component|structure
2026-04-17T11:20:00Z|EDIT|src/components/planning/PlanningTaskRow.jsx|component|structure
2026-04-17T11:20:05Z|EDIT|src/components/planning/PlanningTaskRow.jsx|component|structure
2026-04-17T11:20:13Z|EDIT|src/components/planning/PlanningModal.jsx|component|structure
```

### `.claude/worktrees/agent-a3bb846b/`

_(deleted or missing from working tree)_

### `.claude/worktrees/agent-a5a427dc/`

_(deleted or missing from working tree)_

### `.claude/worktrees/agent-a80610d4/`

_(deleted or missing from working tree)_

### `.claude/worktrees/agent-a9075dfa/`

_(deleted or missing from working tree)_

### `.claude/worktrees/agent-ae9feb54/`

_(deleted or missing from working tree)_

### `.claude/worktrees/agent-af627663/`

_(deleted or missing from working tree)_

### `.gitignore`

```
# See https://help.github.com/articles/ignoring-files/ for more about ignoring files.

# dependencies
/node_modules
/.pnp
.pnp.*
.yarn/*
!.yarn/patches
!.yarn/plugins
!.yarn/releases
!.yarn/versions

# testing
/coverage

# next.js
/.next/
/out/

# production
/build

# misc
.DS_Store
*.pem
*.bak
temp/
/Screenshot*.png

# debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.pnpm-debug.log*

# env files (can opt-in for committing if needed)
.env*

# vercel
.vercel

# typescript
*.tsbuildinfo
next-env.d.ts
.env*.local
.superpowers/
.claude/session-context.md
```

### `supabase/.temp/cli-latest`

```
v2.90.0```

## Related Files (grep hints)

These files reference the basenames of changed files. They are hints for verification — not included inline. Read them only if a specific finding requires it.

```
tasks/codex-qa-review/2026-04-17-plan-modal-today-fix-repo-reality-mapper-report.md
```

## Workspace Conventions (`Cursor/CLAUDE.md`)

```markdown
# CLAUDE.md — Workspace Standards

Shared guidance for Claude Code across all projects. Project-level `CLAUDE.md` files take precedence over this one — always read them first.

## Default Stack

Next.js 15 App Router, React 19, TypeScript (strict), Tailwind CSS, Supabase (PostgreSQL + Auth + RLS), deployed on Vercel.

## Workspace Architecture

21 projects across three brands, plus shared tooling:

| Prefix | Brand | Examples |
|--------|-------|----------|
| `OJ-` | Orange Jelly | AnchorManagementTools, CheersAI2.0, Planner2.0, MusicBingo, CashBingo, QuizNight, The-Anchor.pub, DukesHeadLeatherhead.com, OrangeJelly.co.uk, WhatsAppVideoCreator |
| `GMI-` | GMI | MixerAI2.0 (canonical auth reference), TheCookbook, ThePantry |
| `BARONS-` | Barons | CareerHub, EventHub, BrunchLaunchAtTheStar, StPatricksDay, DigitalExperienceMockUp, WebsiteContent |
| (none) | Shared / test | Test, oj-planner-app |

## Core Principles

**How to think:**
- **Simplicity First** — make every change as simple as possible; minimal code impact
- **No Laziness** — find root causes; no temporary fixes; senior developer standards
- **Minimal Impact** — only touch what's necessary; avoid introducing bugs

**How to act:**
1. **Do ONLY what is asked** — no unsolicited improvements
2. **Ask ONE clarifying question maximum** — if unclear, proceed with safest minimal implementation
3. **Record EVERY assumption** — document in PR/commit messages
4. **One concern per changeset** — if a second concern emerges, park it
5. **Fail safely** — when in doubt, stop and request human approval

### Source of Truth Hierarchy

1. Project-level CLAUDE.md
2. Explicit task instructions
3. Existing code patterns in the project
4. This workspace CLAUDE.md
5. Industry best practices / framework defaults

## Ethics & Safety

AI MUST stop and request explicit approval before:
- Any operation that could DELETE user data or drop DB columns/tables
- Disabling authentication/authorisation or removing encryption
- Logging, sending, or storing PII in new locations
- Changes that could cause >1 minute downtime
- Using GPL/AGPL code in proprietary projects

## Communication

- When the user asks to "remove" or "clean up" something, clarify whether they mean a code change or a database/data cleanup before proceeding
- Ask ONE clarifying question maximum — if still unclear, proceed with the safest interpretation

## Debugging & Bug Fixes

- When fixing bugs, check the ENTIRE application for related issues, not just the reported area — ask: "Are there other places this same pattern exists?"
- When given a bug report: just fix it — don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user

## Code Changes

- Before suggesting new environment variables or database columns, check existing ones first — use `grep` to find existing env vars and inspect the current schema before proposing additions
- One logical change per commit; one concern per changeset

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- One task per subagent for focused execution

### 3. Task Tracking
- Write plan to `tasks/todo.md` with checkable items before starting
- Mark items complete as you go; document results when done

### 4. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules that prevent the same mistake; review lessons at session start

### 5. Verification Before Done
- Never mark a task complete without proving it works
- Run tests, check logs, demonstrate correctness
- Ask yourself: "Would a staff engineer approve this?"
- For non-trivial changes: pause and ask "is there a more elegant way?"

### 6. Codex Integration Hook
Uses OpenAI Codex CLI to audit, test and simulate — catches what Claude misses.

```
when: "running tests OR auditing OR simulating"
do:
  - run_skill(codex-review, target=current_task)
  - compare_outputs(claude_result, codex_result)
  - flag_discrepancies(threshold=medium)
  - merge_best_solution()
```

The full multi-specialist QA review skill lives in `~/.claude/skills/codex-qa-review/`. Trigger with "QA review", "codex review", "second opinion", or "check my work". Deploys four specialist agents (Bug Hunter, Security Auditor, Performance Analyst, Standards Enforcer) into a single prioritised report.

## Common Commands

```bash
npm run dev       # Start development server
npm run build     # Production build
npm run lint      # ESLint (zero warnings enforced)
npm test          # Run tests (Vitest unless noted otherwise)
npm run typecheck # TypeScript type checking (npx tsc --noEmit)
npx supabase db push   # Apply pending migrations (Supabase projects)
```

## Coding Standards

### TypeScript
- No `any` types unless absolutely justified with a comment
- Explicit return types on all exported functions
- Props interfaces must be named (not inline anonymous objects for complex props)
- Use `Promise<{ success?: boolean; error?: string }>` for server action return types

### Frontend / Styling
- Use design tokens only — no hardcoded hex colours in components
- Always consider responsive breakpoints (`sm:`, `md:`, `lg:`)
- No conflicting or redundant class combinations
- Design tokens should live in `globals.css` via `@theme inline` (Tailwind v4) or `tailwind.config.ts`
- **Never use dynamic Tailwind class construction** (e.g., `bg-${color}-500`) — always use static, complete class names due to Tailwind's purge behaviour

### Date Handling
- Always use the project's `dateUtils` (typically `src/lib/dateUtils.ts`) for display
- Never use raw `new Date()` or `.toISOString()` for user-facing dates
- Default timezone: Europe/London
- Key utilities: `getTodayIsoDate()`, `toLocalIsoDate()`, `formatDateInLondon()`

### Phone Numbers
- Always normalise to E.164 format (`+44...`) using `libphonenumber-js`

## Server Actions Pattern

All mutations use `'use server'` functions (typically in `src/app/actions/` or `src/actions/`):

```typescript
'use server';
export async function doSomething(params): Promise<{ success?: boolean; error?: string }> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' };
  // ... permission check, business logic, audit log ...
  revalidatePath('/path');
  return { success: true };
}
```

## Database / Supabase

See `.claude/rules/supabase.md` for detailed patterns. Key rules:
- DB columns are `snake_case`; TypeScript types are `camelCase`
- Always wrap DB results with a conversion helper (e.g. `fromDb<T>()`)
- RLS is always on — use service role client only for system/cron operations
- Two client patterns: cookie-based auth client and service-role admin client

### Before Any Database Work
Before making changes to queries, migrations, server actions, or any code that touches the database, query the live schema for all tables involved:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name IN ('relevant_table') ORDER BY ordinal_position;
```
Also check for views referencing those tables — they will break silently if columns change:
```sql
SELECT table_name FROM information_schema.view_table_usage
WHERE table_name IN ('relevant_table');
```

### Migrations
- Always verify migrations don't conflict with existing timestamps
- Test the connection string works before pushing
- PostgreSQL views freeze their column lists — if underlying tables change, views must be recreated
- Never run destructive migrations (DROP COLUMN/TABLE) without explicit approval

## Git Conventions

See `.claude/rules/pr-and-git-standards.md` for full PR templates, branch naming, and reviewer checklists. Key rules:
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- Never force-push to `main`
- One logical change per commit
- Meaningful commit messages explaining "why" not just "what"

## Rules Reference

Core rules (always loaded from `.claude/rules/`):

| File | Read when… |
|------|-----------|
| `ui-patterns.md` | Building or modifying UI components, forms, buttons, navigation, or accessibility |
| `testing.md` | Adding, modifying, or debugging tests; setting up test infrastructure |
| `definition-of-ready.md` | Starting any new feature — check requirements are clear before coding |
| `definition-of-done.md` | Finishing any feature — verify all quality gates pass |
| `complexity-and-incremental-dev.md` | Scoping a task that touches 4+ files or involves schema changes |
| `pr-and-git-standards.md` | Creating branches, writing commit messages, or opening PRs |
| `verification-pipeline.md` | Before pushing — run the full lint → typecheck → test → build pipeline |
| `supabase.md` | Any database query, migration, RLS policy, or client usage |

Domain rules (auto-injected from `.claude/docs/` when you edit relevant files):

| File | Domain |
|------|--------|
| `auth-standard.md` | Auth, sessions, middleware, RBAC, CSRF, password reset, invites |
| `background-jobs.md` | Async job queues, Vercel Cron, retry logic |
| `api-key-auth.md` | External API key generation, validation, rotation |
| `file-export.md` | PDF, DOCX, CSV generation and download |
| `rate-limiting.md` | Upstash rate limiting, 429 responses |
| `qr-codes.md` | QR code generation (client + server) |
| `toast-notifications.md` | Sonner toast patterns |
| `email-notifications.md` | Resend email, templates, audit logging |
| `ai-llm.md` | LLM client, prompts, token tracking, vision |
| `payment-processing.md` | Stripe/PayPal two-phase payment flows |
| `data-tables.md` | TanStack React Table v8 patterns |

## Quality Gates

A feature is only complete when it passes the full Definition of Done checklist (`.claude/rules/definition-of-done.md`). At minimum: builds, lints, type-checks, tests pass, no hardcoded secrets, auth checks in place, code commented where complex.
```

## Project Conventions (`CLAUDE.md`)

```markdown
# CLAUDE.md — Planner 2.0

This file provides project-specific guidance. See the workspace-level `CLAUDE.md` one directory up for shared conventions.

## Quick Profile

```yaml
framework: Next.js 15.3 App Router
auth: NextAuth.js v5 (NOT Supabase Auth)
database: Supabase (direct queries, no server actions)
test_runner: None configured — tech debt
styling: Tailwind CSS
ui_library: Headless UI + Heroicons
hosting: Vercel
size: ~50 files, project/task management app
```

## Commands

```bash
npm run dev    # Start Next.js dev server on port 3000
npm run build  # Build for production
npm run start  # Start production server
npm run lint   # ESLint
npm install    # Install dependencies
```

## Architecture

**Framework**: Next.js 15.3.2 with App Router — project and task management system.

**Additional stack**: NextAuth.js v5 (Supabase credential provider), Headless UI, Heroicons, date-fns.

### Project Structure
- `/src/app/api/auth/[...nextauth]/` — NextAuth.js authentication endpoint
- `/src/app/dashboard/` — Main dashboard (responsive layout)
- `/src/app/completed-report/` — Reporting interface for completed items
- `/src/app/login/` — Authentication page
- `/src/components/` — React components organised by feature (Auth, Projects, Tasks, Notes)
- `/src/contexts/` — React contexts (TargetProjectContext for project selection)
- `/src/lib/supabaseClient.js` — Supabase database client
- `/src/lib/dateUtils.js` — Date formatting utilities

## Authentication

Uses NextAuth.js (not Supabase Auth) with Supabase credential provider:
- JWT session strategy with 30-day expiration
- Session refresh every 24 hours
- Secure session cookies in production (HttpOnly, SameSite=lax)
- Login page at `/login`, protected routes require active session

## Database Schema

Key tables:
- `users` — email/password authentication
- `projects` — `name`, `dueDate`, `priority` (High/Medium/Low), `status`, `stakeholders[]`, `user_id`, timestamps + `completed_at`
- `tasks` — `name`, `projectId` (FK), `dueDate`, `status`, `priority`, `user_id`, timestamps + `completed_at`
- `notes` — `content`, `projectId`, `taskId`, `user_id`, `created_at`

## Key Features

- Priority levels with colour-coded borders (High=red, Medium=amber, Low=green)
- Due date visual indicators (red for today/overdue, amber for tomorrow)
- Stakeholder tracking and filtering
- In-line editing without modals, collapsible task sections
- CSV export, monthly completion reports, date range filtering

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXTAUTH_SECRET
NEXTAUTH_URL
```

## Key Files

| Path | Purpose |
|------|---------|
| `src/lib/supabaseClient.js` | Supabase database client (single instance) |
| `src/lib/dateUtils.js` | Date formatting utilities |
| `src/contexts/TargetProjectContext.tsx` | Global project selection state |
| `src/components/Projects/ProjectBoard.tsx` | Main project management view |
| `src/components/Tasks/TaskSection.tsx` | Task list with inline editing |
| `src/app/api/auth/[...nextauth]/route.ts` | NextAuth.js config + Supabase provider |
| `src/app/dashboard/page.tsx` | Main dashboard entry point |

## Development Patterns

- Heavy use of client components (`'use client'`)
- Direct Supabase queries in components (not server actions)
- Optimistic UI updates, component-level state management
- Mobile-first responsive design

## Gotchas

- **Auth is NextAuth.js, NOT Supabase Auth** — don't follow workspace Supabase Auth patterns here
- **No test suite** — zero test coverage, noted as tech debt. Add Vitest if writing tests
- **JavaScript files** — `supabaseClient.js` and `dateUtils.js` are plain JS, not TypeScript
- **No server actions** — all data fetching is client-side via direct Supabase calls
- **No RLS enforcement** — uses anon key with direct queries; security relies on NextAuth session checks
```

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/definition-of-done.md`

```markdown
# Definition of Done (DoD)

A feature is ONLY complete when ALL applicable items pass. This extends the Quality Gates in the root CLAUDE.md.

## Code Quality

- [ ] Builds successfully — `npm run build` with zero errors
- [ ] Linting passes — `npm run lint` with zero warnings
- [ ] Type checks pass — `npx tsc --noEmit` clean (or project equivalent)
- [ ] No `any` types unless justified with a comment
- [ ] No hardcoded secrets or API keys
- [ ] No hardcoded hex colours — use design tokens
- [ ] Server action return types explicitly typed

## Testing

- [ ] All existing tests pass
- [ ] New tests written for business logic (happy path + at least 1 error case)
- [ ] Coverage meets project minimum (default: 80% on business logic)
- [ ] External services mocked — never hit real APIs in tests
- [ ] If no test suite exists yet, note this in the PR as tech debt

## Security

- [ ] Auth checks in place — server actions re-verify server-side
- [ ] Permission checks present — RBAC enforced on both UI and server
- [ ] Input validation complete — all user inputs sanitised (Zod or equivalent)
- [ ] No new PII logging, sending, or storing without approval
- [ ] RLS verified (Supabase projects) — queries respect row-level security

## Accessibility

- [ ] Interactive elements have visible focus styles
- [ ] Colour is not the sole indicator of state
- [ ] Modal dialogs trap focus and close on Escape
- [ ] Tables have proper `<thead>`, `<th scope>` markup
- [ ] Images have meaningful `alt` text
- [ ] Keyboard navigation works for all interactive elements

## Documentation

- [ ] Complex logic commented — future developers can understand "why"
- [ ] README updated if new setup, config, or env vars are needed
- [ ] Environment variables documented in `.env.example`
- [ ] Breaking changes noted in PR description

## Deployment

- [ ] Database migrations tested locally before pushing
- [ ] Rollback plan documented for schema changes
- [ ] No console.log or debug statements left in production code
- [ ] Verification pipeline passes (see `verification-pipeline.md`)
```

---

_End of pack._
