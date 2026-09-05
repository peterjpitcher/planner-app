\set ON_ERROR_STOP on
-- Run only in a disposable database. All fixture data is synthetic.
-- This focused schema preserves the relevant live column types, constraints
-- and the actual customer/completion triggers, without copying user records.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users,
  name text NOT NULL, UNIQUE(id, user_id)
);
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users,
  name text NOT NULL, status text NOT NULL DEFAULT 'Open', customer_id uuid,
  FOREIGN KEY(customer_id,user_id) REFERENCES public.customers(id,user_id)
);
CREATE TABLE public.ideas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users,
  title text NOT NULL, notes text, area text, idea_state text NOT NULL DEFAULT 'captured',
  why_it_matters text, smallest_step text, review_date date,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(idea_state IN ('captured','exploring','ready_later','promoted'))
);
CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid REFERENCES public.projects ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name text NOT NULL, description text, due_date date,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  state text NOT NULL DEFAULT 'backlog', today_section text, sort_order integer NOT NULL DEFAULT 0,
  area text, task_type text, chips text[], waiting_reason text, follow_up_date date,
  entered_state_at timestamptz NOT NULL DEFAULT now(), source_idea_id uuid REFERENCES public.ideas,
  snoozed_until date, snooze_count integer NOT NULL DEFAULT 0, inbox boolean NOT NULL DEFAULT false,
  carried_count integer NOT NULL DEFAULT 0, carried_section text, autoplanned_at timestamptz,
  recurrence text, recurrence_interval integer NOT NULL DEFAULT 1, chase_count integer NOT NULL DEFAULT 0,
  plan_reason text, cancelled_at timestamptz, customer_id uuid, lifecycle_move_id uuid, lifecycle_prev_state text,
  completed_customer_id uuid, completed_customer_name text, UNIQUE(id,user_id),
  FOREIGN KEY(customer_id,user_id) REFERENCES public.customers(id,user_id) ON DELETE SET NULL(customer_id),
  CHECK(state IN ('today','this_week','backlog','waiting','done','cancelled')),
  CHECK(recurrence IS NULL OR recurrence IN ('daily','weekdays','weekly','monthly')),
  CHECK((state = 'today' AND today_section IS NOT NULL) OR (state <> 'today' AND today_section IS NULL)),
  CHECK(today_section IN ('must_do','good_to_do','quick_wins')),
  CHECK(task_type IN ('admin','reply_chase','fix','planning','content','deep_work','personal'))
);

-- Current deployed trigger definition from supabase/migrations/20260901000002_phase1_customers.sql
CREATE OR REPLACE FUNCTION public.fn_task_customer_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.project_id IS NOT NULL THEN
    -- The user_id match matters: without it the trigger would happily copy a
    -- customer across an ownership boundary if a bad project_id ever arrived.
    SELECT p.customer_id INTO NEW.customer_id
      FROM public.projects p
     WHERE p.id = NEW.project_id
       AND p.user_id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Current deployed trigger definition from supabase/migrations/20260901000008_phase4_search_and_reporting.sql
CREATE OR REPLACE FUNCTION fn_task_state_cleanup()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_customer_name text;
BEGIN
  -- Clear today_section when leaving today state
  IF NEW.state != 'today' AND NEW.today_section IS NOT NULL THEN
    NEW.today_section := NULL;
  END IF;
  -- Auto-set completed_at when moving to done, preserving a supplied value
  IF NEW.state = 'done' AND (OLD IS NULL OR OLD.state != 'done') THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
  END IF;
  -- Auto-clear completed_at when moving out of done
  IF OLD IS NOT NULL AND NEW.state != 'done' AND OLD.state = 'done' THEN
    NEW.completed_at := NULL;
  END IF;
  -- Auto-set cancelled_at when moving to cancelled, preserving a supplied value
  IF NEW.state = 'cancelled' AND (OLD IS NULL OR OLD.state != 'cancelled') THEN
    NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
  END IF;
  -- Auto-clear cancelled_at when moving out of cancelled
  IF OLD IS NOT NULL AND NEW.state != 'cancelled' AND OLD.state = 'cancelled' THEN
    NEW.cancelled_at := NULL;
  END IF;
  -- Track state changes
  IF OLD IS NULL OR NEW.state != OLD.state THEN
    NEW.entered_state_at := now();
  END IF;

  -- Snapshot who the work was for, at the moment it finishes. Set once and
  -- never updated afterwards, which is what makes a past report reproducible.
  IF NEW.state IN ('done', 'cancelled')
     AND (OLD IS NULL OR OLD.state NOT IN ('done', 'cancelled'))
     AND NEW.customer_id IS NOT NULL THEN
    SELECT c.name INTO v_customer_name
      FROM public.customers c
     WHERE c.id = NEW.customer_id AND c.user_id = NEW.user_id;

    NEW.completed_customer_id := NEW.customer_id;
    NEW.completed_customer_name := v_customer_name;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_task_customer_sync BEFORE INSERT OR UPDATE OF project_id, customer_id
  ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.fn_task_customer_sync();
