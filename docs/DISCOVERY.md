# Discovery - Planner

## Purpose
This document captures the app layout and repeatable tasks so future work can be run consistently.

## Quick Facts
- Stack: Next.js 15 (App Router), React 19, Tailwind CSS v4, Headless UI, Heroicons.
- Auth: NextAuth credentials provider backed by Supabase Auth; middleware protects non-public routes.
- Data: Supabase Postgres with RLS; tables include projects, tasks, notes, journal_entries.
- API: Route handlers under `src/app/api` for auth, projects, tasks, notes, journal, health.
- Alias: `@/*` maps to `src/*` (see `jsconfig.json`).

## Key Paths
- `src/app`: routes and layouts (`/dashboard`, `/completed-report`, `/journal`, `/login`).
- `src/components`: feature components (projects, tasks, notes, journal, dashboard, auth).
- `src/lib`: Supabase clients, API client, rate limiting, constants, utilities.
- `src/services`: task and journal services.
- `supabase/migrations`: schema and RLS migrations.
- `scripts`: env validation and migration helpers.

## Commands
```sh
npm install
npm run dev
npm run lint
npm run build
npm run start
```

## Environment Variables
Required for local dev and server routes:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL` (use `http://localhost:3000` in dev; production is hard-coded to `https://planner.orangejelly.co.uk`)
- `SUPABASE_SERVICE_KEY` (required for admin/migration scripts and server-side admin access)
- `OPENAI_API_KEY` (required for journal summaries)
- `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`, `MICROSOFT_USER_EMAIL` (required for the daily email digest cron)

Optional:
- `NODE_ENV`, `PORT`

## Repeatable Tasks

### Validate environment
```sh
node scripts/check-env.js
```
Verify runtime config in the browser:
- `GET /api/auth/verify-config`

### Health checks
```sh
curl http://localhost:3000/api/health/app
curl http://localhost:3000/api/health/supabase
```

### Database migrations
Generate SQL and instructions:
```sh
node scripts/run-migration.js
```
Push Supabase migrations with CLI:
```sh
SUPABASE_ACCESS_TOKEN=... ./scripts/push-migration.sh
```
Admin route (requires auth and RPC support in Supabase):
- `POST /api/admin/migrate`

### Journal summaries (OpenAI)
Set `OPENAI_API_KEY` and use `/journal` to generate summaries.

## Related Docs
- `docs/README.md`
- `docs/ARCHITECTURE.md`
- `docs/ENVIRONMENT_SETUP.md`
- `docs/ENGINEERING.md`
- `docs/TROUBLESHOOTING.md`
