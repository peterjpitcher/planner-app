-- Prevent multiple local tasks from pointing at the same Microsoft To Do item.

-- Keep the most recently updated mapping row when duplicates exist.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, list_id, todo_task_id
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS row_num
  FROM public.office365_task_items
)
DELETE FROM public.office365_task_items
WHERE id IN (
  SELECT id
  FROM ranked
  WHERE row_num > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS office365_task_items_user_list_todo_unique
  ON public.office365_task_items (user_id, list_id, todo_task_id);
