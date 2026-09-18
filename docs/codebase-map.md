# Planner 2.0 codebase map

Reference material moved out of `CLAUDE.md` on 2026-09-04 so that file holds only rules. Everything below was checked against the repo on that date and re-checked on 2026-09-18; when the code moves, update this file. Related: `docs/architecture/` (generated overview, routes, data model) and `docs/superpowers/specs/` (one design spec per feature wave).

## Pages (`src/app/`)

| Route | Purpose |
|-------|---------|
| `/today` | Daily working view, three sections (must do / good to do / quick wins) |
| `/plan` | Kanban board across task states |
| `/projects` | Project list, workspace and radar |
| `/customers`, `/customers/setup` | Customer records, contacts and facts; `setup` is the stakeholder triage screen |
| `/focus/project/[id]` | One project full-window for screen sharing (notes, quick task add, files), no app chrome and no links out |
| `/calendar` | Month calendar with drag-to-reschedule |
| `/ideas` | Idea vault, promotes to tasks |
| `/journal` | Journal entries with AI summary |
| `/completed-report` | Monthly completion reporting and CSV export |
| `/settings/planning`, `/settings/integrations` | Planning windows, automations, Office 365 connection |
| `/login` | NextAuth credentials sign-in |
| `/dashboard`, `/tasks`, `/capture`, `/prioritise` | Legacy redirects to `/today` or `/plan` |

## API route groups (`src/app/api/`)

- Data: `tasks` (+ `batch`, `sort-order`), `projects` (+ `[id]`, `radar`, `[id]/impact`), `customers` (+ `triage`, `[id]/overview`, `timeline`, `impact`, `facts`), `contacts`, `notes` (+ `batch`), `ideas` (+ `[id]/promote`), `journal/entries` (+ `cleanup`), `journal/summary`, `attachments` (`upload-url`, `[id]/finalise`, `[id]/url`), `search`, `unfiled`, `areas`, `completed-items`, `user-settings`, `automations`, `autopilot/clear`, `planning-candidates`, `planning-sessions`, `planning/ai-draft`.
- Auth: `auth/[...nextauth]`, plus the development/admin-gated `auth/debug-session`, `auth/session-test`, `auth/verify-config`, `debug-env` and `admin/migrate`.
- Public by design (see `src/middleware.js`): `actions/[token]`, `cron/*`, `health/app`, `health/supabase`, `integrations/office365/callback`.
- Office 365: `integrations/office365/connect`, `callback`, `status`, `sync`, `disconnect`.

## Cron jobs (`vercel.json`, schedules are UTC)

| Path | Schedule | Job |
|------|----------|-----|
| `/api/cron/daily-task-email` | 07:00 and 08:00 | Morning digest email, sent inside the London send window |
| `/api/cron/office365-sync` | every 5 minutes | Mirror active projects to Microsoft To Do |
| `/api/cron/demote-today-tasks` | 18:55 and 19:55 | Evening demotion of Today tasks |
| `/api/cron/demote-week-tasks` | 18:55 and 19:55 | Evening demotion of This Week tasks |
| `/api/cron/morning-autopilot` | 04:00 and 05:00 | Morning autopilot |
| `/api/cron/reconcile-attachments` | 03:00 Sunday | Reconcile Storage objects with `attachments` rows |

Each job appears twice because Vercel cron runs in UTC and the app works in Europe/London; the route decides which firing is the real one.

## Services (`src/services/`)

`taskService`, `projectLifecycleService`, `projectRadarService`, `customerService`, `contactService`, `noteService`, `ideaService`, `journalService`, `attachmentService`, `searchService`, `autopilotService`, `aiPlannerService`, `dailyTaskEmailService`, `automationStatusService`, `office365SyncService`, `office365ConnectionService`.

## Key files

