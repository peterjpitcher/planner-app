-- ============================================================
-- Customers, Phase 1: atomic task-plus-customer creation
-- ============================================================
--
-- Spec: docs/superpowers/specs/2026-09-01-customers-crm-design.md sections 7.8, 9.3.
--
-- The @Name capture token can create a customer that does not exist yet. Doing
-- that as two client calls (POST /api/customers, then POST /api/tasks) leaves a
-- new empty customer behind every time the task insert fails, which is exactly
-- the half-done state this app avoids elsewhere.
--
-- One request is also not the same as one transaction. /today submits up to 25
-- lines with Promise.allSettled, in parallel, so two lines naming the same new
-- customer race on the unique index: one insert wins and the other fails its
-- whole task with a uniqueness error. ON CONFLICT DO NOTHING plus a re-select
-- turns that race into both lines resolving to the same row.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_task_with_customer(
  p_user_id       uuid,
  p_name          text,
  p_due_date      date,
  p_state         text DEFAULT 'backlog',
  p_project_id    uuid DEFAULT NULL,
  p_customer_id   uuid DEFAULT NULL,
  p_customer_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_customer_id      uuid := p_customer_id;
  v_created_customer boolean := false;
  v_normalised       text;
  v_task             public.tasks;
  v_customer         public.customers;
BEGIN
  IF p_user_id IS NULL OR p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'user and task name are both required' USING ERRCODE = '22023';
  END IF;

  -- A task on a project takes the project's customer: fn_task_customer_sync
  -- overwrites customer_id on write. Accepting both here would report a link
  -- the database immediately discards, so it is refused rather than ignored.
  IF p_project_id IS NOT NULL AND (p_customer_id IS NOT NULL OR p_customer_name IS NOT NULL) THEN
    RAISE EXCEPTION 'a task on a project takes the project customer' USING ERRCODE = '23514';
  END IF;

  IF p_project_id IS NOT NULL THEN
    PERFORM public.fn_assert_project_owner(p_project_id, p_user_id);
  END IF;

  IF p_customer_id IS NOT NULL THEN
    PERFORM public.fn_assert_customer_owner(p_customer_id, p_user_id);
  END IF;

  -- Resolve or create by name. Same normalisation as the unique index and as
  -- normaliseName() in validators.js, so all three agree on what "the same
  -- customer" means.
  IF v_customer_id IS NULL AND p_customer_name IS NOT NULL THEN
    v_normalised := btrim(regexp_replace(p_customer_name, '\s+', ' ', 'g'));

    IF v_normalised <> '' THEN
      SELECT * INTO v_customer
        FROM public.customers
       WHERE user_id = p_user_id
         AND lower(btrim(name)) = lower(v_normalised)
       LIMIT 1;

      IF NOT FOUND THEN
        INSERT INTO public.customers (user_id, name, status)
        VALUES (p_user_id, v_normalised, 'Active')
        ON CONFLICT (user_id, lower(btrim(name))) DO NOTHING
        RETURNING * INTO v_customer;

        IF v_customer.id IS NULL THEN
          -- Lost the race against a concurrent line naming the same customer.
          -- Both lines resolve to the winner rather than one of them failing.
          SELECT * INTO v_customer
            FROM public.customers
           WHERE user_id = p_user_id
             AND lower(btrim(name)) = lower(v_normalised)
           LIMIT 1;
        ELSE
          v_created_customer := true;
        END IF;
      END IF;

      -- Filing new work against an archived customer silently would defeat the
      -- point of archiving it, so the archive is lifted and reported back.
      IF v_customer.archived_at IS NOT NULL THEN
        UPDATE public.customers
           SET archived_at = NULL
         WHERE id = v_customer.id
        RETURNING * INTO v_customer;
      END IF;

      v_customer_id := v_customer.id;
    END IF;
  END IF;

  INSERT INTO public.tasks (user_id, name, due_date, state, project_id, customer_id)
  VALUES (
    p_user_id,
    btrim(p_name),
    p_due_date,
    coalesce(p_state, 'backlog'),
    p_project_id,
    v_customer_id
  )
  RETURNING * INTO v_task;

  RETURN jsonb_build_object(
    'task', to_jsonb(v_task),
    'customer', CASE WHEN v_customer.id IS NOT NULL THEN to_jsonb(v_customer) ELSE NULL END,
    'createdCustomer', v_created_customer
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_task_with_customer(uuid, text, date, text, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

COMMIT;
