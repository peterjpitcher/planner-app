-- ============================================================
-- Customers, Phase 2: the record, and nothing lost
-- ============================================================
--
-- Spec: docs/superpowers/specs/2026-09-01-customers-crm-design.md sections
-- 5.2, 5.3, 5.4, 5.9, 7.
--
-- Notes gain a customer parent, a real "when it happened" timestamp and
-- movement provenance. Facts and contacts arrive. Tasks gain cascade
-- provenance, which fixes a pre-existing reopen bug.
--
-- Requires 20260901000002_phase1_customers.sql.

BEGIN;

-- ------------------------------------------------------------
-- 1. customer_facts
-- ------------------------------------------------------------
--
-- A deliberately dumb label and value list. It gives arbitrary structured
-- fields (VAT number, portal URL, invoicing email, parking instructions)
-- without building a custom field engine.

CREATE TABLE IF NOT EXISTS public.customer_facts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  label       text NOT NULL,
  value       text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_facts_label_not_blank CHECK (length(btrim(label)) > 0),
  CONSTRAINT customer_facts_value_not_blank CHECK (length(btrim(value)) > 0),
  CONSTRAINT customer_facts_label_length CHECK (length(label) <= 80),
  CONSTRAINT customer_facts_value_length CHECK (length(value) <= 2000),
  CONSTRAINT customer_facts_customer_fkey
    FOREIGN KEY (customer_id, user_id)
    REFERENCES public.customers(id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS customer_facts_customer_idx
  ON public.customer_facts (customer_id, sort_order);

DROP TRIGGER IF EXISTS trg_customer_facts_updated_at ON public.customer_facts;
CREATE TRIGGER trg_customer_facts_updated_at
  BEFORE UPDATE ON public.customer_facts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.customer_facts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_facts_own ON public.customer_facts;
CREATE POLICY customer_facts_own ON public.customer_facts
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 2. contacts and project_contacts
-- ------------------------------------------------------------
--
-- Called contacts, not customer_contacts, because it has to serve projects that
-- have no customer. customer_id is therefore nullable: a contact can belong to
-- a customer, or stand alone.

CREATE TABLE IF NOT EXISTS public.contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id uuid,
  name        text NOT NULL,
  role        text,
  email       text,
  phone       text,
  notes       text,
  is_primary  boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contacts_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT contacts_name_length CHECK (length(name) <= 120),
  CONSTRAINT contacts_role_length CHECK (role IS NULL OR length(role) <= 120),
  CONSTRAINT contacts_email_length CHECK (email IS NULL OR length(email) <= 320),
  CONSTRAINT contacts_phone_length CHECK (phone IS NULL OR length(phone) <= 40),
  CONSTRAINT contacts_notes_length CHECK (notes IS NULL OR length(notes) <= 2000),
  -- SET NULL, not CASCADE: deleting a customer must not delete the people. They
  -- become standalone contacts and stay reachable through search and through
  -- any project they are linked to.
  CONSTRAINT contacts_customer_fkey
    FOREIGN KEY (customer_id, user_id)
    REFERENCES public.customers(id, user_id) ON DELETE SET NULL (customer_id)
);

ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_id_user_unique UNIQUE (id, user_id);

