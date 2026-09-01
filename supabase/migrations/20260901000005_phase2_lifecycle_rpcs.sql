-- ============================================================
-- Customers, Phase 2: lifecycle RPCs
-- ============================================================
--
-- Spec: docs/superpowers/specs/2026-09-01-customers-crm-design.md section 7.
--
-- Closing a project changes the project, its tasks, its notes, a close-out note
-- and possibly some facts. Separate .update()/.insert() calls through the
-- Supabase client are separate PostgREST requests and therefore separate
-- transactions, so a JavaScript service cannot make that atomic. Each operation
-- is one function here instead.
--
-- Every function: SECURITY DEFINER, search_path pinned, takes p_user_id and
-- verifies it internally (the caller is the service role, so RLS gives no
-- protection), locks the target row so concurrent submissions serialise, and
-- has EXECUTE revoked from public, anon and authenticated.
--
-- Requires 20260901000004_phase2_record.sql.

BEGIN;

-- ------------------------------------------------------------
-- close_project
-- ------------------------------------------------------------

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
  v_project     public.projects;
  v_move_id     uuid := gen_random_uuid();
  v_task_state  text;
  v_tasks       int := 0;
  v_notes       int := 0;
  v_facts       int := 0;
  v_note_id     uuid;
  v_fact        jsonb;
BEGIN
  IF p_status NOT IN ('Completed', 'Cancelled') THEN
    RAISE EXCEPTION 'close_project only handles Completed and Cancelled'
      USING ERRCODE = '22023';
  END IF;

  -- FOR UPDATE so a double-submitted modal serialises rather than interleaving
  -- and producing two close-out notes.
  SELECT * INTO v_project FROM public.projects
   WHERE id = p_project_id AND user_id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project % is not owned by user %', p_project_id, p_user_id
      USING ERRCODE = '42501';
  END IF;

  IF v_project.status = p_status THEN
    -- Already there. Idempotent rather than an error, so a retried request is
    -- harmless.
    RETURN jsonb_build_object('alreadyClosed', true, 'tasksChanged', 0, 'notesMoved', 0);
  END IF;

  v_task_state := CASE WHEN p_status = 'Completed' THEN 'done' ELSE 'cancelled' END;

  UPDATE public.projects
     SET status = p_status, updated_at = now()
   WHERE id = p_project_id;

  -- Tasks. lifecycle_move_id and lifecycle_prev_state are what make the reopen
  -- correct: without them it restores every cancelled task on the project, not
  -- just the ones this close cancelled.
  WITH moved AS (
    UPDATE public.tasks
       SET state = v_task_state,
           lifecycle_move_id = v_move_id,
           lifecycle_prev_state = state,
           updated_at = now()
     WHERE project_id = p_project_id
       AND user_id = p_user_id
       AND state IN ('today', 'this_week', 'backlog', 'waiting')
    RETURNING id
  )
  SELECT count(*) INTO v_tasks FROM moved;

  -- Notes move onto the customer's record, stamped so the move is reversible.
  IF v_project.customer_id IS NOT NULL THEN
    WITH moved AS (
      UPDATE public.notes
         SET customer_id = v_project.customer_id,
             project_id = NULL,
             origin_project_id = p_project_id,
             lifecycle_move_id = v_move_id,
             lifecycle_moved_at = now(),
             context_label = 'From project: ' || v_project.name
       WHERE project_id = p_project_id
         AND user_id = p_user_id
      RETURNING id
    )
    SELECT count(*) INTO v_notes FROM moved;
  END IF;

  -- Close-out note. Lands on the customer when there is one, on the project
  -- otherwise, so the prompt is never a dead end.
  IF p_closeout_note IS NOT NULL AND btrim(p_closeout_note) <> '' THEN
    INSERT INTO public.notes (
      user_id, customer_id, project_id, content, source, pinned,
      occurred_at, context_label
    )
    VALUES (
      p_user_id,
      v_project.customer_id,
      CASE WHEN v_project.customer_id IS NULL THEN p_project_id ELSE NULL END,
      btrim(p_closeout_note),
      'note',
      true,
      now(),
      'Close-out: ' || v_project.name
    )
    RETURNING id INTO v_note_id;
  END IF;

  -- Key facts, only meaningful with a customer.
  IF p_facts IS NOT NULL AND v_project.customer_id IS NOT NULL THEN
    FOR v_fact IN SELECT * FROM jsonb_array_elements(p_facts) LOOP
      IF btrim(coalesce(v_fact->>'label','')) <> ''
         AND btrim(coalesce(v_fact->>'value','')) <> '' THEN
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
    'closeoutNoteId', v_note_id,
    'factsAdded', v_facts,
    'customerId', v_project.customer_id
  );
