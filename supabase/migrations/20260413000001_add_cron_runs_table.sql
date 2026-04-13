-- Migration: Add cron_runs table for idempotent cron execution tracking

CREATE TABLE public.cron_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation TEXT NOT NULL,
  run_date DATE NOT NULL,
  tasks_affected INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'claimed',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(operation, run_date)
);

ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.cron_runs TO service_role;
REVOKE ALL ON TABLE public.cron_runs FROM anon, authenticated;
