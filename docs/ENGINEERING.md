# Engineering Guide

This guide captures the current technical posture and the remaining backlog pulled forward from earlier reviews.

## Current Patterns
- **Data loading:** API routes batch-fetch projects, tasks, and notes to avoid N+1 queries.
- **Memoization:** Heavy list items (projects/tasks) rely on `React.memo`, `useMemo`, and `useCallback` to limit re-renders.
- **Client/Server split:** UI stays on the client where interactivity is needed; all database access stays on the server via Supabase helpers.
- **Deprecated integrations:** Microsoft Outlook sync was removed to simplify the stack.
- **Styling:** Tailwind v4 with LightningCSS; date handling via `date-fns`.

## Performance & DX Practices
- Keep components small; extract reusable UI pieces and hooks.
- Prefer batched data calls and minimal prop churn to avoid re-render storms.
- Add pagination or virtualization for any list that can exceed ~100 items.
- Use memoization for derived data and handlers; avoid inline component definitions inside render bodies.
- When adding new data flows, consider a query library (React Query/SWR) for caching and deduplication.

## Backlog (from prior audits)
- Introduce caching layer (React Query/SWR) with sensible stale times.
- Add pagination/virtualization for large task/project lists.
- Further split large components and centralize validation/formatting helpers.
- Explore more server components/SSR for heavy read-only views to shrink bundles.
- Standardize error handling and logging; remove noisy console output in production.

## Testing & Quality
- Linting is enforced via `npm run lint` and runs during build.
- Add unit/integration tests for API routes and critical flows (task update, project status changes, chase flows) as you extend features.