END;
$$;

-- ------------------------------------------------------------
-- reopen_project
-- ------------------------------------------------------------

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
  v_tasks   int := 0;
  v_notes   int := 0;
BEGIN
  SELECT * INTO v_project FROM public.projects
   WHERE id = p_project_id AND user_id = p_user_id
     FOR UPDATE;

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

  -- Only the tasks THIS close cancelled. The condition on lifecycle_move_id is
  -- the fix for a live bug: the old code matched on state alone, so a task
  -- cancelled by hand before the project closed was revived on reopen.
  IF v_project.status = 'Cancelled' THEN
    WITH restored AS (
      UPDATE public.tasks
         SET state = 'backlog',
             lifecycle_move_id = NULL,
             lifecycle_prev_state = NULL,
             updated_at = now()
       WHERE project_id = p_project_id
         AND user_id = p_user_id
         AND state = 'cancelled'
         AND lifecycle_move_id IS NOT NULL
      RETURNING id
    )
    SELECT count(*) INTO v_tasks FROM restored;
  END IF;

  -- Notes come back to the project. The condition is lifecycle_move_id IS NOT
  -- NULL, not a match on customer_id: any user edit or re-file clears the
  -- marker, so a note deliberately moved elsewhere while the project was closed
  -- is left where you put it.
  WITH returned AS (
    UPDATE public.notes
       SET project_id = p_project_id,
           customer_id = NULL,
           origin_project_id = NULL,
           lifecycle_move_id = NULL,
           lifecycle_moved_at = NULL,
           context_label = NULL
     WHERE origin_project_id = p_project_id
       AND user_id = p_user_id
       AND lifecycle_move_id IS NOT NULL
    RETURNING id
  )
  SELECT count(*) INTO v_notes FROM returned;

  RETURN jsonb_build_object('tasksRestored', v_tasks, 'notesReturned', v_notes);
END;
$$;

-- ------------------------------------------------------------
-- delete_project_preserving_content
-- ------------------------------------------------------------

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
  v_project   public.projects;
  v_notes     int := 0;
  v_destroyed int := 0;
  v_tasks     int := 0;
  v_label     text;
BEGIN
  SELECT * INTO v_project FROM public.projects
   WHERE id = p_project_id AND user_id = p_user_id
     FOR UPDATE;

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
    -- Rows that moved at close time already carry a label with no deletion
    -- date, and ON DELETE SET NULL cannot update a text column, so they are
    -- rewritten here. Without this the note silently loses the fact that its
    -- project was deleted, which is exactly what the tombstone exists for.
    WITH kept AS (
      UPDATE public.notes
         SET customer_id = v_project.customer_id,
             project_id = NULL,
             origin_project_id = NULL,
             lifecycle_move_id = NULL,
             lifecycle_moved_at = NULL,
             context_label = v_label
       WHERE user_id = p_user_id
         AND (project_id = p_project_id OR origin_project_id = p_project_id)
      RETURNING id
    )
    SELECT count(*) INTO v_notes FROM kept;
  END IF;

  DELETE FROM public.projects WHERE id = p_project_id AND user_id = p_user_id;

  RETURN jsonb_build_object(
    'notesKept', v_notes,
    'notesDestroyed', v_destroyed,
    'tasksUnassigned', v_tasks,
    'movedToCustomerId', v_project.customer_id
  );
