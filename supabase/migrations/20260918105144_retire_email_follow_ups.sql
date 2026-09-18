-- ============================================================
-- Retire email_follow_ups: archive every row, prove the copy, drop the table
-- ============================================================
--
-- Spec: docs/superpowers/specs/2026-09-18-jordan-outlook-drafts-design.md, Part C (F12).
-- Plan: docs/superpowers/plans/2026-09-18-jordan-plan-c-archive-drop.md, Task C1.
--
-- Follow-ups left Planner in Part B: the page, the API routes and the inbox
-- worker bridge are gone, and Jordan drafts replies in Outlook instead. Nothing
-- reads or writes this table any more. Its rows are still the only record of
-- what was tracked, so they are copied into a locked-down archive, the copy is
-- proved, and only then is the live table dropped.
--
-- Run only after Part B is deployed and verified, and the bridge route returns
-- 404. Apply with `npx supabase db push` so live history records this version.
--
-- Everything here is one transaction. Any guard or check that fails raises an
-- error, the whole migration rolls back, and nothing changes.
--
-- Tested on a throwaway database by supabase/__tests__/run-retire-email-follow-ups.sh.
-- Restore path: supabase/restore/restore_email_follow_ups.sql.

BEGIN;

-- ------------------------------------------------------------
-- 1. Lock
-- ------------------------------------------------------------
--
-- Fail rather than queue behind a long transaction. ACCESS EXCLUSIVE stops any
-- write landing between the copy and the drop.

SET LOCAL lock_timeout = '5s';
LOCK TABLE public.email_follow_ups IN ACCESS EXCLUSIVE MODE;

-- ------------------------------------------------------------
-- 2. Guard: stop if anything still uses the table
-- ------------------------------------------------------------

DO $$
DECLARE
  v_table constant regclass := 'public.email_follow_ups'::regclass;
  v_hits  text;
BEGIN
  -- Function bodies are not tracked in pg_depend, so a plpgsql function that
  -- reads the table would only break at run time. Search every schema except
  -- the system catalogues.
  SELECT string_agg(
           format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
           ', ' ORDER BY n.nspname, p.proname)
    INTO v_hits
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND strpos(lower(p.prosrc), 'email_follow_ups') > 0;

  IF v_hits IS NOT NULL THEN
    RAISE EXCEPTION 'email_follow_ups retirement stopped: these functions still name the table: %', v_hits;
  END IF;

  -- Views, materialised views and rules (all stored in pg_rewrite), and
  -- policies on other tables, that depend on this table. Its own policy goes
  -- with it and is not counted.
  SELECT string_agg(dep, ', ' ORDER BY dep)
    INTO v_hits
    FROM (
      SELECT format('%s %I.%I',
                    CASE c.relkind
                      WHEN 'v' THEN 'view'
                      WHEN 'm' THEN 'materialised view'
                      ELSE format('rule %I on', r.rulename)
                    END,
                    cn.nspname, c.relname) AS dep
        FROM pg_depend d
        JOIN pg_rewrite r ON r.oid = d.objid
        JOIN pg_class c ON c.oid = r.ev_class
        JOIN pg_namespace cn ON cn.oid = c.relnamespace
       WHERE d.classid = 'pg_rewrite'::regclass
         AND d.refclassid = 'pg_class'::regclass
         AND d.refobjid = v_table
         AND r.ev_class <> v_table
      UNION
      SELECT format('policy %I on %I.%I', pol.polname, pn.nspname, pc.relname)
        FROM pg_depend d
        JOIN pg_policy pol ON pol.oid = d.objid
        JOIN pg_class pc ON pc.oid = pol.polrelid
        JOIN pg_namespace pn ON pn.oid = pc.relnamespace
       WHERE d.classid = 'pg_policy'::regclass
         AND d.refclassid = 'pg_class'::regclass
         AND d.refobjid = v_table
         AND pol.polrelid <> v_table
    ) deps;

  IF v_hits IS NOT NULL THEN
    RAISE EXCEPTION 'email_follow_ups retirement stopped: these objects depend on the table (pg_depend): %', v_hits;
  END IF;

  -- The updated_at trigger is expected and goes with the table. Anything else
  -- means something was added that this migration does not know about.
  SELECT string_agg(quote_ident(t.tgname), ', ' ORDER BY t.tgname)
    INTO v_hits
    FROM pg_trigger t
   WHERE t.tgrelid = v_table
     AND NOT t.tgisinternal
     AND t.tgname <> 'trg_email_follow_ups_updated_at';

  IF v_hits IS NOT NULL THEN
    RAISE EXCEPTION 'email_follow_ups retirement stopped: unexpected triggers on the table: %', v_hits;
  END IF;

  SELECT string_agg(format('%I on %I.%I', con.conname, n.nspname, c.relname), ', ' ORDER BY con.conname)
    INTO v_hits
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE con.contype = 'f'
     AND con.confrelid = v_table;

  IF v_hits IS NOT NULL THEN
    RAISE EXCEPTION 'email_follow_ups retirement stopped: foreign keys point to the table: %', v_hits;
  END IF;

  -- pg_publication_tables also expands FOR ALL TABLES and TABLES IN SCHEMA.
  SELECT string_agg(quote_ident(pt.pubname), ', ' ORDER BY pt.pubname)
    INTO v_hits
    FROM pg_publication_tables pt
   WHERE pt.schemaname = 'public'
     AND pt.tablename = 'email_follow_ups';

  IF v_hits IS NOT NULL THEN
    RAISE EXCEPTION 'email_follow_ups retirement stopped: the table is in these publications: %', v_hits;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. Create the archive
