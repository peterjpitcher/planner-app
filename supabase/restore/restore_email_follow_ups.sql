-- ============================================================
-- Restore public.email_follow_ups from public.email_follow_ups_archive
-- ============================================================
--
-- NOT a migration. Run by hand only if the retired table has to come back,
-- after migration 20260918105144_retire_email_follow_ups has archived and
-- dropped it:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/restore/restore_email_follow_ups.sql
--
-- What it does, in one transaction:
--   1. Recreates the table as 20260915000001_email_follow_ups.sql did: columns,
--      constraints, indexes (including the partial unique index), the
--      updated_at trigger, row-level security and the per-user policy.
--   2. Applies the live grants captured below, written out explicitly.
--   3. Copies the rows back from the archive. A row whose customer no longer
--      exists comes back with customer_id set to null. A row whose user no
--      longer exists is skipped, and its id is listed in a NOTICE.
-- The archive itself is left untouched.
--
-- It fails, changing nothing, if public.email_follow_ups already exists or the
-- archive is missing. Tested by supabase/__tests__/run-retire-email-follow-ups.sh,
-- which compares the restored catalogue and rows with the originals.
--
-- ------------------------------------------------------------
-- Live catalogue, captured 18 September 2026 (about 10:50 UTC) with read-only
-- queries against project hufxwovthhsjmtifvign (PostgreSQL 15.8), before the
-- retirement migration:
--
--   Rows: 84.
--   Owner: postgres. Row-level security: enabled, not forced. Replica identity:
--   default. No table comment.
--
--   Grants (pg_class.relacl):
--     {postgres=arwdDxt/postgres,authenticated=arwdDxt/postgres,service_role=arwdDxt/postgres}
--   information_schema.role_table_grants, all granted by postgres:
--     authenticated  DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE (not grantable)
--     service_role   DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE (not grantable)
--     postgres       all seven, grantable (owner)
--     anon, PUBLIC   nothing
--
--   Indexes (pg_indexes):
--     email_follow_ups_id_user_unique            CREATE UNIQUE INDEX ... USING btree (id, user_id)
--     email_follow_ups_pkey                      CREATE UNIQUE INDEX ... USING btree (id)
--     email_follow_ups_user_chase_idx            CREATE INDEX ... USING btree (user_id, next_chase_date) WHERE (state = 'awaiting_them'::text)
--     email_follow_ups_user_conversation_unique  CREATE UNIQUE INDEX ... USING btree (user_id, conversation_id) WHERE (conversation_id IS NOT NULL)
--     email_follow_ups_user_state_idx            CREATE INDEX ... USING btree (user_id, state) WHERE (state <> 'closed'::text)
--
--   Trigger (pg_trigger, NOT tgisinternal), enabled (O):
--     CREATE TRIGGER trg_email_follow_ups_updated_at BEFORE UPDATE ON public.email_follow_ups
--       FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
--
--   Policy (pg_policies):
--     email_follow_ups_own  PERMISSIVE  TO {authenticated}  FOR ALL
--       USING (auth.uid() = user_id)  WITH CHECK (auth.uid() = user_id)
--
--   Constraints (pg_constraint): the primary key on id; UNIQUE (id, user_id);
--   FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
--   FOREIGN KEY (customer_id, user_id) REFERENCES customers(id, user_id)
--   ON DELETE SET NULL (customer_id); and the 13 CHECK constraints below.
--
--   Columns: the 22 below, in this order, with these types, NOT NULL rules and
--   defaults.
--
-- supabase/__tests__/retire-email-follow-ups.sql holds the same capture as
-- data and asserts that the harness table matches it and that this restore
-- reproduces it exactly.
-- ------------------------------------------------------------

BEGIN;

SET LOCAL lock_timeout = '5s';

-- The archive must be there, and must not change while it is read.
LOCK TABLE public.email_follow_ups_archive IN SHARE MODE;

-- ------------------------------------------------------------
-- 1. Recreate the table as 20260915000001 did
-- ------------------------------------------------------------
--
-- No IF NOT EXISTS: if a table of this name exists, stop rather than insert
-- into something whose shape is unknown.