| Path | Purpose |
|------|---------|
| `src/lib/constants.js` | State model, `CLOSED_STATES`, `closedStatesFilter()`, soft caps, thresholds |
| `src/lib/apiClient.js` | The only way components talk to the API (request dedupe and caching via `requestCache.js`) |
| `src/lib/supabaseServiceRole.js` | Server-side Supabase client (`SUPABASE_SERVICE_KEY`) |
| `src/lib/supabaseBrowser.js` | Browser client used only for the signed attachment upload |
| `src/lib/supabaseVault.js` | Supabase Vault helpers (`vault_*` RPCs) holding Office 365 tokens |
| `src/lib/authServer.js` | `getAuthContext`, `isAdminSession`, `isDevelopment` |
| `src/lib/cronAuth.js` | `verifyCronAuth`, `claimCronRun`, London-time helpers |
| `src/lib/rpc.js` | `callRpc`, `mapRpcError` |
| `src/lib/rateLimiter.js` | In-memory limiter, `getClientIdentifier(request, userId)` |
| `src/lib/emailActionToken.js` | Signed one-click email action tokens |
| `src/lib/microsoftGraph.js` | App-only Graph token and `sendMicrosoftEmail` |
| `src/lib/office365/` | OAuth and Graph calls for the To Do sync |
| `src/lib/dateUtils.js`, `src/lib/timezone.js` | Date formatting, Europe/London handling |
| `src/lib/quickTaskParser.js`, `src/lib/quickTaskDateParser.js` | Quick-add parsing (chrono-node) |
| `src/lib/recurrence.js` | Recurring task rules |
| `src/services/taskService.js` | Task CRUD, state transitions, recurrence, the customer-link rule |
| `src/services/projectLifecycleService.js` | Project close, reopen and delete via RPC; deletion impact preview |
| `src/components/Projects/ProjectsView.jsx` | Projects page root (owns the confirmations) |
| `src/components/Projects/ProjectDeleteModal.jsx`, `ProjectStatusChangeModal.jsx` | Delete and close confirmations |
| `src/components/Customers/` | Customer workspace, contacts, triage |
| `src/components/today/TodayView.jsx` | Today page root |
| `src/components/plan/PlanBoard.jsx` | Plan board root |
| `src/middleware.js` | Route protection and the public allow-list |

## Database

- Core tables: `projects`, `tasks`, `notes`, `ideas`, `journal_entries`, `user_settings`, `planning_sessions`, `cron_runs`, `daily_task_email_runs`, `email_action_tokens`.
- Customers (September 2026): `customers`, `customer_facts`, `contacts`, `project_contacts`, `stakeholder_resolutions`, `projects_stakeholders_archive`.
- Files: `attachments` rows plus the private Storage bucket `attachments` (25 MB per file, 2 GB per user, reconciled weekly by cron).
- Office 365: `office365_connections`, `office365_project_lists`, `office365_task_items`.
- Recurrence: `task_recurrence_spawns`, a receipt per completed recurring task written by `spawn_task_recurrence`, so its next occurrence is created once; service role only.
- `event_reminder_runs` exists but nothing in `src/` reads or writes it.
- Users are `auth.users`; there is no application users table.
- Functions that matter: `fn_task_state_cleanup` (trigger, owns `completed_at`, `cancelled_at`, `entered_state_at` and the `completed_customer_*` snapshot), `fn_task_customer_sync` (trigger, a task on a project takes the project's customer), `fn_assert_project_owner`, `close_project`, `reopen_project`, `delete_project_preserving_content`, `spawn_task_recurrence` and `promote_idea` (each one transaction), the `vault_*` helpers.
- Anon reach: `supabase/anon-access-allowlist.js` records what the public anon key can touch, and `supabase/__tests__/anon-access.test.js` compares it with the live catalogue when `SUPABASE_DB_URL` is set (it skips, saying why, otherwise).
- Migrations live in `supabase/migrations/` (Supabase project id `Planner` in `supabase/config.toml`). `db/`, `scripts/*migration*` and `POST /api/admin/migrate` are older manual helpers kept for reference; they are not the migration path.
