-- ============================================================
-- Customers, Phase 3: files follow their notes
-- ============================================================
--
-- Phase 2 shipped the note half of the close, reopen and delete lifecycle. The
-- attachments table did not exist yet, so the file half could not be written
-- then without the phases depending on each other backwards.
--
-- These are CREATE OR REPLACE of the Phase 2 functions rather than new ones,
-- because there is one implementation per operation. A second "close a project
-- and also move its files" function would be exactly the drift this design
-- exists to avoid.
--
-- Requires 20260901000006_phase3_attachments.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.close_project(
  p_project_id     uuid,
  p_user_id        uuid,
  p_status         text,
  p_closeout_note  text DEFAULT NULL,
  p_facts          jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_project public.projects;
  v_move_id uuid := gen_random_uuid();
  v_task_state text;
  v_tasks int := 0;
  v_notes int := 0;
  v_files int := 0;
  v_facts int := 0;
  v_note_id uuid;
  v_fact jsonb;
  v_label text;
BEGIN
  IF p_status NOT IN ('Completed', 'Cancelled') THEN
    RAISE EXCEPTION 'close_project only handles Completed and Cancelled' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_project FROM public.projects
   WHERE id = p_project_id AND user_id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project % is not owned by user %', p_project_id, p_user_id
      USING ERRCODE = '42501';
  END IF;

  IF v_project.status = p_status THEN
    RETURN jsonb_build_object('alreadyClosed', true, 'tasksChanged', 0, 'notesMoved', 0, 'filesMoved', 0);
  END IF;

  v_task_state := CASE WHEN p_status = 'Completed' THEN 'done' ELSE 'cancelled' END;
  v_label := 'From project: ' || v_project.name;

  UPDATE public.projects SET status = p_status, updated_at = now() WHERE id = p_project_id;

  WITH moved AS (
    UPDATE public.tasks
       SET state = v_task_state,
           lifecycle_move_id = v_move_id,
           lifecycle_prev_state = state,
           updated_at = now()
     WHERE project_id = p_project_id AND user_id = p_user_id
       AND state IN ('today', 'this_week', 'backlog', 'waiting')
    RETURNING id
  )
  SELECT count(*) INTO v_tasks FROM moved;

  IF v_project.customer_id IS NOT NULL THEN
    WITH moved AS (
      UPDATE public.notes
         SET customer_id = v_project.customer_id,
             project_id = NULL,
             origin_project_id = p_project_id,
             lifecycle_move_id = v_move_id,
             lifecycle_moved_at = now(),
             context_label = v_label
       WHERE project_id = p_project_id AND user_id = p_user_id
      RETURNING id
    )
    SELECT count(*) INTO v_notes FROM moved;

    v_files := public.fn_move_project_attachments(
      p_project_id, p_user_id, v_project.customer_id, v_move_id, v_label
    );
  END IF;

  IF p_closeout_note IS NOT NULL AND btrim(p_closeout_note) <> '' THEN
    INSERT INTO public.notes (
      user_id, customer_id, project_id, content, source, pinned, occurred_at, context_label
    )
    VALUES (
      p_user_id, v_project.customer_id,
      CASE WHEN v_project.customer_id IS NULL THEN p_project_id ELSE NULL END,
      btrim(p_closeout_note), 'note', true, now(), 'Close-out: ' || v_project.name
    )
    RETURNING id INTO v_note_id;
  END IF;

  IF p_facts IS NOT NULL AND v_project.customer_id IS NOT NULL THEN
    FOR v_fact IN SELECT * FROM jsonb_array_elements(p_facts) LOOP
      IF btrim(coalesce(v_fact->>'label','')) <> '' AND btrim(coalesce(v_fact->>'value','')) <> '' THEN
        INSERT INTO public.customer_facts (user_id, customer_id, label, value)
        VALUES (p_user_id, v_project.customer_id, btrim(v_fact->>'label'), btrim(v_fact->>'value'));
        v_facts := v_facts + 1;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'moveId', v_move_id,
    'tasksChanged', v_tasks,
    'taskState', v_task_state,
    'notesMoved', v_notes,
    'filesMoved', v_files,
    'closeoutNoteId', v_note_id,
    'factsAdded', v_facts,
    'customerId', v_project.customer_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_project(
  p_project_id uuid,
  p_user_id    uuid,
  p_status     text DEFAULT 'Open'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_project public.projects;
  v_tasks int := 0;
  v_notes int := 0;
  v_files int := 0;
BEGIN
  SELECT * INTO v_project FROM public.projects
   WHERE id = p_project_id AND user_id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project % is not owned by user %', p_project_id, p_user_id
      USING ERRCODE = '42501';
  END IF;

  IF v_project.status NOT IN ('Completed', 'Cancelled') THEN
    RAISE EXCEPTION 'stale_state: project is not closed' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.projects
     SET status = p_status, completed_at = NULL, updated_at = now()
   WHERE id = p_project_id;

  IF v_project.status = 'Cancelled' THEN
    WITH restored AS (
      UPDATE public.tasks
         SET state = 'backlog', lifecycle_move_id = NULL,
             lifecycle_prev_state = NULL, updated_at = now()
       WHERE project_id = p_project_id AND user_id = p_user_id
         AND state = 'cancelled' AND lifecycle_move_id IS NOT NULL
      RETURNING id
    )
    SELECT count(*) INTO v_tasks FROM restored;
  END IF;

  WITH returned AS (
    UPDATE public.notes
       SET project_id = p_project_id, customer_id = NULL, origin_project_id = NULL,
           lifecycle_move_id = NULL, lifecycle_moved_at = NULL, context_label = NULL
     WHERE origin_project_id = p_project_id AND user_id = p_user_id
       AND lifecycle_move_id IS NOT NULL
    RETURNING id
  )
  SELECT count(*) INTO v_notes FROM returned;

  WITH returned AS (
    UPDATE public.attachments
       SET project_id = p_project_id, customer_id = NULL, origin_project_id = NULL,
           lifecycle_move_id = NULL, lifecycle_moved_at = NULL, context_label = NULL
     WHERE origin_project_id = p_project_id AND user_id = p_user_id
       AND lifecycle_move_id IS NOT NULL
    RETURNING id
  )
  SELECT count(*) INTO v_files FROM returned;

  RETURN jsonb_build_object(
    'tasksRestored', v_tasks, 'notesReturned', v_notes, 'filesReturned', v_files
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_project_preserving_content(
  p_project_id      uuid,
  p_user_id         uuid,
  p_destroy_content boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_project public.projects;
  v_notes int := 0;
  v_destroyed int := 0;
  v_files int := 0;
  v_tasks int := 0;
  v_label text;
BEGIN
  SELECT * INTO v_project FROM public.projects
   WHERE id = p_project_id AND user_id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project % is not owned by user %', p_project_id, p_user_id
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_tasks FROM public.tasks
   WHERE project_id = p_project_id AND user_id = p_user_id;

  v_label := 'From project: ' || v_project.name
             || ' (deleted ' || to_char(now() AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') || ')';

  IF p_destroy_content THEN
    WITH gone AS (
      DELETE FROM public.notes
       WHERE user_id = p_user_id
         AND (project_id = p_project_id OR origin_project_id = p_project_id)
      RETURNING id
    )
    SELECT count(*) INTO v_destroyed FROM gone;
  ELSE
    WITH kept AS (
      UPDATE public.notes
         SET customer_id = v_project.customer_id, project_id = NULL,
             origin_project_id = NULL, lifecycle_move_id = NULL,
             lifecycle_moved_at = NULL, context_label = v_label
       WHERE user_id = p_user_id
         AND (project_id = p_project_id OR origin_project_id = p_project_id)
      RETURNING id
    )
    SELECT count(*) INTO v_notes FROM kept;
  END IF;

  -- Files are NEVER destroyed with the project, even on the destroy-content
  -- opt-in. That option is about notes, and a file is worth more than the
  -- project it hung off. Deleting one is a separate, deliberate action on the
  -- file itself, which also has to remove the stored object.
  WITH kept AS (
    UPDATE public.attachments
       SET customer_id = v_project.customer_id, project_id = NULL,
           origin_project_id = NULL, lifecycle_move_id = NULL,
           lifecycle_moved_at = NULL, context_label = v_label
     WHERE user_id = p_user_id
       AND (project_id = p_project_id OR origin_project_id = p_project_id)
    RETURNING id
  )
  SELECT count(*) INTO v_files FROM kept;

  DELETE FROM public.projects WHERE id = p_project_id AND user_id = p_user_id;

  RETURN jsonb_build_object(
    'notesKept', v_notes, 'notesDestroyed', v_destroyed,
    'filesKept', v_files, 'tasksUnassigned', v_tasks,
    'movedToCustomerId', v_project.customer_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.close_project(uuid, uuid, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reopen_project(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_project_preserving_content(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;

COMMIT;
