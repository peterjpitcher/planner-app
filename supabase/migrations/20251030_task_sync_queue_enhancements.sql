alter table public.task_sync_jobs
  add column if not exists picked_at timestamptz,
  add column if not exists worker_id uuid,
  add column if not exists heartbeat_at timestamptz;

create or replace function public.claim_task_sync_jobs(job_limit integer default 25, worker_uuid uuid default extensions.uuid_generate_v4())
returns setof public.task_sync_jobs
language sql
security definer
set search_path = public
as $$
with selected as (
  select id
    from public.task_sync_jobs
   where status = 'pending'
     and scheduled_at <= now()
   order by scheduled_at asc
   for update skip locked
   limit greatest(coalesce(job_limit, 25), 1)
)
update public.task_sync_jobs
   set status = 'processing',
       attempts = attempts + 1,
       picked_at = now(),
       heartbeat_at = now(),
       worker_id = worker_uuid,
       updated_at = now()
 where id in (select id from selected)
 returning public.task_sync_jobs.*;
$$;

comment on function public.claim_task_sync_jobs(integer, uuid) is 'Atomically claims pending task sync jobs for processing, ensuring SKIP LOCKED semantics.';
