create table if not exists public.daily_task_email_runs (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  run_date date not null,
  to_email text not null,
  status text not null default 'sent',
  due_today_count integer not null default 0,
  overdue_count integer not null default 0,
  error text,
  created_at timestamp with time zone not null default now(),
  sent_at timestamp with time zone,
  constraint daily_task_email_runs_pkey primary key (id),
  constraint daily_task_email_runs_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint daily_task_email_runs_user_date_key unique (user_id, run_date)
);

create index if not exists daily_task_email_runs_user_date_idx
  on public.daily_task_email_runs (user_id, run_date desc);

alter table public.daily_task_email_runs enable row level security;

