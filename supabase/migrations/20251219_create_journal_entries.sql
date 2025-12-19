create table journal_entries (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null default auth.uid (),
  content text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint journal_entries_pkey primary key (id),
  constraint journal_entries_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade
);

create index journal_entries_user_id_idx on journal_entries (user_id);
create index journal_entries_created_at_idx on journal_entries (created_at);

alter table journal_entries enable row level security;

create policy "Users can view their own journal entries" on journal_entries
  for select
  using (auth.uid() = user_id);

create policy "Users can create their own journal entries" on journal_entries
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own journal entries" on journal_entries
  for update
  using (auth.uid() = user_id);

create policy "Users can delete their own journal entries" on journal_entries
  for delete
  using (auth.uid() = user_id);
