# CLAUDE.md: Planner 2.0

This file provides project-specific guidance. See the workspace-level `CLAUDE.md` one directory up for shared conventions.

## Quick Profile

```yaml
framework: Next.js 15.5 App Router
auth: NextAuth.js v4 (NOT Supabase Auth)
database: Supabase via server-side API routes (service-role client)
test_runner: Vitest (run `npm test`; no typecheck script, this is plain JavaScript)
styling: Tailwind CSS v4
ui_library: Headless UI + Heroicons + lucide-react
hosting: Vercel
size: ~145 source files, personal project/task/planning system
```

## Commands

```bash
npm run dev    # Start Next.js dev server on port 3000
npm run build  # Build for production
npm run start  # Start production server
npm run lint   # ESLint (zero warnings enforced)
npm test       # Vitest run
npm run test:watch
npx supabase db push   # Apply pending migrations
```

## Architecture

Next.js 15.5 App Router. All data access goes through `/src/app/api/*` route handlers using a
service-role Supabase client. Components call those routes via `src/lib/apiClient.js`. There are
no server actions and no direct Supabase queries from components.

**Request path:** component -> `apiClient` -> API route (auth + ownership check) -> service layer -> Supabase.

### Pages

| Route | Purpose |
|-------|---------|
| `/today` | Daily working view, three sections (must do / good to do / quick wins) |
| `/plan` | Kanban board across task states |
| `/projects` | Project list, workspace and radar |
| `/calendar` | Month calendar with drag-to-reschedule |
| `/ideas` | Idea vault, promotes to tasks |
| `/journal` | Journal entries with AI summary |
| `/completed-report` | Monthly completion reporting and CSV export |
| `/settings/planning`, `/settings/integrations` | Planning windows, automations, Office 365 |
| `/dashboard`, `/tasks`, `/capture`, `/prioritise` | Legacy redirects to the routes above |

### Services (`src/services/`)

`taskService`, `ideaService`, `journalService`, `projectLifecycleService`, `projectRadarService`,
`autopilotService`, `aiPlannerService`, `dailyTaskEmailService`, `automationStatusService`,
`office365SyncService`, `office365ConnectionService`.

Business rules live here, not in routes or components, so every caller gets the same behaviour.

## Authentication

NextAuth.js (not Supabase Auth) with a Supabase credential provider:
- JWT session strategy, 30-day expiry, refreshed every 24 hours
- `src/middleware.js` protects everything except `/login`, `/api/auth/*`, `/api/cron/*`, `/api/health/*`, the Office 365 callback and `/api/debug-env`
- Every API route re-checks the session server-side and verifies row ownership. Never rely on the UI hiding something.
- Cron routes are guarded by a shared secret (`src/lib/cronAuth.js`), not a session.

## Database

Key tables: `projects`, `tasks`, `notes`, `ideas`, `journal_entries`, `user_settings`,
`planning_sessions`, `cron_runs`, `daily_task_email_runs`, `office365_*`.

### Task state model

`state` is the spine of the app: `today`, `this_week`, `backlog`, `waiting`, `done`, `cancelled`.

- **`CLOSED_STATES` (`done`, `cancelled`) is the single source of truth for "finished work".**
  Any query that hides finished tasks must filter on `CLOSED_STATES` / `closedStatesFilter()` from
  `src/lib/constants.js`. Do not hardcode `'done'`. These exclusions used to be scattered denylists
  (`'("today","done")'`), which meant adding `cancelled` would have leaked cancelled tasks into
  Today, the Plan board, planning candidates, the autopilot pool and the daily digest.
- `completed_at` and `cancelled_at` are owned exclusively by the `fn_task_state_cleanup` trigger.
  The app layer must never write them.
- `entered_state_at` is reset by the same trigger on every state change and drives backlog ageing.

### Foreign keys, and what deletes destroy

- `tasks.project_id` is **ON DELETE SET NULL**: deleting a project keeps its tasks as unassigned.
- `notes.project_id` is **ON DELETE CASCADE**: deleting a project **permanently destroys its notes**.
- `notes.task_id` is ON DELETE CASCADE.

Any UI that deletes a project must say both things. See `ProjectDeleteModal`.

### Project lifecycle

Closing a project cascades to its open tasks, server-side in `projectLifecycleService`:

| Transition | Effect on tasks |
|-----------|-----------------|
| -> Completed | active tasks become `done` |
| -> Cancelled | active tasks become `cancelled` |
| Cancelled -> reopened | `cancelled` tasks return to `backlog` |
| Completed -> reopened | `done` tasks stay done |

