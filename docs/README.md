# Planner Documentation

## Overview
Planner is a task and project management app built with **Next.js 15 (App Router)**, **React 19**, and **Supabase**. All data access flows through server-side API routes to keep Row Level Security (RLS) intact. Authentication is handled via NextAuth with Supabase as the primary data store.

## Core Workflows
- Projects: create, update status/priority/dates/stakeholders, archive/cancel.
- Tasks: inline edit, drag between projects, quick add, complete, and “Chase” (push due date + auto-note).
- Notes: attach to projects or tasks; workspace modal for focused editing.
- Dashboard: filtered views, stakeholder filters, task focus filters, metrics bar.

## Stack & Architecture
- Next.js App Router, React 19, Tailwind (v4), Headless UI, Heroicons.
- Supabase for persistence; API routes proxy all DB calls (no direct client queries).
- NextAuth for sessions; Supabase service role used only on the server.
- LightningCSS for styles, date-fns for date utilities.
- See `docs/ARCHITECTURE.md` for system layout and recent changes.

## Local Development
1) Prereqs: Node 18+ and npm.
2) Install deps: `npm install`
3) Env vars (`.env.local`):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_KEY` (server use only)
   - `NEXTAUTH_SECRET`
   - `NEXTAUTH_URL` (e.g., `http://localhost:3000` in dev)
4) Run dev server: `npm run dev`

## Scripts
- `npm run dev` – Start dev server.
- `npm run lint` – ESLint via `next lint`.
- `npm run build` – Production build (includes lint + type checks).
- `npm run start` – Serve the production build.

## Data & Security Notes
- RLS enforced in Supabase; API routes ensure queries are scoped to the signed-in user.
- Rate limiting in API routes guards against abuse on batch and note endpoints.
- Do not expose service keys to the client; only `NEXT_PUBLIC_*` keys should be bundled.

## Contributor Guidelines (high level)
- Keep components small; prefer extracting hooks/utilities for shared logic.
- Favor memoization (`React.memo`, `useMemo`, `useCallback`) for list-heavy views.
- Batch fetch related data (projects/tasks/notes) instead of N+1 per item.
- Maintain accessibility (keyboard, focus states, ARIA) and mobile-friendly hit areas.
- See `docs/ENGINEERING.md` and `docs/SECURITY.md` for performance and security expectations.
