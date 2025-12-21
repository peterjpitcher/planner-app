alter table public.journal_entries
  add column if not exists cleaned_content text;

alter table public.journal_entries
  add column if not exists ai_status text not null default 'skipped';

alter table public.journal_entries
  add column if not exists ai_error text;

alter table public.journal_entries
  add column if not exists cleaned_at timestamp with time zone;