CREATE TRIGGER trg_task_state_cleanup BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.fn_task_state_cleanup();

-- Simulate existing default ACLs. The migration must revoke inherited access.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated;
CREATE TEMP TABLE fixture_ids AS SELECT gen_random_uuid() AS owner_id, gen_random_uuid() AS other_id;
INSERT INTO auth.users SELECT owner_id FROM fixture_ids UNION ALL SELECT other_id FROM fixture_ids;
INSERT INTO public.tasks(user_id,name,state,recurrence,due_date)
  SELECT owner_id,'Legacy completed recurrence','done','daily','2030-03-10' FROM fixture_ids;

\ir ../migrations/20260905162045_atomic_promotion_and_recurrence.sql

DO $$
DECLARE
  u uuid; other_u uuid; c uuid; p1 uuid; p2 uuid; a uuid; b uuid; standalone uuid;
  idea uuid; invalid_idea uuid; failed_source uuid; legacy uuid; next_id uuid; result jsonb; n integer;
BEGIN
  SELECT owner_id, other_id INTO u, other_u FROM fixture_ids;
  SELECT id INTO legacy FROM public.tasks WHERE name = 'Legacy completed recurrence';
  IF (SELECT count(*) FROM public.task_recurrence_spawns WHERE source_task_id=legacy) <> 1 THEN
    RAISE EXCEPTION 'Legacy completed recurrence has no receipt';
  END IF;
  UPDATE public.tasks SET state='backlog' WHERE id=legacy;
  UPDATE public.tasks SET state='done' WHERE id=legacy;
  result := public.spawn_task_recurrence(u,legacy,'2030-03-11');
  IF (result->>'spawned')::boolean THEN RAISE EXCEPTION 'Legacy undo/redo spawned again'; END IF;

  INSERT INTO public.customers(user_id,name) VALUES(u,'Synthetic customer') RETURNING id INTO c;
  INSERT INTO public.projects(user_id,name,customer_id) VALUES(u,'Project A',c) RETURNING id INTO p1;
  INSERT INTO public.projects(user_id,name,customer_id) VALUES(u,'Project B',c) RETURNING id INTO p2;
  INSERT INTO public.tasks(user_id,name,project_id,state,recurrence,due_date)
    VALUES(u,'Same name',p1,'done','weekly','2030-03-10') RETURNING id INTO a;
  INSERT INTO public.tasks(user_id,name,project_id,state,recurrence,due_date)
    VALUES(u,'Same name',p2,'done','weekly','2030-03-10') RETURNING id INTO b;
  result := public.spawn_task_recurrence(u,a,'2030-03-17');
  IF NOT (result->>'spawned')::boolean THEN RAISE EXCEPTION 'Project A did not spawn'; END IF;
  IF result->'task'->>'customer_id' <> c::text THEN RAISE EXCEPTION 'Project customer not inherited'; END IF;
  next_id := (result->'task'->>'id')::uuid;
  result := public.spawn_task_recurrence(u,b,'2030-03-17');
  IF NOT (result->>'spawned')::boolean THEN RAISE EXCEPTION 'Project B suppressed by Project A'; END IF;
  UPDATE public.tasks SET state='done' WHERE id=next_id;
  result := public.spawn_task_recurrence(u,a,'2030-03-17');
  IF (result->>'spawned')::boolean THEN RAISE EXCEPTION 'Closed successor was duplicated'; END IF;
  DELETE FROM public.tasks WHERE id=next_id;
  result := public.spawn_task_recurrence(u,a,'2030-03-17');
  IF (result->>'spawned')::boolean THEN RAISE EXCEPTION 'Deleted successor was recreated'; END IF;

  INSERT INTO public.tasks(user_id,name,customer_id,state,recurrence,due_date)
    VALUES(u,'Customer task',c,'done','daily','2030-03-10') RETURNING id INTO standalone;
  result := public.spawn_task_recurrence(u,standalone,'2030-03-11');
  next_id := (result->'task'->>'id')::uuid;
  IF result->'task'->>'customer_id' <> c::text THEN RAISE EXCEPTION 'Standalone customer lost'; END IF;
  UPDATE public.tasks SET state='done' WHERE id=next_id;
  IF (SELECT completed_customer_name FROM public.tasks WHERE id=next_id) <> 'Synthetic customer' THEN
    RAISE EXCEPTION 'Completion customer snapshot missing';
  END IF;

  BEGIN
    PERFORM public.spawn_task_recurrence(other_u, standalone, '2030-03-11');
    RAISE EXCEPTION 'Foreign source accepted';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  INSERT INTO public.tasks(user_id,name,state,recurrence,due_date)
    VALUES(u,'Active source','backlog','daily','2030-03-10') RETURNING id INTO failed_source;
  BEGIN
    PERFORM public.spawn_task_recurrence(u, failed_source, '2030-03-11');
    RAISE EXCEPTION 'Active source accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  INSERT INTO public.ideas(user_id,title,notes) VALUES(u,'Promote once','Fixture note') RETURNING id INTO idea;
  result := public.promote_idea(u,idea);
  IF result->>'source_idea_id' <> idea::text OR result->>'inbox' <> 'true' THEN
    RAISE EXCEPTION 'Promotion lost source or triage flag';
  END IF;
  BEGIN
    PERFORM public.promote_idea(u,idea);
    RAISE EXCEPTION 'Duplicate promotion accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  IF (SELECT count(*) FROM public.tasks WHERE source_idea_id=idea) <> 1 THEN RAISE EXCEPTION 'Duplicate task'; END IF;
  BEGIN
    PERFORM public.promote_idea(other_u,idea);
    RAISE EXCEPTION 'Foreign idea accepted';
  EXCEPTION WHEN no_data_found THEN NULL; END;

  INSERT INTO public.ideas(user_id,title) VALUES(u,'') RETURNING id INTO invalid_idea;
  BEGIN
    PERFORM public.promote_idea(u,invalid_idea);
    RAISE EXCEPTION 'Invalid title accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF (SELECT idea_state FROM public.ideas WHERE id=invalid_idea) <> 'captured' THEN RAISE EXCEPTION 'Failed promotion changed state'; END IF;

  IF has_function_privilege('anon','public.promote_idea(uuid,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.promote_idea(uuid,uuid)','EXECUTE')
    OR has_function_privilege('anon','public.spawn_task_recurrence(uuid,uuid,date)','EXECUTE')
    OR has_function_privilege('authenticated','public.spawn_task_recurrence(uuid,uuid,date)','EXECUTE')
    OR has_table_privilege('authenticated','public.task_recurrence_spawns','SELECT')
    OR has_table_privilege('anon','public.task_recurrence_spawns','SELECT') THEN
    RAISE EXCEPTION 'Unexpected public workflow privilege';
  END IF;
  IF NOT has_function_privilege('service_role','public.promote_idea(uuid,uuid)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.spawn_task_recurrence(uuid,uuid,date)','EXECUTE') THEN
    RAISE EXCEPTION 'Service role cannot execute workflows';
  END IF;
  RAISE NOTICE 'Workflow identity, lifecycle, legacy receipts and privilege assertions passed';
