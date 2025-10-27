-- Prevent duplicate full_sync jobs from piling up for the same user.
with ranked_full_syncs as (
  select
    id,
    row_number() over (
      partition by user_id, action
      order by
        case when status = 'processing' then 0 else 1 end,
        scheduled_at asc,
        created_at asc,
        id asc
    ) as rn
  from task_sync_jobs
  where action = 'full_sync'
    and status in ('pending', 'processing')
)
delete from task_sync_jobs
where id in (
  select id
  from ranked_full_syncs
  where rn > 1
);

create unique index if not exists task_sync_jobs_unique_full_sync_active
  on task_sync_jobs (user_id)
  where action = 'full_sync'
    and status in ('pending', 'processing');
