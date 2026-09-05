-- Additive workflow repair. No existing tasks or ideas are changed.
-- The source receipt survives deletion/completion of the next occurrence.
-- Deleting the source removes only its receipt, never its next task.
SET lock_timeout = '5s';

CREATE TABLE public.task_recurrence_spawns (
  source_task_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  next_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_recurrence_spawns_source_owner_fkey
    FOREIGN KEY (source_task_id, user_id)
    REFERENCES public.tasks(id, user_id) ON DELETE CASCADE
);
CREATE INDEX task_recurrence_spawns_next_idx
  ON public.task_recurrence_spawns(next_task_id) WHERE next_task_id IS NOT NULL;
ALTER TABLE public.task_recurrence_spawns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_recurrence_spawns FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.task_recurrence_spawns TO service_role;

-- A pre-upgrade completion has already attempted its next occurrence. Record
-- that fact without guessing which task was its successor or changing tasks.
-- This prevents historical undo/redo from creating another occurrence; it does
-- not recover a recurrence that had already failed before this migration.
INSERT INTO public.task_recurrence_spawns(source_task_id, user_id)
  SELECT id, user_id FROM public.tasks WHERE state = 'done' AND recurrence IS NOT NULL;

CREATE FUNCTION public.spawn_task_recurrence(
  p_user_id uuid,
  p_task_id uuid,
  p_due_date date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_source public.tasks%ROWTYPE;
  v_next public.tasks%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR p_task_id IS NULL THEN
    RAISE EXCEPTION 'User and task are required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_source FROM public.tasks
    WHERE id = p_task_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_source.state <> 'done' THEN
    RAISE EXCEPTION 'Only completed tasks can repeat' USING ERRCODE = '23514';
  END IF;
  IF v_source.recurrence IS NULL THEN
    RETURN jsonb_build_object('spawned', false, 'reason', 'not_recurring');
  END IF;
  IF v_source.recurrence NOT IN ('daily', 'weekdays', 'weekly', 'monthly') THEN
    RAISE EXCEPTION 'Invalid recurrence' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.task_recurrence_spawns WHERE source_task_id = p_task_id) THEN
    RETURN jsonb_build_object('spawned', false, 'reason', 'already_exists');
  END IF;
  IF p_due_date IS NULL OR p_due_date <= greatest(
    v_source.due_date, (now() AT TIME ZONE 'Europe/London')::date
  ) THEN
    RAISE EXCEPTION 'Next occurrence must be in the future' USING ERRCODE = '22023';
  END IF;
  IF v_source.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects WHERE id = v_source.project_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Project is not owned by user' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.tasks (
    user_id, name, description, project_id, customer_id, area, task_type,
    chips, recurrence, recurrence_interval, due_date, state
  ) VALUES (
    p_user_id, v_source.name, v_source.description, v_source.project_id,
    CASE WHEN v_source.project_id IS NULL THEN v_source.customer_id ELSE NULL END,
    v_source.area, v_source.task_type, v_source.chips, v_source.recurrence,
    greatest(coalesce(v_source.recurrence_interval, 1), 1), p_due_date, 'backlog'
  ) RETURNING * INTO v_next;
  INSERT INTO public.task_recurrence_spawns(source_task_id, user_id, next_task_id)
    VALUES (p_task_id, p_user_id, v_next.id);
  RETURN jsonb_build_object('spawned', true, 'task', to_jsonb(v_next));
END;
$$;
REVOKE ALL ON FUNCTION public.spawn_task_recurrence(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spawn_task_recurrence(uuid, uuid, date) TO service_role;

CREATE FUNCTION public.promote_idea(p_user_id uuid, p_idea_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_idea public.ideas%ROWTYPE;
  v_task public.tasks%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR p_idea_id IS NULL THEN
    RAISE EXCEPTION 'User and idea are required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_idea FROM public.ideas
    WHERE id = p_idea_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Idea not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_idea.idea_state = 'promoted' THEN
    RAISE EXCEPTION 'Already promoted' USING ERRCODE = '23505';
  END IF;
  IF v_idea.idea_state NOT IN ('captured', 'exploring', 'ready_later') THEN
    RAISE EXCEPTION 'Invalid idea state' USING ERRCODE = '23514';
  END IF;
  IF length(btrim(v_idea.title)) = 0 OR length(v_idea.title) > 255 THEN
    RAISE EXCEPTION 'Invalid task name' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.tasks (
    user_id, name, description, state, area, source_idea_id, sort_order, inbox
  ) VALUES (
    p_user_id, v_idea.title,
    nullif(concat_ws(E'\n\n', nullif(v_idea.why_it_matters, ''),
      nullif(v_idea.smallest_step, ''), nullif(v_idea.notes, '')), ''),
    'backlog', v_idea.area, v_idea.id, 0, true
  ) RETURNING * INTO v_task;
  UPDATE public.ideas SET idea_state = 'promoted' WHERE id = p_idea_id AND user_id = p_user_id;
  RETURN to_jsonb(v_task);
END;
$$;
REVOKE ALL ON FUNCTION public.promote_idea(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_idea(uuid, uuid) TO service_role;
RESET lock_timeout;
