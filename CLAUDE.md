# CLAUDE.md: Planner 2.0

Workspace standards live in `/Users/peterpitcher/Cursor/CLAUDE.md`; read that first. This file holds only what is unique to this repo. `AGENTS.md` is a symlink to this file so Codex and Cursor read the same rules.

## Stack, where it differs from the workspace default

- **Plain JavaScript, not TypeScript.** `.js` and `.jsx` only, no `typecheck` script.
- **Next.js 15.5, React 19, Tailwind v4**, Headless UI, Heroicons, lucide-react, dnd-kit, date-fns, chrono-node, OpenAI SDK.
- **Auth is NextAuth.js v4, not Supabase Auth.** A credentials provider checks the password with `supabase.auth.signInWithPassword`; NextAuth then issues its own JWT cookie. Do not apply the workspace Supabase Auth patterns here.
- **All data access goes through `src/app/api/*` route handlers with the service-role client.** No server actions, no Supabase queries from components.
- **Tests: Vitest 4, Testing Library, jsdom**; setup in `src/lib/__tests__/setup.js`, tests in `__tests__/` folders beside the code.
- **Vercel** (production `planner.orangejelly.co.uk`), crons in `vercel.json`. A single-user personal planning tool.

## Commands

```bash
npm run dev / build / start
npm run lint          # next lint: deprecated, breaks on Next.js 16, migration pending
npm test              # vitest run; test:watch to watch
npx supabase db push  # migrations live in supabase/migrations/
```

## Architecture

Request path: component -> `src/lib/apiClient.js` -> API route (session, ownership, rate limit) -> `src/services/*` -> Supabase (`src/lib/supabaseServiceRole.js`) or a Postgres RPC (`src/lib/rpc.js`). Business rules live in `src/services/`, never in routes or components. Client components update optimistically and revert by refetching on failure.

Route, service, key-file, cron and table reference: **`docs/codebase-map.md`**. Design specs per wave: `docs/superpowers/specs/`. Older `docs/` files (`DOCUMENTATION.md`, `ARCHITECTURE.md`, `refined_*.json`) are history, not rules.

## Authentication and route protection

- JWT session, 90-day `maxAge`, refreshed every 12 hours. `useSecureCookies` only in production: secure cookies over `http://localhost` are never stored, which produced a "login works but you stay on /login" loop.
- The `jwt` callback deliberately ignores `trigger === 'update'`. Spreading the client-supplied session over the token let any signed-in caller reissue their own cookie with a different `id` and `email`. Never copy identity fields from a session update.
- `src/middleware.js` protects everything except `/login`, `/api/auth/*`, `/api/actions/*`, `/api/cron/*`, `/api/health/*`, `/api/debug-env` and the Office 365 callback. `/api/actions/*` must stay public: the one-click email links carry their own HMAC, expiry and single-use `jti`, and gating them redirected the tap to `/login` and left the token in the login URL and browser history.
- **RLS is effectively bypassed** (every route uses the service-role client), so security rests entirely on the session check plus an explicit `user_id` ownership check in the route or service. A new route needs both.
- Cron routes use `verifyCronAuth` (`CRON_SECRET` as `x-cron-secret` or Bearer, or `CRON_MANUAL_TOKEN`); production fails closed without a secret, and the spoofable `x-vercel-cron` header is not trusted (FF-018). Health routes need `HEALTHCHECK_SECRET`. Debug and admin routes are gated on `isDevelopment()` and `isAdminSession()`.
- Rate limiting is in-memory, per Vercel instance (accepted tech debt). After auth, always key it with `getClientIdentifier(request, userId)`; IP headers are spoofable.

## Data model and business rules

**Task state** is the spine: `today`, `this_week`, `backlog`, `waiting`, `done`, `cancelled` (`STATE` in `src/lib/constants.js`).

- **`CLOSED_STATES` (`done`, `cancelled`) is the single source of truth for finished work.** Any query that hides finished tasks must use `CLOSED_STATES` / `closedStatesFilter()`. Never hardcode `'done'`: these exclusions used to be scattered denylists like `'("today","done")'`, so adding `cancelled` would have leaked cancelled tasks into Today, the Plan board, planning candidates, the autopilot pool and the daily digest.
- **`completed_at`, `cancelled_at`, `completed_customer_id` and `completed_customer_name` are owned by the `fn_task_state_cleanup` trigger.** Application code never writes them. The `completed_customer_*` pair is a snapshot of who the work was for, taken once, so a past report cannot be rewritten by reassigning a project or renaming a customer. The trigger also resets `entered_state_at` on every state change, which drives backlog ageing.
- **`tasks.customer_id` is app-writable only when `project_id IS NULL`.** With a project, `fn_task_customer_sync` overwrites it from the project; `createTask` rejects a request carrying both with a 400 rather than letting the trigger silently discard one.

**Project lifecycle** runs server-side in `projectLifecycleService` through RPCs; the UI confirms first and lists the affected tasks by name (`ProjectStatusChangeModal`).