END;
$$;

-- ------------------------------------------------------------
-- delete_customer_preserving_content
-- ------------------------------------------------------------
--
-- Removes the customer record. It does not erase everything visible on their
-- page: that page is a roll-up, and work belonging to a project stays with the
-- project. Only rows whose own customer_id points here are touched.

CREATE OR REPLACE FUNCTION public.delete_customer_preserving_content(
  p_customer_id uuid,
  p_user_id     uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_customer public.customers;
  v_notes    int := 0;
  v_contacts int := 0;
  v_facts    int := 0;
  v_projects int := 0;
  v_tasks    int := 0;
BEGIN
  SELECT * INTO v_customer FROM public.customers
   WHERE id = p_customer_id AND user_id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer % is not owned by user %', p_customer_id, p_user_id
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_projects FROM public.projects
   WHERE customer_id = p_customer_id AND user_id = p_user_id;
  SELECT count(*) INTO v_tasks FROM public.tasks
   WHERE customer_id = p_customer_id AND user_id = p_user_id;

  -- Notes filed directly on the customer become unfiled, with a tombstone.
  -- Notes on their projects are not touched: they belong to the project.
  WITH unfiled AS (
    UPDATE public.notes
       SET customer_id = NULL,
           context_label = 'From customer: ' || v_customer.name || ' (removed)'
     WHERE customer_id = p_customer_id AND user_id = p_user_id
    RETURNING id
  )
  SELECT count(*) INTO v_notes FROM unfiled;

  -- Contacts become standalone rather than being deleted with the company.
  WITH standalone AS (
    UPDATE public.contacts
       SET customer_id = NULL, is_primary = false
     WHERE customer_id = p_customer_id AND user_id = p_user_id
    RETURNING id
  )
  SELECT count(*) INTO v_contacts FROM standalone;

  SELECT count(*) INTO v_facts FROM public.customer_facts
   WHERE customer_id = p_customer_id AND user_id = p_user_id;

  -- Facts are the one thing destroyed: a fact has no meaning without its
  -- customer. The impact preview says so before the button is live.
  DELETE FROM public.customers WHERE id = p_customer_id AND user_id = p_user_id;

  RETURN jsonb_build_object(
    'notesUnfiled', v_notes,
    'contactsFreed', v_contacts,
    'factsDestroyed', v_facts,
    'projectsUnassigned', v_projects,
    'tasksUnassigned', v_tasks
  );
END;
$$;

-- ------------------------------------------------------------
-- set_primary_contact
-- ------------------------------------------------------------
--
-- Two client PATCH calls would transiently violate contacts_one_primary. Clear
-- and set in one transaction instead.

CREATE OR REPLACE FUNCTION public.set_primary_contact(
  p_customer_id uuid,
  p_contact_id  uuid,
  p_user_id     uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_contact public.contacts;
BEGIN
  PERFORM public.fn_assert_customer_owner(p_customer_id, p_user_id);

  SELECT * INTO v_contact FROM public.contacts
   WHERE id = p_contact_id AND user_id = p_user_id AND customer_id = p_customer_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'contact % is not on customer %', p_contact_id, p_customer_id
      USING ERRCODE = '42501';
  END IF;

  IF v_contact.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'an archived contact cannot be primary' USING ERRCODE = '23514';
  END IF;

  UPDATE public.contacts SET is_primary = false
   WHERE customer_id = p_customer_id AND user_id = p_user_id AND is_primary;

  UPDATE public.contacts SET is_primary = true WHERE id = p_contact_id;

  RETURN jsonb_build_object('contactId', p_contact_id);
END;
$$;

-- ------------------------------------------------------------
-- Grants
-- ------------------------------------------------------------
--
-- These bypass RLS by design and take p_user_id, so an exposed one would be a
-- full data breach rather than an inconvenience.

REVOKE EXECUTE ON FUNCTION public.close_project(uuid, uuid, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reopen_project(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_project_preserving_content(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_customer_preserving_content(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_primary_contact(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

COMMIT;
