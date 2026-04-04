# Structural Mapper Report — Planner2.0

## Key Multi-Step Operations

### Task Create: DB insert → project.updated_at update → Office365 sync
### Task Delete: DB delete → Office365 delete (sync)
### Project Create: Validate → DB insert → Office365 sync (best-effort)
### Project Delete: Office365 delete → DB delete (cascade tasks/notes)
### Office365 OAuth: validate cookies → exchange code → store vault → upsert DB → redirect
### Office365 Sync: fetch connections → refresh token → fetch all data → sync projects → sync tasks → update last_synced_at
### Daily Email: claim run → build email → send → update status

## Critical Structural Observations

1. **No RLS** — service role used for all data ops; ownership checked in code only
2. **In-memory rate limiter** — per-process, resets on cold start, not shared across instances
3. **Middleware excludes `/api/cron/*`** — cron routes must self-auth
4. **Middleware excludes `/api/debug-env`** — debug endpoint auto-excluded from auth
5. **process.env mutation at module load** — NEXTAUTH_URL overwritten in production
6. **console.log in supabaseClient.js:16** — logs on every cold start
7. **No test coverage** — zero tests in project

## Environment Variables (27 total)
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY,
NEXTAUTH_SECRET, NEXTAUTH_URL, MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, 
MICROSOFT_CLIENT_SECRET, MICROSOFT_USER_EMAIL, OPENAI_API_KEY, CRON_SECRET,
CRON_MANUAL_TOKEN, DAILY_TASK_EMAIL_HOUR, DAILY_TASK_EMAIL_MINUTE,
DAILY_TASK_EMAIL_WINDOW_MINUTES, DAILY_TASK_EMAIL_TIME_ZONE, DAILY_TASK_EMAIL_FROM,
DAILY_TASK_EMAIL_TO, DIGEST_USER_EMAIL, DIGEST_DASHBOARD_URL, ADMIN_USER_IDS,
ADMIN_EMAILS, OFFICE365_AUTO_SYNC_MINUTES, NODE_ENV, PORT, PRODUCTION_URL

## Database Tables
projects, tasks, notes, journal_entries, office365_connections, 
office365_project_lists, office365_task_items, daily_task_email_runs

## API Surface (26 routes)
GET/POST/PATCH/DELETE /api/tasks, /api/tasks/[id], POST /api/tasks/batch
GET/POST/PATCH/DELETE /api/projects, /api/projects/[id]
GET/POST /api/notes, /api/notes/batch
GET/POST /api/journal/entries, GET /api/journal/summary, DELETE /api/journal/entries/cleanup
GET /api/integrations/office365/{connect,callback,status,disconnect}, POST /api/integrations/office365/sync
GET /api/cron/{office365-sync,daily-task-email}
GET /api/health/{app,supabase}
GET /api/debug-env, GET /api/admin/migrate, GET /api/auth/{debug-session,session-test,verify-config}
