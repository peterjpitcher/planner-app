-- Migration: Replace priority-based model with state-based containment model
-- This migration transforms tasks from priority/importance/urgency scoring
-- to a state-based workflow (today, this_week, backlog, waiting, done)
-- and introduces the ideas table for idea capture.
--
-- IMPORTANT: Run inside a single transaction. If any step fails, everything rolls back.

BEGIN;

-- ============================================================
-- STEP 1: Structural changes (no CHECK constraints yet)
-- ============================================================

-- 1a. Create the ideas table
CREATE TABLE IF NOT EXISTS public.ideas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  notes text,
  area text,
  idea_state text NOT NULL DEFAULT 'captured',
  why_it_matters text,
  smallest_step text,
  review_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 1b. Add new columns to tasks (no CHECK constraints yet to allow seeding)
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'backlog';
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS today_section text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS area text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS task_type text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS chips text[];
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS waiting_reason text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS follow_up_date date;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS entered_state_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS source_idea_id UUID REFERENCES public.ideas(id);

-- 1c. Make project_id nullable and change FK to ON DELETE SET NULL
ALTER TABLE public.tasks ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_project_id_fkey;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;

-- 1d. Add idea_id column to notes
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS idea_id UUID REFERENCES public.ideas(id);

-- 1e. Add area column to projects
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS area text;

-- 1f. Drop CHECK constraints on old priority fields (so we can later drop the columns)
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_priority_check;
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_priority_check;

-- Also drop the importance/urgency score range constraints
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_importance_score_range;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_urgency_score_range;


-- ============================================================
-- STEP 2: Seed existing data
-- ============================================================

-- Active tasks → backlog
UPDATE public.tasks SET state = 'backlog' WHERE is_completed = false;

-- Completed tasks → done (preserve completed_at)
UPDATE public.tasks SET state = 'done' WHERE is_completed = true;

-- Copy job → area on tasks and projects
UPDATE public.tasks SET area = job WHERE job IS NOT NULL;
UPDATE public.projects SET area = job WHERE job IS NOT NULL;

-- Seed sort_order with incremental values (1000 gaps for future insertions)
UPDATE public.tasks SET sort_order = sub.rn * 1000
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at ASC) AS rn
  FROM public.tasks
) sub
WHERE tasks.id = sub.id;

-- Seed entered_state_at from history (not now())
UPDATE public.tasks SET entered_state_at = COALESCE(updated_at, created_at);

-- Null out project_id for tasks in "Unassigned" projects (case-insensitive match)
UPDATE public.tasks SET project_id = NULL
WHERE project_id IN (SELECT id FROM public.projects WHERE LOWER(TRIM(name)) = 'unassigned');


-- ============================================================
-- STEP 2a: Verify seeding (these must all return 0)
-- ============================================================

DO $$
BEGIN
  IF (SELECT count(*) FROM public.tasks WHERE state IS NULL) > 0 THEN
    RAISE EXCEPTION 'Migration verification failed: tasks with NULL state exist';
  END IF;
  IF (SELECT count(*) FROM public.tasks WHERE sort_order IS NULL) > 0 THEN
    RAISE EXCEPTION 'Migration verification failed: tasks with NULL sort_order exist';
  END IF;
END $$;


-- ============================================================
-- STEP 3: Handle notes constraint
-- ============================================================

-- Update the check_note_parent constraint to include idea_id as a valid parent
ALTER TABLE public.notes DROP CONSTRAINT IF EXISTS check_note_parent;
ALTER TABLE public.notes ADD CONSTRAINT check_note_parent CHECK (
  (project_id IS NOT NULL)::int +
  (task_id IS NOT NULL)::int +
  (idea_id IS NOT NULL)::int = 1
);


-- ============================================================
-- STEP 4: Audit and drop old PL/pgSQL references
-- ============================================================

-- The only existing function is update_updated_at_column() which sets
-- updated_at = now() — it does NOT reference priority, is_completed,
-- importance_score, urgency_score, or job. No functions need updating.
--
-- Verified by searching all migrations for CREATE FUNCTION / CREATE TRIGGER:
-- only update_updated_at_column() and its triggers (handle_projects_updated_at,
-- handle_tasks_updated_at) exist, and they are column-agnostic.


-- ============================================================
-- STEP 5: Drop old columns
-- ============================================================

ALTER TABLE public.tasks DROP COLUMN IF EXISTS priority;
ALTER TABLE public.tasks DROP COLUMN IF EXISTS importance_score;
ALTER TABLE public.tasks DROP COLUMN IF EXISTS urgency_score;
ALTER TABLE public.tasks DROP COLUMN IF EXISTS is_completed;
ALTER TABLE public.tasks DROP COLUMN IF EXISTS job;
ALTER TABLE public.projects DROP COLUMN IF EXISTS priority;
ALTER TABLE public.projects DROP COLUMN IF EXISTS job;