END $$;

-- Force dependency failure after valid inputs, proving transactional rollback.
CREATE FUNCTION public.fixture_reject_task_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Injected task insert failure' USING ERRCODE='23514'; END $$;
CREATE TRIGGER fixture_reject_task_insert BEFORE INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.fixture_reject_task_insert();
DO $$
DECLARE u uuid; idea uuid; source uuid;
BEGIN
  SELECT owner_id INTO u FROM fixture_ids;
  INSERT INTO public.ideas(user_id,title) VALUES(u,'Insertion fails') RETURNING id INTO idea;
  BEGIN
    PERFORM public.promote_idea(u,idea);
    RAISE EXCEPTION 'Injected failure was swallowed';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF (SELECT idea_state FROM public.ideas WHERE id=idea) <> 'captured' THEN RAISE EXCEPTION 'Idea state committed despite failure'; END IF;
  SELECT id INTO source FROM public.tasks WHERE name='Active source';
  UPDATE public.tasks SET state='done' WHERE id=source;
  BEGIN
    PERFORM public.spawn_task_recurrence(u,source,'2030-03-11');
    RAISE EXCEPTION 'Injected failure was swallowed';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF EXISTS(SELECT 1 FROM public.task_recurrence_spawns WHERE source_task_id=source) THEN
    RAISE EXCEPTION 'Receipt committed despite insert failure';
  END IF;
  RAISE NOTICE 'Dependency failure rollback assertions passed';
END $$;
ROLLBACK;
