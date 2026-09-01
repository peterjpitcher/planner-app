-- ============================================================
-- Customers, Phase 4: search, reporting attribution, and the drop
-- ============================================================
--
-- Spec: docs/superpowers/specs/2026-09-01-customers-crm-design.md sections
-- 5.6, 5.3c, 10.3.
--
-- Requires 20260901000006_phase3_attachments.sql.

BEGIN;

-- ------------------------------------------------------------
-- 1. Search
-- ------------------------------------------------------------
--
-- Full text alone is not enough, and shipping only that would produce a search
-- box that looks broken. Postgres tokenises joe.bloggs@acme-group.co.uk and
-- +44 7700 900123 in ways that defeat the searches you would actually type, and
-- it cannot do partial names or near misses at all.
--
-- So: full text for note bodies and customer summaries, trigram for names and
-- fact values, and normalised exact matching for emails and phone numbers.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Generated, not maintained by a trigger, so the index can never drift from the
-- content it indexes.
ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS notes_content_tsv_idx
  ON public.notes USING GIN (content_tsv);

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(name, '') || ' ' || coalesce(summary, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS customers_search_tsv_idx
  ON public.customers USING GIN (search_tsv);

-- Trigram is what makes a partial name work, and it is also what powers the
-- "did you mean Acme?" hint on the @ capture token, which previously had no
-- implementation behind it at all.
CREATE INDEX IF NOT EXISTS customers_name_trgm_idx
  ON public.customers USING GIN (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS contacts_name_trgm_idx
  ON public.contacts USING GIN (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customer_facts_value_trgm_idx
  ON public.customer_facts USING GIN (lower(value) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customer_facts_label_trgm_idx
  ON public.customer_facts USING GIN (lower(label) gin_trgm_ops);

-- Emails and phones are matched exactly on a normalised form rather than
-- tokenised: you search for a whole address or a whole number, never half of one.
CREATE INDEX IF NOT EXISTS contacts_email_idx
  ON public.contacts (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_phone_digits_idx
  ON public.contacts (regexp_replace(coalesce(phone, ''), '\D', '', 'g'))
  WHERE phone IS NOT NULL;

-- ------------------------------------------------------------
-- 2. Completion attribution
-- ------------------------------------------------------------
--
-- "What did I do for them last month" cannot be answered from the current
-- tasks.customer_id, because that column moves. Reassigning a project's
-- customer repoints every task on it, including ones completed months ago
-- under the old customer, and deleting a customer nulls it entirely. Last
-- month's report would give a different answer this month, which makes it
-- useless for the one thing it is for.
--
-- So attribution is snapshotted at the moment work finishes.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS completed_customer_id   uuid,
  ADD COLUMN IF NOT EXISTS completed_customer_name text;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS completed_customer_id   uuid,
  ADD COLUMN IF NOT EXISTS completed_customer_name text;

CREATE INDEX IF NOT EXISTS tasks_completed_customer_idx
  ON public.tasks (completed_customer_id, completed_at DESC)
  WHERE completed_customer_id IS NOT NULL;

-- completed_customer_name is a plain text copy on purpose. It is what keeps a
-- historical report readable after the customer is deleted, where the foreign
-- key goes null. Renaming a customer leaves old reports showing the name you
-- used at the time, which is correct for a record of what happened.
--
-- Stamped by fn_task_state_cleanup, the same trigger that already owns
-- completed_at, cancelled_at and entered_state_at. Never written by app code.
--
-- The SET clause is restated inside the definition deliberately: CREATE OR
-- REPLACE resets every property not restated, and this function lost its
-- hardened search_path exactly that way twice before (see 20260813113504).

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

-- Deliberately NOT backfilled. Attribution starts the day this ships: for work
-- completed before it, the information to say who it was for does not exist,
-- and inventing it from the current customer would be guessing dressed as
-- history. Those tasks report as "Unattributed".

COMMIT;