-- ============================================================
-- STEP 6: Add constraints, trigger, and indexes
-- ============================================================

-- CHECK constraints
ALTER TABLE public.tasks ADD CONSTRAINT tasks_state_check
  CHECK (state IN ('today', 'this_week', 'backlog', 'waiting', 'done'));

ALTER TABLE public.tasks ADD CONSTRAINT tasks_today_section_check
  CHECK (today_section IN ('must_do', 'good_to_do', 'quick_wins'));

ALTER TABLE public.tasks ADD CONSTRAINT check_today_section
  CHECK (
    (state = 'today' AND today_section IS NOT NULL)
    OR (state != 'today' AND today_section IS NULL)
  );

ALTER TABLE public.tasks ADD CONSTRAINT tasks_task_type_check
  CHECK (task_type IN ('admin', 'reply_chase', 'fix', 'planning', 'content', 'deep_work', 'personal'));

ALTER TABLE public.ideas ADD CONSTRAINT ideas_state_check
  CHECK (idea_state IN ('captured', 'exploring', 'ready_later', 'promoted'));

-- Cleanup trigger: enforces state transition invariants
-- Does NOT silently default today_section — that is a service layer responsibility
CREATE OR REPLACE FUNCTION fn_task_state_cleanup()
RETURNS TRIGGER AS $$
BEGIN
  -- Clear today_section when leaving today state
  IF NEW.state != 'today' AND NEW.today_section IS NOT NULL THEN
    NEW.today_section := NULL;
  END IF;
  -- Auto-set completed_at when moving to done
  IF NEW.state = 'done' AND (OLD IS NULL OR OLD.state != 'done') THEN
    NEW.completed_at := now();
  END IF;
  -- Auto-clear completed_at when moving out of done
  IF OLD IS NOT NULL AND NEW.state != 'done' AND OLD.state = 'done' THEN
    NEW.completed_at := NULL;
  END IF;
  -- Track state changes
  IF OLD IS NULL OR NEW.state != OLD.state THEN
    NEW.entered_state_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_task_state_cleanup
  BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION fn_task_state_cleanup();

-- Batch sort order RPC for drag-and-drop reordering
CREATE OR REPLACE FUNCTION fn_batch_update_sort_order(p_user_id UUID, p_items JSONB)
RETURNS void AS $$
BEGIN
  UPDATE public.tasks SET
    sort_order = (item->>'sort_order')::integer,
    updated_at = now()
  FROM jsonb_array_elements(p_items) AS item
  WHERE tasks.id = (item->>'id')::uuid
    AND tasks.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Updated_at trigger for ideas table
CREATE TRIGGER handle_ideas_updated_at
  BEFORE UPDATE ON public.ideas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Performance indexes for new query patterns
CREATE INDEX idx_tasks_user_state_sort
  ON public.tasks (user_id, state, sort_order);

CREATE INDEX idx_tasks_user_today_section_sort
  ON public.tasks (user_id, today_section, sort_order)
  WHERE state = 'today';

CREATE INDEX idx_tasks_user_completed_at
  ON public.tasks (user_id, completed_at DESC)
  WHERE state = 'done';

CREATE INDEX idx_tasks_user_area
  ON public.tasks (user_id, area)
  WHERE area IS NOT NULL;

CREATE INDEX idx_tasks_user_followup
  ON public.tasks (user_id, follow_up_date)
  WHERE state = 'waiting' AND follow_up_date IS NOT NULL;

CREATE INDEX idx_ideas_user_state
  ON public.ideas (user_id, idea_state);

-- Drop legacy indexes that reference dropped columns
DROP INDEX IF EXISTS idx_tasks_user_completed_due_priority;
DROP INDEX IF EXISTS idx_tasks_user_scores;

-- Also drop the legacy job indexes (column is gone)
DROP INDEX IF EXISTS idx_tasks_user_job;
DROP INDEX IF EXISTS idx_projects_user_job;


-- ============================================================
-- RLS for ideas table
-- ============================================================

ALTER TABLE public.ideas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own ideas"
  ON public.ideas FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own ideas"
  ON public.ideas FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own ideas"
  ON public.ideas FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own ideas"
  ON public.ideas FOR DELETE
  USING (auth.uid() = user_id);

-- Grant table access (matching existing pattern)
GRANT ALL ON TABLE public.ideas TO anon;
GRANT ALL ON TABLE public.ideas TO authenticated;
GRANT ALL ON TABLE public.ideas TO service_role;


COMMIT;