-- Deliberately NOT unique on the name. Two people at one company can share a
-- name, and a name is not an identity. The UI warns on a probable duplicate
-- (same name plus a matching email or phone) and offers a merge, rather than
-- SQL refusing to store a real person.
CREATE INDEX IF NOT EXISTS contacts_user_name_idx
  ON public.contacts (user_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS contacts_customer_idx
  ON public.contacts (customer_id) WHERE archived_at IS NULL;

-- The database, not the UI, guarantees at most one primary per customer.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_one_primary
  ON public.contacts (customer_id)
  WHERE is_primary AND archived_at IS NULL AND customer_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_contacts_updated_at ON public.contacts;
CREATE TRIGGER trg_contacts_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contacts_own ON public.contacts;
CREATE POLICY contacts_own ON public.contacts
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.project_contacts (
  project_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, contact_id),
  CONSTRAINT project_contacts_project_fkey
    FOREIGN KEY (project_id, user_id)
    REFERENCES public.projects(id, user_id) ON DELETE CASCADE,
  CONSTRAINT project_contacts_contact_fkey
    FOREIGN KEY (contact_id, user_id)
    REFERENCES public.contacts(id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS project_contacts_contact_idx
  ON public.project_contacts (contact_id);

ALTER TABLE public.project_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_contacts_own ON public.project_contacts;
CREATE POLICY project_contacts_own ON public.project_contacts
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 3. notes: expand
-- ------------------------------------------------------------
--
-- occurred_at and updated_at are NULLABLE at this point on purpose. See step 4.

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS customer_id        uuid,
  ADD COLUMN IF NOT EXISTS contact_id         uuid,
  ADD COLUMN IF NOT EXISTS origin_project_id  uuid,
  ADD COLUMN IF NOT EXISTS lifecycle_move_id  uuid,
  ADD COLUMN IF NOT EXISTS lifecycle_moved_at timestamptz,
  ADD COLUMN IF NOT EXISTS occurred_at        timestamptz,
  ADD COLUMN IF NOT EXISTS source             text NOT NULL DEFAULT 'note',
  ADD COLUMN IF NOT EXISTS pinned             boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS context_label      text,
  ADD COLUMN IF NOT EXISTS updated_at         timestamptz;

ALTER TABLE public.notes
  ADD CONSTRAINT notes_customer_fkey
  FOREIGN KEY (customer_id, user_id)
  REFERENCES public.customers(id, user_id) ON DELETE SET NULL (customer_id);

ALTER TABLE public.notes
  ADD CONSTRAINT notes_contact_fkey
  FOREIGN KEY (contact_id, user_id)
  REFERENCES public.contacts(id, user_id) ON DELETE SET NULL (contact_id);

ALTER TABLE public.notes
  ADD CONSTRAINT notes_origin_project_fkey
  FOREIGN KEY (origin_project_id, user_id)
  REFERENCES public.projects(id, user_id) ON DELETE SET NULL (origin_project_id);

ALTER TABLE public.notes
  ADD CONSTRAINT notes_source_check
  CHECK (source IN ('note','email','call','meeting','message','document','other'));

-- ------------------------------------------------------------
-- 4. notes: backfill and verify, then contract
-- ------------------------------------------------------------
--
-- Without this every existing note would claim to have happened at deployment
-- time, because the timeline sorts by occurred_at. There are real notes in this
-- database and their chronology is the whole point of the timeline.

UPDATE public.notes SET occurred_at = created_at WHERE occurred_at IS NULL;
UPDATE public.notes SET updated_at  = created_at WHERE updated_at  IS NULL;

DO $$
DECLARE bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM public.notes
   WHERE occurred_at IS NULL OR updated_at IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION 'occurred_at/updated_at backfill left % rows null', bad;
  END IF;
END $$;

ALTER TABLE public.notes
  ALTER COLUMN occurred_at SET DEFAULT now(),
  ALTER COLUMN occurred_at SET NOT NULL,
  ALTER COLUMN updated_at  SET DEFAULT now(),
  ALTER COLUMN updated_at  SET NOT NULL;

DROP TRIGGER IF EXISTS trg_notes_updated_at ON public.notes;
CREATE TRIGGER trg_notes_updated_at
  BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- 5. notes: parent rules
-- ------------------------------------------------------------
--
-- The counting form replaces the nested OR, which had already been rewritten
-- once when idea_id was added and becomes unreadable at five parents. It still
-- permits zero parents, which is what makes an unfiled note legal.

ALTER TABLE public.notes DROP CONSTRAINT IF EXISTS check_note_parent;
ALTER TABLE public.notes ADD CONSTRAINT check_note_parent CHECK (
  (CASE WHEN project_id  IS NOT NULL THEN 1 ELSE 0 END
 + CASE WHEN task_id     IS NOT NULL THEN 1 ELSE 0 END
 + CASE WHEN idea_id     IS NOT NULL THEN 1 ELSE 0 END
 + CASE WHEN customer_id IS NOT NULL THEN 1 ELSE 0 END) <= 1
);

-- notes.project_id was ON DELETE CASCADE, so deleting a project permanently
-- destroyed every note on it. projectLifecycleService re-parents explicitly
-- before the delete; this is the safety net, so even a raw database delete can
-- no longer lose them.
ALTER TABLE public.notes DROP CONSTRAINT IF EXISTS notes_project_id_fkey;
ALTER TABLE public.notes ADD CONSTRAINT notes_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS notes_customer_occurred_idx
  ON public.notes (customer_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS notes_origin_project_idx
  ON public.notes (origin_project_id) WHERE origin_project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notes_pinned_idx
  ON public.notes (customer_id) WHERE pinned;
CREATE INDEX IF NOT EXISTS notes_unfiled_idx
  ON public.notes (user_id, created_at DESC)
  WHERE project_id IS NULL AND task_id IS NULL
    AND idea_id IS NULL AND customer_id IS NULL;

-- ------------------------------------------------------------
-- 6. tasks: cascade provenance, and the reopen bug
-- ------------------------------------------------------------
--
-- Reopening a cancelled project currently restores EVERY cancelled task on it,
-- not only the ones the close cascade cancelled, because nothing records why a
-- task was cancelled. A task binned by hand two months before the project
-- closed comes back to the backlog on reopen. The comment in
-- projectLifecycleService already concedes the cause: "the original is not
-- recorded".

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS lifecycle_move_id    uuid,
  ADD COLUMN IF NOT EXISTS lifecycle_prev_state text;

CREATE INDEX IF NOT EXISTS tasks_lifecycle_move_idx
  ON public.tasks (lifecycle_move_id) WHERE lifecycle_move_id IS NOT NULL;

-- Projects closed before this shipped have no marker, so a strict reopen would
-- restore nothing, which is worse than today's behaviour. Stamping them keeps
-- existing data behaving exactly as it does now, and everything closed from
-- here on is correct. This inherits the old imprecision for those projects
-- because the information to do better was never recorded.
WITH closed AS (
  SELECT id, user_id, gen_random_uuid() AS move_id
    FROM public.projects
   WHERE status = 'Cancelled'
)
UPDATE public.tasks t
   SET lifecycle_move_id = c.move_id
  FROM closed c
 WHERE t.project_id = c.id
   AND t.user_id = c.user_id
   AND t.state = 'cancelled'
   AND t.lifecycle_move_id IS NULL;

COMMIT;
