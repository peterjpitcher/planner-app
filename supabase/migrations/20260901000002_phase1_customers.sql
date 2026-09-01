-- ============================================================
-- Customers, Phase 1: the customer record and its links
-- ============================================================
--
-- Spec: docs/superpowers/specs/2026-09-01-customers-crm-design.md sections 5.1, 5.4, 5.7.
--
-- Adds the customers table, links projects and tasks to it, and adds the two
-- triggers that keep tasks.customer_id honest.
--
-- Requires 20260901000001_phase0_foundations.sql (the ownership guard pattern).

BEGIN;

-- ------------------------------------------------------------
-- 1. customers
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.customers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  status      text NOT NULL DEFAULT 'Active',
  area        text,
  website     text,
  summary     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT customers_status_check
    CHECK (status IN ('Active', 'Prospect', 'Dormant', 'Former')),
  CONSTRAINT customers_name_not_blank
    CHECK (length(btrim(name)) > 0),
  CONSTRAINT customers_name_length
    CHECK (length(btrim(name)) <= 120)
);

-- Case-insensitive and whitespace-trimmed, so "Acme", "acme " and "ACME" cannot
-- become three customers. This is also what makes the @customer capture token
-- safe to resolve to a single row.
--
-- Deliberately NOT filtered by archived_at: an archived customer still holds its
-- name. Allowing a new customer with an archived one's name would produce two
-- records that look identical the moment the old one is restored.
CREATE UNIQUE INDEX IF NOT EXISTS customers_user_name_unique
  ON public.customers (user_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS customers_user_status_idx
  ON public.customers (user_id, status) WHERE archived_at IS NULL;

DROP TRIGGER IF EXISTS trg_customers_updated_at ON public.customers;
CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

-- Per-user only. Explicitly NOT the USING (true) pattern that projects and tasks
-- carried until Phase 0: permissive policies OR together, so one of those makes
-- every other policy on the table pointless.
DROP POLICY IF EXISTS customers_own ON public.customers;
CREATE POLICY customers_own ON public.customers
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 2. Same-owner keys
-- ------------------------------------------------------------
--
-- A plain foreign key only points at an id, so nothing in the database stops a
-- row owned by one user referencing a customer owned by another. Every route
-- uses the service-role client, which bypasses RLS, so RLS is not a backstop
-- either. These composite keys make the wrong link impossible rather than
-- merely unlikely.
--
-- id is already unique via the primary key; the composite unique index exists
-- only so (x, user_id) can be the target of a foreign key.

ALTER TABLE public.customers
  ADD CONSTRAINT customers_id_user_unique UNIQUE (id, user_id);
ALTER TABLE public.projects
  ADD CONSTRAINT projects_id_user_unique UNIQUE (id, user_id);
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_id_user_unique UNIQUE (id, user_id);

-- ------------------------------------------------------------
-- 3. projects.customer_id
-- ------------------------------------------------------------

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS customer_id uuid;

-- ON DELETE SET NULL (customer_id) names the column explicitly. Without the
-- column list, deleting a customer would try to null user_id as well, which is
-- NOT NULL, so every customer delete would fail. The column-list form needs
-- PostgreSQL 15; this project is on 15.8.
--
-- Deleting a customer must never destroy a project, which is why this is SET
-- NULL rather than CASCADE. It matches tasks.project_id, set the same way in
-- 20260404000001.
ALTER TABLE public.projects
  ADD CONSTRAINT projects_customer_fkey
  FOREIGN KEY (customer_id, user_id)
  REFERENCES public.customers(id, user_id)
  ON DELETE SET NULL (customer_id);

CREATE INDEX IF NOT EXISTS projects_customer_idx
  ON public.projects (customer_id) WHERE customer_id IS NOT NULL;

-- ------------------------------------------------------------
-- 4. tasks.customer_id
-- ------------------------------------------------------------
--
-- Needed because tasks can exist with no project (project_id is nullable since
-- 20260404000001), and "chase Acme for the signed contract" is a real customer
-- task with no project behind it.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS customer_id uuid;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_customer_fkey
  FOREIGN KEY (customer_id, user_id)
  REFERENCES public.customers(id, user_id)
  ON DELETE SET NULL (customer_id);

CREATE INDEX IF NOT EXISTS tasks_customer_state_idx
  ON public.tasks (customer_id, state) WHERE customer_id IS NOT NULL;

-- ------------------------------------------------------------
-- 5. The ownership rule for tasks.customer_id
-- ------------------------------------------------------------
--
-- tasks.customer_id is application-writable ONLY when project_id IS NULL. When a
-- task has a project, the project owns the answer and this trigger overwrites
-- whatever the application sent. Same contract as completed_at and
-- cancelled_at, which fn_task_state_cleanup owns.
--
-- POST /api/tasks rejects a request carrying both project_id and customer_id
-- with a 400, rather than letting the trigger silently discard one of them. The
-- interface should not report something the database undoes on write.

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

DROP TRIGGER IF EXISTS trg_task_customer_sync ON public.tasks;
CREATE TRIGGER trg_task_customer_sync
  BEFORE INSERT OR UPDATE OF project_id, customer_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.fn_task_customer_sync();

-- Deliberate consequence: when a project is deleted, tasks.project_id becomes
-- null via its own ON DELETE SET NULL. This trigger only writes customer_id
-- when project_id IS NOT NULL, so the task keeps the customer it already had.
-- It survives as unassigned but still attached to the customer, which is what
-- we want and what the tests assert.

-- ------------------------------------------------------------
-- 6. Changing a project's customer repoints its tasks
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_project_customer_cascade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    UPDATE public.tasks
       SET customer_id = NEW.customer_id
     WHERE project_id = NEW.id
       AND user_id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_project_customer_cascade ON public.projects;
CREATE TRIGGER trg_project_customer_cascade
  AFTER UPDATE OF customer_id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.fn_project_customer_cascade();

-- ------------------------------------------------------------
-- 7. Ownership guard for the customer RPCs
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_assert_customer_owner(
  p_customer_id uuid,
  p_user_id     uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_customer_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'customer and user are both required'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.customers
     WHERE id = p_customer_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'customer % is not owned by user %', p_customer_id, p_user_id
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_assert_customer_owner(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

COMMIT;