| Transition | Effect |
|-----------|--------|
| to Completed | active tasks become `done`; notes move to the customer record |
| to Cancelled | active tasks become `cancelled`; notes move to the customer record |
| Cancelled, then reopened | only the tasks that close cancelled return to `backlog`; notes return |
| Completed, then reopened | `done` tasks stay done |

**Deleting a project keeps its content.** `tasks.project_id` is ON DELETE SET NULL (tasks become Unassigned). `notes.project_id` used to be ON DELETE CASCADE and a delete destroyed every note; it is now SET NULL, and `delete_project_preserving_content` moves the notes to the customer or leaves them unfiled. Destroying them is an explicit `destroyContent` opt-in, never the default. `notes.task_id` is still CASCADE. `ProjectDeleteModal` must state the task and note counts.

**Customers** (September 2026). `projects.stakeholders` is retired: each name becomes a customer or a contact through `/customers/setup`, and `20260901000011_phase4_drop_stakeholders.sql` archives and drops the column, refusing to run while any name is untriaged. The free-text `area` field is being retired in favour of customers; do not build on it.

**Anything that changes more than one row is one database transaction, which means one RPC.** Separate `.update()` / `.insert()` calls are separate PostgREST requests and therefore separate transactions; a service function is not a transaction boundary. Lifecycle operations (project close, reopen and delete, customer delete) are `SECURITY DEFINER` functions called through `src/lib/rpc.js`, verify `p_user_id` internally, and have `EXECUTE` revoked from `public`, `anon` and `authenticated`. Follow `fn_assert_project_owner`.

**PostgREST cannot embed across a composite foreign key** such as `customers(id, user_id)`; `/projects` failed to load because of it. Guard test: `src/app/api/projects/__tests__/postgrest-embed.test.js`.

## Integrations

- **Microsoft Graph, two ways.** Per-user OAuth mirrors active projects only (Open, In Progress, On Hold) to To Do lists named "Customer: Project"; tokens live in Supabase Vault. Closing a project deletes its remote list. Never delete local tasks because their remote list disappeared (FF-012). App-only client credentials send the morning digest from `MICROSOFT_USER_EMAIL`. There is no Resend here.
- **Daily digest** (`dailyTaskEmailService`): action links are HMAC-signed with `EMAIL_ACTION_SECRET` (unset means no buttons) and land on the public `/api/actions/[token]`; `isLondonWeekend` keeps it off at weekends.
- **Cron.** Vercel cron runs in UTC, so each job is listed twice in `vercel.json` an hour apart and the route checks the London hour or send window; `claimCronRun` (unique `cron_runs(operation, run_date)`) makes the second firing a no-op.
- **Attachments.** Private Storage bucket `attachments`. `auth.uid()` is NULL under NextAuth, so storage policies cannot help: the server mints a signed upload URL, the browser uploads with `src/lib/supabaseBrowser.js`, then `finalise` confirms the object. That is the only client-side Supabase use; never add another (the unused `src/contexts/SupabaseContext.js` must not become one).
- **OpenAI** powers the AI day-planner draft, journal summaries and journal cleanup.

## Environment variables

Names as the code reads them (`.env.example` still lists `OUTLOOK_*` variables that nothing reads).

```
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_KEY                 # not SUPABASE_SERVICE_ROLE_KEY; server only
NEXTAUTH_SECRET, NEXTAUTH_URL, NEXTAUTH_URL_PRODUCTION
ADMIN_USER_IDS, ADMIN_EMAILS
CRON_SECRET, CRON_MANUAL_TOKEN, HEALTHCHECK_SECRET
OPENAI_API_KEY, JOURNAL_CLEANUP_MODEL
EMAIL_ACTION_SECRET
MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_TENANT_ID, MICROSOFT_USER_EMAIL, OFFICE365_AUTO_SYNC_MINUTES
DAILY_TASK_EMAIL_FROM / TO / HOUR / MINUTE / WINDOW_MINUTES / TIME_ZONE, DIGEST_USER_EMAIL, DIGEST_USER_ID, DIGEST_DASHBOARD_URL
```

## Security rules

- **Never reintroduce a `USING (true)` policy**: it silently disables every other policy on the table. `projects` and `tasks` carried one for `authenticated`; permissive policies OR together, so any Supabase-authenticated JWT could read and write every row through PostgREST with the public anon key. `20260901000001_phase0_foundations.sql` dropped both (applied live 2026-09-01, verified: zero permissive policies remain). Every table since is per-user only.
- Security headers live in `next.config.mjs`. There is deliberately no Content-Security-Policy: App Router inline bootstrap scripts need per-request nonces, and a broken CSP is worse than none. Add one only as its own piece of work.

## Gotchas

- Vitest excludes `**/.claude/**` so git worktrees under `.claude/worktrees/` do not get their duplicate test files discovered. Keep that exclusion.
