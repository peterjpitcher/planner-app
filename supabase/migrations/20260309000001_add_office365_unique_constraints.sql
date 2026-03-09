-- Ensure unique constraints exist on Office365 mapping tables to prevent
-- duplicate task list and task item mappings from concurrent sync operations.
-- Uses CREATE UNIQUE INDEX IF NOT EXISTS so this migration is idempotent —
-- safe to run even if the constraints were already created by an earlier migration.

-- Deduplicate any remaining duplicate rows before adding indexes.
DELETE FROM public.office365_project_lists a
USING public.office365_project_lists b
WHERE a.id < b.id
  AND a.user_id = b.user_id
  AND a.project_id = b.project_id;

DELETE FROM public.office365_task_items a
USING public.office365_task_items b
WHERE a.id < b.id
  AND a.user_id = b.user_id
  AND a.task_id = b.task_id;

-- Add unique indexes (IF NOT EXISTS — safe to run multiple times).
CREATE UNIQUE INDEX IF NOT EXISTS office365_project_lists_user_project_unique
  ON public.office365_project_lists (user_id, project_id);

CREATE UNIQUE INDEX IF NOT EXISTS office365_task_items_user_task_unique
  ON public.office365_task_items (user_id, task_id);