-- ------------------------------------------------------------
--
-- Deliberately no IF NOT EXISTS: if an archive is already there, this fails
-- and nothing changes, rather than mixing two snapshots in one table.
--
-- All 22 source columns with the same types and NOT NULL rules, plus
-- archived_at. No foreign keys and no defaults besides archived_at: it is an
-- independent snapshot that keeps user_id and customer_id as plain values, so
-- deleting a user or customer later cannot remove or alter an archived row.

CREATE TABLE public.email_follow_ups_archive (
  id                 uuid PRIMARY KEY,
  user_id            uuid NOT NULL,
  mailbox            text NOT NULL,
  conversation_id    text,
  message_id         text,
  counterpart_name   text,
  counterpart_email  text,
  subject            text,
  needs              text,
  state              text NOT NULL,
  last_message_at    timestamptz,
  last_message_from  text,
  proposed_draft     text,
  draft_status       text NOT NULL,
  feedback           text,
  urgent             boolean NOT NULL,
  next_chase_date    date,
  chase_count        integer NOT NULL,
  sent_at            timestamptz,
  customer_id        uuid,
  created_at         timestamptz NOT NULL,
  updated_at         timestamptz NOT NULL,
  archived_at        timestamptz NOT NULL DEFAULT now()
);

-- The comment carries the real date the snapshot was taken.
DO $$
BEGIN
  EXECUTE format(
    'COMMENT ON TABLE public.email_follow_ups_archive IS %L',
    format(
      'Snapshot of every row of public.email_follow_ups, taken on %s (UTC) by migration '
      '20260918105144_retire_email_follow_ups just before that table was dropped. '
      'No foreign keys: user_id and customer_id are plain values. '
      'Restore with supabase/restore/restore_email_follow_ups.sql.',
      to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')));
END $$;

-- If the live table has a column this archive does not copy (or a different
-- type or NOT NULL rule), stop: the copy below names its columns, so a new
-- column would otherwise be lost without an error.
DO $$
DECLARE
  v_diff text;
BEGIN
  WITH src AS (
    SELECT a.attname::text AS col, format_type(a.atttypid, a.atttypmod) AS typ, a.attnotnull
      FROM pg_attribute a
     WHERE a.attrelid = 'public.email_follow_ups'::regclass
       AND a.attnum > 0 AND NOT a.attisdropped
  ), arc AS (
    SELECT a.attname::text AS col, format_type(a.atttypid, a.atttypmod) AS typ, a.attnotnull
      FROM pg_attribute a
     WHERE a.attrelid = 'public.email_follow_ups_archive'::regclass
       AND a.attnum > 0 AND NOT a.attisdropped
       AND a.attname <> 'archived_at'
  )
  SELECT string_agg(format('%s %s %s notnull=%s', side, col, typ, attnotnull), '; ' ORDER BY col, side)
    INTO v_diff
    FROM (
      (SELECT 'source only:' AS side, * FROM (SELECT * FROM src EXCEPT SELECT * FROM arc) s)
      UNION ALL
      (SELECT 'archive only:', * FROM (SELECT * FROM arc EXCEPT SELECT * FROM src) a)
    ) d;

  IF v_diff IS NOT NULL THEN
    RAISE EXCEPTION 'email_follow_ups retirement stopped: archive columns do not match the table: %', v_diff;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4. Lock the archive down
-- ------------------------------------------------------------
--
-- Row-level security with no policies, and only service_role may read it.
-- The explicit REVOKE removes whatever the schema's default privileges granted
-- at CREATE time (on live: every privilege to authenticated and service_role).

ALTER TABLE public.email_follow_ups_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_follow_ups_archive FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.email_follow_ups_archive TO service_role;

DO $$
DECLARE
  v_grants text;
BEGIN
  -- Every grant except the owner's own, which ownership implies anyway.
  SELECT string_agg(grant_text, ', ' ORDER BY grant_text)
    INTO v_grants
    FROM (
      SELECT format('%s:%s',
                    CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(g.grantee) END,
                    g.privilege_type) AS grant_text
        FROM pg_class c,
             aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
       WHERE c.oid = 'public.email_follow_ups_archive'::regclass
         AND g.grantee <> c.relowner
    ) grants;

  IF v_grants IS DISTINCT FROM 'service_role:SELECT' THEN
    RAISE EXCEPTION 'email_follow_ups retirement stopped: archive grants are %, expected service_role:SELECT only', v_grants;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 5. Copy every row, and prove the copy
-- ------------------------------------------------------------

INSERT INTO public.email_follow_ups_archive (
  id, user_id, mailbox, conversation_id, message_id, counterpart_name,
  counterpart_email, subject, needs, state, last_message_at, last_message_from,
  proposed_draft, draft_status, feedback, urgent, next_chase_date, chase_count,
  sent_at, customer_id, created_at, updated_at
)
SELECT
  id, user_id, mailbox, conversation_id, message_id, counterpart_name,
  counterpart_email, subject, needs, state, last_message_at, last_message_from,
  proposed_draft, draft_status, feedback, urgent, next_chase_date, chase_count,
  sent_at, customer_id, created_at, updated_at
FROM public.email_follow_ups;

DO $$
DECLARE
  v_source  bigint;
  v_archive bigint;
  v_missing bigint;
  v_extra   bigint;
BEGIN
  SELECT count(*) INTO v_source FROM public.email_follow_ups;
  SELECT count(*) INTO v_archive FROM public.email_follow_ups_archive;

  IF v_source <> v_archive THEN
    RAISE EXCEPTION 'email_follow_ups retirement stopped: % source rows but % archived', v_source, v_archive;
  END IF;

  -- EXCEPT ALL compares every column, treats two NULLs as equal and counts
  -- duplicates, so a row that is missing, altered or doubled shows up here.
  SELECT count(*) INTO v_missing FROM (
    SELECT id, user_id, mailbox, conversation_id, message_id, counterpart_name,
           counterpart_email, subject, needs, state, last_message_at, last_message_from,
           proposed_draft, draft_status, feedback, urgent, next_chase_date, chase_count,
           sent_at, customer_id, created_at, updated_at
      FROM public.email_follow_ups
    EXCEPT ALL
    SELECT id, user_id, mailbox, conversation_id, message_id, counterpart_name,
           counterpart_email, subject, needs, state, last_message_at, last_message_from,
           proposed_draft, draft_status, feedback, urgent, next_chase_date, chase_count,
           sent_at, customer_id, created_at, updated_at
      FROM public.email_follow_ups_archive
  ) d;

  SELECT count(*) INTO v_extra FROM (
    SELECT id, user_id, mailbox, conversation_id, message_id, counterpart_name,
           counterpart_email, subject, needs, state, last_message_at, last_message_from,
           proposed_draft, draft_status, feedback, urgent, next_chase_date, chase_count,
           sent_at, customer_id, created_at, updated_at
      FROM public.email_follow_ups_archive
    EXCEPT ALL
    SELECT id, user_id, mailbox, conversation_id, message_id, counterpart_name,
           counterpart_email, subject, needs, state, last_message_at, last_message_from,
           proposed_draft, draft_status, feedback, urgent, next_chase_date, chase_count,
           sent_at, customer_id, created_at, updated_at
      FROM public.email_follow_ups
  ) d;

  IF v_missing <> 0 OR v_extra <> 0 THEN
    RAISE EXCEPTION 'email_follow_ups retirement stopped: % source row(s) not in the archive, % archive row(s) not in the source',
      v_missing, v_extra;
  END IF;

  RAISE NOTICE 'Archived % email_follow_ups row(s); every column matches in both directions', v_archive;
END $$;

-- ------------------------------------------------------------
-- 6. Drop the live table
-- ------------------------------------------------------------
--
-- No CASCADE: anything the guards above did not anticipate makes this fail
-- and roll everything back. The table's trigger, indexes and policy go with
-- it. The shared update_updated_at_column() function stays; other tables use it.

DROP TABLE public.email_follow_ups;

COMMIT;