The cascade lives in the service, not the component, so it holds for every caller. The UI confirms
first and lists the affected tasks by name (`ProjectStatusChangeModal`).

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXTAUTH_SECRET
NEXTAUTH_URL
OPENAI_API_KEY            # AI planner and journal summaries
EMAIL_ACTION_SECRET       # signs one-click email action tokens
CRON_SECRET               # guards /api/cron/*
RESEND_API_KEY            # daily digest email
OFFICE365_*               # Graph integration (optional)
```

## Key Files

| Path | Purpose |
|------|---------|
| `src/lib/constants.js` | State model, `CLOSED_STATES`, soft caps, thresholds |
| `src/lib/apiClient.js` | The only way components talk to the API (handles pagination + caching) |
| `src/lib/supabaseServiceRole.js` | Server-side Supabase client |
| `src/lib/authServer.js` | `getAuthContext`, `isAdminSession`, `isDevelopment` |
| `src/lib/dateUtils.js`, `src/lib/timezone.js` | Date formatting, Europe/London handling |
| `src/services/taskService.js` | Task CRUD, state transitions, recurrence |
| `src/services/projectLifecycleService.js` | Project close/reopen cascade, delete impact |
| `src/components/Projects/ProjectsView.jsx` | Projects page root (owns the confirmations) |
| `src/components/today/TodayView.jsx` | Today page root |
| `src/components/plan/PlanBoard.jsx` | Plan board root |
| `src/middleware.js` | Route protection |

## Development Patterns

- Client components (`'use client'`) for interactive views, API routes for all data
- Optimistic UI updates that revert by refetching on failure
- Business rules in `src/services/`, never duplicated in components
- Mobile-first responsive design

## Gotchas

- **Auth is NextAuth.js, NOT Supabase Auth.** Do not follow the workspace Supabase Auth patterns here.
- **RLS is effectively bypassed.** Every route uses the service-role client, so security rests entirely
  on the session check plus an explicit `user_id` ownership check in the route or service. If you add a
  route, you must add both.
  `projects` and `tasks` used to carry a permissive `ALL` policy for the `authenticated` role with
  `USING (true) WITH CHECK (true)` alongside their correct per-user policies. Permissive policies OR
  together, so any Supabase-authenticated JWT could read and write every row through PostgREST with the
  public anon key, independently of these routes.
  **`20260901000001_phase0_foundations.sql` dropped both. Applied to the live database on 2026-09-01
  and verified: zero permissive policies remain on either table.** Every table added since carries
  per-user policies only. Never reintroduce a `USING (true)` policy: it silently disables every other
  policy on the table.
- **Never hardcode `'done'`** when excluding finished tasks. Use `CLOSED_STATES` / `closedStatesFilter()`.
- **Never write `completed_at`, `cancelled_at`, `completed_customer_id` or `completed_customer_name`**
  from application code. `fn_task_state_cleanup` owns them. The two `completed_customer_*` columns are
  a snapshot of who the work was for, taken once when it finishes, so a past report cannot be rewritten
  by reassigning a project or renaming a customer.
- **`tasks.customer_id` is app-writable only when `project_id IS NULL`.** With a project,
  `fn_task_customer_sync` overwrites it from the project. `POST /api/tasks` rejects a request carrying
  both with a 400 rather than letting the trigger silently discard one.
- **`projects.stakeholders` is retired.** Each name becomes a customer or a contact through
  `/customers/setup`. The column is still present but nothing reads or writes it;
  `20260901000009_phase4_drop_stakeholders.sql` removes it and refuses to run while any name is
  untriaged.
- **Anything that changes more than one row is one database transaction, which means one RPC.**
  Separate `.update()` / `.insert()` calls through the Supabase client are separate PostgREST requests
  and therefore separate transactions. A service function is not a transaction boundary. Lifecycle
  operations (project close, reopen, delete, customer delete) live in `SECURITY DEFINER` Postgres
  functions, are called through `src/lib/rpc.js`, verify `p_user_id` internally, and have `EXECUTE`
  revoked from `public`, `anon` and `authenticated`. See `fn_assert_project_owner` for the pattern.
- **Office 365 sync only mirrors active projects** (`isProjectActive`: Open, In Progress, On Hold).
  Closing a project deletes its remote list.
- **Plain JavaScript, not TypeScript.** There are no `.ts`/`.tsx` files.
- **`next lint` is deprecated** and will break on Next.js 16. Migration is pending.
