-- Add job/swimlane tagging to projects and standalone tasks

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS job text;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS job text;

-- Optional backfill: if you previously used a "Bill" stakeholder as a proxy for a job,
-- copy that marker into the new `projects.job` field so you can filter by it immediately.
UPDATE public.projects
SET job = COALESCE(job, 'Bill')
WHERE job IS NULL
  AND stakeholders IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM unnest(stakeholders) AS stakeholder
    WHERE stakeholder ILIKE '%bill%'
  );

CREATE INDEX IF NOT EXISTS idx_projects_user_job
  ON public.projects (user_id, job);

CREATE INDEX IF NOT EXISTS idx_tasks_user_job
  ON public.tasks (user_id, job);

