-- ============================================================
-- Backfill: close tasks left open under an already-closed project
-- ============================================================
--
-- Before the project lifecycle cascade existed (20260813111540 and
-- projectLifecycleService), closing a project changed only its own status. Its
-- open tasks stayed live and kept appearing in Today, the Plan board, backlog,
-- planning candidates, the autopilot pool and the daily digest, pointing at a
-- project that had dropped out of the project list.
--
-- This applies the cascade retrospectively, using exactly the same rule as the
-- live path:
--   project Cancelled -> open tasks become 'cancelled'
--   project Completed -> open tasks become 'done'
--
-- Deliberately scoped to the four ACTIVE states. Tasks already in a terminal
-- state are never touched: re-stating a 'done' task would fire the trigger's
-- leaving-'done' branch, null its completed_at and silently drop it out of the
-- completed report.
--
-- completed_at / cancelled_at are left to fn_task_state_cleanup, which stamps
-- them on the state transition. They are not written here.
--
-- Idempotent: re-running matches nothing, because the first run moves every
-- candidate out of the ACTIVE states.

BEGIN;

-- Cancelled projects: their open work was abandoned, not finished.
UPDATE public.tasks t
SET state = 'cancelled',
    updated_at = now()
FROM public.projects p
WHERE p.id = t.project_id
  AND p.status = 'Cancelled'
  AND t.state IN ('today', 'this_week', 'backlog', 'waiting');

-- Completed projects: their open work is treated as finished with the project.
UPDATE public.tasks t
SET state = 'done',
    updated_at = now()
FROM public.projects p
WHERE p.id = t.project_id
  AND p.status = 'Completed'
  AND t.state IN ('today', 'this_week', 'backlog', 'waiting');

COMMIT;