CREATE TABLE public.email_follow_ups (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mailbox            text NOT NULL DEFAULT 'orangejelly',
  conversation_id    text,
  message_id         text,
  counterpart_name   text,
  counterpart_email  text,
  subject            text,
  needs              text,
  state              text NOT NULL DEFAULT 'awaiting_me',
  last_message_at    timestamptz,
  last_message_from  text,
  proposed_draft     text,
  draft_status       text NOT NULL DEFAULT 'none',
  feedback           text,
  urgent             boolean NOT NULL DEFAULT false,
  next_chase_date    date,
  chase_count        integer NOT NULL DEFAULT 0,
  sent_at            timestamptz,
  customer_id        uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT email_follow_ups_mailbox_check
    CHECK (mailbox IN ('orangejelly', 'anchor')),
  CONSTRAINT email_follow_ups_state_check
    CHECK (state IN ('awaiting_me', 'awaiting_them', 'closed')),
  CONSTRAINT email_follow_ups_draft_status_check
    CHECK (draft_status IN ('none', 'ready', 'approved', 'edit_requested', 'hold', 'sent')),
  CONSTRAINT email_follow_ups_last_from_check
    CHECK (last_message_from IS NULL OR last_message_from IN ('me', 'them')),
  CONSTRAINT email_follow_ups_subject_length
    CHECK (subject IS NULL OR length(subject) <= 500),
  CONSTRAINT email_follow_ups_needs_length
    CHECK (needs IS NULL OR length(needs) <= 1000),
  CONSTRAINT email_follow_ups_draft_length
    CHECK (proposed_draft IS NULL OR length(proposed_draft) <= 20000),
  CONSTRAINT email_follow_ups_feedback_length
    CHECK (feedback IS NULL OR length(feedback) <= 5000),
  CONSTRAINT email_follow_ups_name_length
    CHECK (counterpart_name IS NULL OR length(counterpart_name) <= 200),
  CONSTRAINT email_follow_ups_email_length
    CHECK (counterpart_email IS NULL OR length(counterpart_email) <= 320),
  CONSTRAINT email_follow_ups_conversation_length
    CHECK (conversation_id IS NULL OR length(conversation_id) <= 500),
  CONSTRAINT email_follow_ups_message_length
    CHECK (message_id IS NULL OR length(message_id) <= 500),
  CONSTRAINT email_follow_ups_chase_count_nonneg
    CHECK (chase_count >= 0),

  CONSTRAINT email_follow_ups_customer_fkey
    FOREIGN KEY (customer_id, user_id)
    REFERENCES public.customers(id, user_id) ON DELETE SET NULL (customer_id)
);

ALTER TABLE public.email_follow_ups
  ADD CONSTRAINT email_follow_ups_id_user_unique UNIQUE (id, user_id);

CREATE UNIQUE INDEX email_follow_ups_user_conversation_unique
  ON public.email_follow_ups (user_id, conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX email_follow_ups_user_state_idx
  ON public.email_follow_ups (user_id, state)
  WHERE state <> 'closed';

CREATE INDEX email_follow_ups_user_chase_idx
  ON public.email_follow_ups (user_id, next_chase_date)
  WHERE state = 'awaiting_them';

CREATE TRIGGER trg_email_follow_ups_updated_at
  BEFORE UPDATE ON public.email_follow_ups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.email_follow_ups ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_follow_ups_own ON public.email_follow_ups
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 2. The live grants, written out
-- ------------------------------------------------------------
--
-- Start from nothing so the result does not depend on the schema's default
-- privileges at restore time, then grant exactly what live had.

REVOKE ALL ON public.email_follow_ups FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.email_follow_ups TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3. Copy the rows back
-- ------------------------------------------------------------

DO $$
DECLARE
  v_archived         bigint;
  v_restored         bigint;
  v_skipped          text;
  v_skipped_count    bigint;
  v_customer_cleared text;
BEGIN
  SELECT count(*) INTO v_archived FROM public.email_follow_ups_archive;

  SELECT string_agg(a.id::text, ', ' ORDER BY a.id), count(*)
    INTO v_skipped, v_skipped_count
    FROM public.email_follow_ups_archive a
   WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = a.user_id);

  SELECT string_agg(a.id::text, ', ' ORDER BY a.id)
    INTO v_customer_cleared
    FROM public.email_follow_ups_archive a
   WHERE a.customer_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = a.user_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.customers c
        WHERE c.id = a.customer_id AND c.user_id = a.user_id
     );

  -- Inserting fires no trigger (the only one is BEFORE UPDATE), so
  -- created_at and updated_at come back exactly as archived.
  INSERT INTO public.email_follow_ups (
    id, user_id, mailbox, conversation_id, message_id, counterpart_name,
    counterpart_email, subject, needs, state, last_message_at, last_message_from,
    proposed_draft, draft_status, feedback, urgent, next_chase_date, chase_count,
    sent_at, customer_id, created_at, updated_at
  )
  SELECT
    a.id, a.user_id, a.mailbox, a.conversation_id, a.message_id, a.counterpart_name,
    a.counterpart_email, a.subject, a.needs, a.state, a.last_message_at, a.last_message_from,
    a.proposed_draft, a.draft_status, a.feedback, a.urgent, a.next_chase_date, a.chase_count,
    a.sent_at,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM public.customers c
         WHERE c.id = a.customer_id AND c.user_id = a.user_id
      ) THEN a.customer_id
    END,
    a.created_at, a.updated_at
  FROM public.email_follow_ups_archive a
  WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = a.user_id);

  GET DIAGNOSTICS v_restored = ROW_COUNT;

  IF v_restored + v_skipped_count <> v_archived THEN
    RAISE EXCEPTION 'Restore stopped: % archived, % restored, % skipped do not add up',
      v_archived, v_restored, v_skipped_count;
  END IF;

  RAISE NOTICE 'Restored % of % archived email_follow_ups row(s)', v_restored, v_archived;

  IF v_skipped IS NOT NULL THEN
    RAISE NOTICE 'Skipped % row(s) whose user no longer exists: %', v_skipped_count, v_skipped;
  END IF;

  IF v_customer_cleared IS NOT NULL THEN
    RAISE NOTICE 'Restored with customer_id set to null, because the customer no longer exists: %', v_customer_cleared;
  END IF;
END $$;

COMMIT;
