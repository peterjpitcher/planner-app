-- Office 365 (Microsoft To Do) sync tables

create table if not exists public.office365_connections (
  id uuid not null default extensions.uuid_generate_v4(),
  user_id uuid not null,
  microsoft_tenant_id text,
  microsoft_user_id text,
  microsoft_user_email text,
  scopes text[] not null default '{}'::text[],
  refresh_token_secret_id uuid not null,
  access_token_secret_id uuid,
  access_token_expires_at timestamp with time zone,
  sync_enabled boolean not null default true,
  last_synced_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint office365_connections_pkey primary key (id),
  constraint office365_connections_user_unique unique (user_id),
  constraint office365_connections_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade
);

create index if not exists office365_connections_user_idx
  on public.office365_connections (user_id);

create trigger handle_office365_connections_updated_at
before update on public.office365_connections
for each row execute function public.update_updated_at_column();

alter table public.office365_connections enable row level security;

drop policy if exists "Users manage own Office365 connections" on public.office365_connections;
create policy "Users manage own Office365 connections"
on public.office365_connections
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create table if not exists public.office365_project_lists (
  id uuid not null default extensions.uuid_generate_v4(),
  user_id uuid not null,
  project_id uuid not null,
  list_id text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint office365_project_lists_pkey primary key (id),
  constraint office365_project_lists_user_project_unique unique (user_id, project_id),
  constraint office365_project_lists_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint office365_project_lists_project_id_fkey foreign key (project_id) references public.projects (id) on delete cascade
);

create index if not exists office365_project_lists_user_idx
  on public.office365_project_lists (user_id);

create index if not exists office365_project_lists_project_idx
  on public.office365_project_lists (project_id);

create trigger handle_office365_project_lists_updated_at
before update on public.office365_project_lists
for each row execute function public.update_updated_at_column();

alter table public.office365_project_lists enable row level security;

drop policy if exists "Users manage own Office365 project lists" on public.office365_project_lists;
create policy "Users manage own Office365 project lists"
on public.office365_project_lists
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create table if not exists public.office365_task_items (
  id uuid not null default extensions.uuid_generate_v4(),
  user_id uuid not null,
  task_id uuid not null,
  project_id uuid not null,
  list_id text not null,
  todo_task_id text not null,
  etag text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint office365_task_items_pkey primary key (id),
  constraint office365_task_items_user_task_unique unique (user_id, task_id),
  constraint office365_task_items_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint office365_task_items_task_id_fkey foreign key (task_id) references public.tasks (id) on delete cascade,
  constraint office365_task_items_project_id_fkey foreign key (project_id) references public.projects (id) on delete cascade
);

create index if not exists office365_task_items_user_idx
  on public.office365_task_items (user_id);

create index if not exists office365_task_items_task_idx
  on public.office365_task_items (task_id);

create index if not exists office365_task_items_project_idx
  on public.office365_task_items (project_id);

create trigger handle_office365_task_items_updated_at
before update on public.office365_task_items
for each row execute function public.update_updated_at_column();

alter table public.office365_task_items enable row level security;

drop policy if exists "Users manage own Office365 task items" on public.office365_task_items;
create policy "Users manage own Office365 task items"
on public.office365_task_items
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
