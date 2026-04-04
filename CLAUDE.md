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
