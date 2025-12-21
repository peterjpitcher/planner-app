-- Remove Outlook integration schema

DROP FUNCTION IF EXISTS public.claim_task_sync_jobs(integer, uuid);

DROP TABLE IF EXISTS public.project_outlook_lists;
DROP TABLE IF EXISTS public.task_sync_jobs;
DROP TABLE IF EXISTS public.task_sync_state;
DROP TABLE IF EXISTS public.outlook_connections;
