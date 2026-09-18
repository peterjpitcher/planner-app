-- Test for supabase/migrations/20260918105144_retire_email_follow_ups.sql and
-- supabase/restore/restore_email_follow_ups.sql.
--
-- Run it through supabase/__tests__/run-retire-email-follow-ups.sh, which
-- creates a throwaway database, passes the three SQL file paths in as psql
-- variables (create_sql, retire_sql, restore_sql) and always drops the
-- database afterwards. The migration and the restore carry their own BEGIN and
-- COMMIT, so this test cannot wrap itself in one rolled-back transaction the
-- way workflow-repairs.sql does. All data is synthetic.
--
-- Covered:
--   1. Live default privileges reproduced; auth.users, auth.uid(), customers
--      and update_updated_at_column() stubbed as live has them.
--   2. 20260915000001 applied, synthetic rows covering every column and every
--      allowed value, with nulls; the resulting table matches the live
--      catalogue captured on 18 September.
--   3. Negative tests, each run in a separate session that must fail with
--      nothing changed: a view on the table, a plpgsql function reading it,
--      an archive table that already exists, and a column the archive would
--      not copy.
--   4. The retirement: archive equal to the originals, exact grants (also
--      checked by acting as each role), source gone, shared function kept.
--   5. The restore: catalogue and rows equal to the originals, archive
--      untouched; then again with a deleted customer and a deleted user.
--
-- Helper functions live in schema harness. None of them may contain the
-- table's name in its source, or the migration's function guard would
-- (rightly) stop the positive run; they take names and queries as arguments.

\set ON_ERROR_STOP on
\set QUIET on
\pset pager off
\pset format unaligned
\pset tuples_only on
SET client_min_messages = notice;

-- ============================================================
-- 0. Refuse to run anywhere but a fresh throwaway database
-- ============================================================

DO $$
BEGIN
  IF current_database() NOT LIKE 'planner\_retire\_efu\_%' THEN
    RAISE EXCEPTION 'Refusing to run in database %: use run-retire-email-follow-ups.sh, which creates a throwaway one',
      current_database();
  END IF;
  IF to_regclass('public.tasks') IS NOT NULL OR to_regclass('public.customers') IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to run: this database already has Planner tables';
  END IF;
END $$;

-- ============================================================
-- Harness helpers
-- ============================================================

CREATE SCHEMA harness;

CREATE FUNCTION harness.ok(p_passed boolean, p_label text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF p_passed IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: %', p_label;
  END IF;
  RETURN 'PASS: ' || p_label;
END $$;

-- Two queries return the same multiset of rows. On failure the message lists
-- the rows found on only one side.
CREATE FUNCTION harness.same(p_left text, p_right text, p_label text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_diff text;
BEGIN
  EXECUTE format($f$
    SELECT string_agg(side || ' ' || left(row_text, 400), E'\n' ORDER BY side, row_text)
      FROM (
        SELECT 'left-only' AS side, l::text AS row_text FROM ((%1$s) EXCEPT ALL (%2$s)) l
        UNION ALL
        SELECT 'right-only', r::text FROM ((%2$s) EXCEPT ALL (%1$s)) r
      ) d$f$, p_left, p_right)
    INTO v_diff;
  IF v_diff IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: %; differences:%', p_label, E'\n' || v_diff;
  END IF;
  RETURN 'PASS: ' || p_label;
END $$;

-- The same catalogue query that captured live on 18 September, with the
-- schema and table as arguments.
CREATE FUNCTION harness.catalogue(p_schema text, p_table text)
RETURNS TABLE (section text, name text, detail text)
LANGUAGE sql STABLE AS $$
  WITH t AS (
    SELECT c.oid, c.relrowsecurity, c.relforcerowsecurity, c.relowner, c.relacl,
           c.relkind, c.relpersistence, c.relreplident
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = p_schema AND c.relname = p_table
  )
  SELECT 'table', p_table,
         format('kind=%s persistence=%s replident=%s rls=%s force_rls=%s owner=%s',
                t.relkind, t.relpersistence, t.relreplident, t.relrowsecurity,
                t.relforcerowsecurity, pg_get_userbyid(t.relowner))
    FROM t
  UNION ALL
  SELECT 'comment', p_table, coalesce(obj_description(t.oid, 'pg_class'), '(none)') FROM t
  UNION ALL
  SELECT 'column', a.attname::text,
         format('%s %s notnull=%s default=%s', a.attnum, format_type(a.atttypid, a.atttypmod),
                a.attnotnull, coalesce(pg_get_expr(d.adbin, d.adrelid), '(none)'))
    FROM t JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  UNION ALL
  SELECT 'constraint', con.conname::text, pg_get_constraintdef(con.oid)
    FROM t JOIN pg_constraint con ON con.conrelid = t.oid
  UNION ALL
  SELECT 'index', i.indexname::text, i.indexdef
    FROM pg_indexes i WHERE i.schemaname = p_schema AND i.tablename = p_table
  UNION ALL
  SELECT 'trigger', tg.tgname::text, format('%s enabled=%s', pg_get_triggerdef(tg.oid), tg.tgenabled)
    FROM t JOIN pg_trigger tg ON tg.tgrelid = t.oid AND NOT tg.tgisinternal
  UNION ALL
  SELECT 'policy', p.policyname::text,
         format('%s %s %s using=%s check=%s', p.permissive, p.roles, p.cmd, p.qual, p.with_check)
    FROM pg_policies p WHERE p.schemaname = p_schema AND p.tablename = p_table
  UNION ALL
  SELECT 'grant', CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(g.grantee)::text END,
         format('%s grantable=%s grantor=%s', g.privilege_type, g.is_grantable, pg_get_userbyid(g.grantor))
    FROM t, aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) g
$$;

-- Runs one statement as another role and returns 'ok' or the SQLSTATE it hit.
CREATE FUNCTION harness.try_as(p_role text, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_result text := 'ok';
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    v_result := SQLSTATE;
  END;
  RESET ROLE;
  RETURN v_result;
END $$;

-- Columns the fixture rows fail to exercise: a nullable column never null or
-- never set, or a NOT NULL column that never varies.
CREATE FUNCTION harness.coverage_gaps(p_schema text, p_table text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  r        record;
  v_nulls  bigint;
  v_values bigint;
  v_gaps   text[] := '{}';
BEGIN
  FOR r IN
    SELECT a.attname, a.attnotnull
      FROM pg_attribute a
     WHERE a.attrelid = format('%I.%I', p_schema, p_table)::regclass
       AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum
  LOOP
    EXECUTE format('SELECT count(*) FILTER (WHERE %1$I IS NULL), count(DISTINCT %1$I) FROM %2$I.%3$I',
                   r.attname, p_schema, p_table)
      INTO v_nulls, v_values;
    IF NOT r.attnotnull AND v_nulls = 0 THEN
      v_gaps := v_gaps || format('%s never null', r.attname);
    END IF;
    IF NOT r.attnotnull AND v_values = 0 THEN
      v_gaps := v_gaps || format('%s never set', r.attname);
    END IF;
    IF r.attnotnull AND v_values < 2 THEN
      v_gaps := v_gaps || format('%s never varies', r.attname);
    END IF;
  END LOOP;
  RETURN nullif(array_to_string(v_gaps, ', '), '');
END $$;

-- ============================================================
-- 1. Roles, live default privileges and stubs
-- ============================================================

\echo
\echo '== 1. Roles, live default privileges and stubs'

-- As Supabase defines them. Cluster-wide, so created only if missing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $$;

-- Live pg_default_acl for the role that applies migrations (postgres), schema
-- public, captured 18 September 2026. Entries for supabase_admin and for other
-- schemas only affect objects those roles or schemas create, so they are not
-- reproduced. Here the running role stands in for postgres.
--
-- The table privileges are listed rather than written as ALL: on PostgreSQL 17
-- ALL also means MAINTAIN, which does not exist on live (15.8).
CREATE TABLE harness.live_default_acl (objtype text, acl text[]);
INSERT INTO harness.live_default_acl VALUES
  ('S', '{postgres=rwU/postgres,authenticated=rwU/postgres,service_role=rwU/postgres}'),
  ('f', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
  ('r', '{postgres=arwdDxt/postgres,authenticated=arwdDxt/postgres,service_role=arwdDxt/postgres}');

DO $$
BEGIN
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %1$I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO %1$I, authenticated, service_role', current_user);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %1$I IN SCHEMA public GRANT ALL ON SEQUENCES TO %1$I, authenticated, service_role', current_user);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %1$I IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO %1$I, authenticated, service_role', current_user);
END $$;

SELECT harness.same(
  $q$SELECT d.defaclobjtype::text, x::text
       FROM pg_default_acl d CROSS JOIN LATERAL unnest(d.defaclacl) x
      WHERE d.defaclrole = to_regrole(current_user::text)
        AND d.defaclnamespace = to_regnamespace('public')$q$,
  $q$SELECT objtype, replace(x, 'postgres', current_user::text)
       FROM harness.live_default_acl CROSS JOIN LATERAL unnest(acl) x$q$,
  'default privileges in public match live pg_default_acl (tables, sequences, functions)');

-- Stubs, as live defines them (read-only catalogue capture, 18 September).
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

CREATE TABLE public.customers (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name    text NOT NULL,
  CONSTRAINT customers_id_user_unique UNIQUE (id, user_id)
);

CREATE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- ============================================================
-- 2. Apply 20260915000001 and add synthetic rows
-- ============================================================

\echo
\echo '== 2. Apply 20260915000001 and add synthetic rows'

\i :create_sql

-- Users U1 and U2; customers C1 and C2 both belong to U1. U2 and C2 are
-- deleted later to exercise the restore's skip and null rules.
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000a2');
INSERT INTO public.customers (id, user_id, name) VALUES
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a1', 'Customer one'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000a1', 'Customer two');

-- E1: every column set, non-default values, awkward text.
INSERT INTO public.email_follow_ups (
  id, user_id, mailbox, conversation_id, message_id, counterpart_name,
  counterpart_email, subject, needs, state, last_message_at, last_message_from,
  proposed_draft, draft_status, feedback, urgent, next_chase_date, chase_count,
  sent_at, customer_id, created_at, updated_at
) VALUES (
  '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1',
  'anchor', 'AAQkAD-conversation-1', 'AAMkAD-message-1', 'Zoë O''Brien',
  'zoe@example.test', E'Tasting night: "menu", £25 a head\tand dates', 'Confirm the date',
  'awaiting_them', '2026-09-16 14:05:06.123456+00', 'me',
  E'Hi Zoë,\n\nThanks for this.\n\nPeter', 'approved', 'Softer tone, please', true,
  '2026-09-19', 3, '2026-09-16 14:05:07.5+00', '00000000-0000-4000-8000-0000000000c1',
  '2026-09-15 08:00:00.000001+00', '2026-09-16 09:30:00.654321+01'
);

-- E2: only the required column; every default, every nullable column null.
INSERT INTO public.email_follow_ups (id, user_id) VALUES
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000a1');

-- E3: closed, no conversation id (outside the partial unique index), empty
-- strings rather than nulls, customer C2 (deleted later).
INSERT INTO public.email_follow_ups (
  id, user_id, mailbox, conversation_id, message_id, counterpart_name,
  counterpart_email, subject, needs, state, last_message_at, last_message_from,
  proposed_draft, draft_status, feedback, urgent, next_chase_date, chase_count,
  sent_at, customer_id, created_at, updated_at
) VALUES (
  '00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000a1',
  'orangejelly', NULL, 'AAMkAD-message-3', '', '', '', '', 'closed',
  '2026-10-25 01:30:00+01', 'them', '', 'sent', '', false, NULL, 0,
  '2026-10-25 01:30:00+00', '00000000-0000-4000-8000-0000000000c2',
  '2026-03-29 00:59:59+00', '2026-03-29 02:00:00+01'
);

-- E4: user U2 (deleted later), edit requested.
INSERT INTO public.email_follow_ups (
  id, user_id, conversation_id, state, draft_status, feedback, proposed_draft
) VALUES (
  '00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000a2',
  'AAQkAD-conversation-4', 'awaiting_me', 'edit_requested', 'Mention the invoice', 'Draft four'
);

-- E5: every length limit at its maximum, the largest integer, on hold.
INSERT INTO public.email_follow_ups (
  id, user_id, mailbox, conversation_id, message_id, counterpart_name,
  counterpart_email, subject, needs, state, last_message_at, last_message_from,
  proposed_draft, draft_status, feedback, urgent, next_chase_date, chase_count,
  sent_at, customer_id, created_at, updated_at
) VALUES (
  '00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000a1',
  'orangejelly', repeat('c', 500), repeat('m', 500), repeat('n', 200),
  repeat('e', 307) || '@example.test', repeat('s', 500), repeat('w', 1000), 'awaiting_them',
  '2026-12-31 23:59:59.999999+00', NULL, repeat('d', 20000), 'hold', repeat('f', 5000), false,
  '2027-01-04', 2147483647, NULL, NULL,
  '2026-09-01 00:00:00+00', '2026-09-01 00:00:00+00'
);

-- E6: user U2, the same conversation id as E1 (allowed: the unique index is
-- per user), ready, urgent.
INSERT INTO public.email_follow_ups (
  id, user_id, conversation_id, draft_status, urgent, counterpart_email
) VALUES (
  '00000000-0000-4000-8000-0000000000e6', '00000000-0000-4000-8000-0000000000a2',
  'AAQkAD-conversation-1', 'ready', true, 'someone@example.test'
);

SELECT harness.ok(count(*) = 6, 'six synthetic rows inserted') FROM public.email_follow_ups;

SELECT harness.ok(g IS NULL, 'rows cover every column: each nullable column both null and set, each NOT NULL column varies'
                              || coalesce(' (gaps: ' || g || ')', ''))
  FROM (SELECT harness.coverage_gaps('public', 'email_follow_ups') AS g) s;

SELECT harness.ok(
  (SELECT array_agg(DISTINCT draft_status ORDER BY draft_status) FROM public.email_follow_ups)
    = ARRAY['approved', 'edit_requested', 'hold', 'none', 'ready', 'sent']
  AND (SELECT array_agg(DISTINCT state ORDER BY state) FROM public.email_follow_ups)
    = ARRAY['awaiting_me', 'awaiting_them', 'closed']
  AND (SELECT array_agg(DISTINCT mailbox ORDER BY mailbox) FROM public.email_follow_ups)
    = ARRAY['anchor', 'orangejelly'],
  'rows use every allowed draft_status, state and mailbox value');

-- The 22 columns, for queries that must name them.
\set cols 'id, user_id, mailbox, conversation_id, message_id, counterpart_name, counterpart_email, subject, needs, state, last_message_at, last_message_from, proposed_draft, draft_status, feedback, urgent, next_chase_date, chase_count, sent_at, customer_id, created_at, updated_at'

-- Snapshots taken before anything is retired.
CREATE TABLE harness.rows_before AS SELECT * FROM public.email_follow_ups;
CREATE TABLE harness.cat_before AS SELECT * FROM harness.catalogue('public', 'email_follow_ups');

-- The live catalogue of public.email_follow_ups, captured read-only on
-- 18 September 2026 (project hufxwovthhsjmtifvign, PostgreSQL 15.8) with the
-- query inside harness.catalogue. The restore SQL carries the same capture as
-- a comment block.
CREATE TABLE harness.live_catalogue (section text, name text, detail text);
INSERT INTO harness.live_catalogue (section, name, detail) VALUES
  ('column', 'chase_count', '18 integer notnull=t default=0'),
  ('column', 'conversation_id', '4 text notnull=f default=(none)'),
  ('column', 'counterpart_email', '7 text notnull=f default=(none)'),
  ('column', 'counterpart_name', '6 text notnull=f default=(none)'),
  ('column', 'created_at', '21 timestamp with time zone notnull=t default=now()'),
  ('column', 'customer_id', '20 uuid notnull=f default=(none)'),
  ('column', 'draft_status', '14 text notnull=t default=''none''::text'),
  ('column', 'feedback', '15 text notnull=f default=(none)'),
  ('column', 'id', '1 uuid notnull=t default=gen_random_uuid()'),
  ('column', 'last_message_at', '11 timestamp with time zone notnull=f default=(none)'),
  ('column', 'last_message_from', '12 text notnull=f default=(none)'),
  ('column', 'mailbox', '3 text notnull=t default=''orangejelly''::text'),
  ('column', 'message_id', '5 text notnull=f default=(none)'),
  ('column', 'needs', '9 text notnull=f default=(none)'),
  ('column', 'next_chase_date', '17 date notnull=f default=(none)'),
  ('column', 'proposed_draft', '13 text notnull=f default=(none)'),
  ('column', 'sent_at', '19 timestamp with time zone notnull=f default=(none)'),
  ('column', 'state', '10 text notnull=t default=''awaiting_me''::text'),
  ('column', 'subject', '8 text notnull=f default=(none)'),
  ('column', 'updated_at', '22 timestamp with time zone notnull=t default=now()'),
  ('column', 'urgent', '16 boolean notnull=t default=false'),
  ('column', 'user_id', '2 uuid notnull=t default=(none)'),
  ('comment', 'email_follow_ups', '(none)'),
  ('constraint', 'email_follow_ups_chase_count_nonneg', 'CHECK ((chase_count >= 0))'),
  ('constraint', 'email_follow_ups_conversation_length', 'CHECK (((conversation_id IS NULL) OR (length(conversation_id) <= 500)))'),
  ('constraint', 'email_follow_ups_customer_fkey', 'FOREIGN KEY (customer_id, user_id) REFERENCES customers(id, user_id) ON DELETE SET NULL (customer_id)'),
  ('constraint', 'email_follow_ups_draft_length', 'CHECK (((proposed_draft IS NULL) OR (length(proposed_draft) <= 20000)))'),
  ('constraint', 'email_follow_ups_draft_status_check', 'CHECK ((draft_status = ANY (ARRAY[''none''::text, ''ready''::text, ''approved''::text, ''edit_requested''::text, ''hold''::text, ''sent''::text])))'),
  ('constraint', 'email_follow_ups_email_length', 'CHECK (((counterpart_email IS NULL) OR (length(counterpart_email) <= 320)))'),
  ('constraint', 'email_follow_ups_feedback_length', 'CHECK (((feedback IS NULL) OR (length(feedback) <= 5000)))'),
  ('constraint', 'email_follow_ups_id_user_unique', 'UNIQUE (id, user_id)'),
  ('constraint', 'email_follow_ups_last_from_check', 'CHECK (((last_message_from IS NULL) OR (last_message_from = ANY (ARRAY[''me''::text, ''them''::text]))))'),
  ('constraint', 'email_follow_ups_mailbox_check', 'CHECK ((mailbox = ANY (ARRAY[''orangejelly''::text, ''anchor''::text])))'),
  ('constraint', 'email_follow_ups_message_length', 'CHECK (((message_id IS NULL) OR (length(message_id) <= 500)))'),
  ('constraint', 'email_follow_ups_name_length', 'CHECK (((counterpart_name IS NULL) OR (length(counterpart_name) <= 200)))'),
  ('constraint', 'email_follow_ups_needs_length', 'CHECK (((needs IS NULL) OR (length(needs) <= 1000)))'),
  ('constraint', 'email_follow_ups_pkey', 'PRIMARY KEY (id)'),
  ('constraint', 'email_follow_ups_state_check', 'CHECK ((state = ANY (ARRAY[''awaiting_me''::text, ''awaiting_them''::text, ''closed''::text])))'),
  ('constraint', 'email_follow_ups_subject_length', 'CHECK (((subject IS NULL) OR (length(subject) <= 500)))'),
  ('constraint', 'email_follow_ups_user_id_fkey', 'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),
  ('grant', 'authenticated', 'DELETE grantable=f grantor=postgres'),
  ('grant', 'authenticated', 'INSERT grantable=f grantor=postgres'),
  ('grant', 'authenticated', 'REFERENCES grantable=f grantor=postgres'),
  ('grant', 'authenticated', 'SELECT grantable=f grantor=postgres'),
  ('grant', 'authenticated', 'TRIGGER grantable=f grantor=postgres'),
  ('grant', 'authenticated', 'TRUNCATE grantable=f grantor=postgres'),
  ('grant', 'authenticated', 'UPDATE grantable=f grantor=postgres'),
  ('grant', 'postgres', 'DELETE grantable=f grantor=postgres'),
  ('grant', 'postgres', 'INSERT grantable=f grantor=postgres'),
  ('grant', 'postgres', 'REFERENCES grantable=f grantor=postgres'),
  ('grant', 'postgres', 'SELECT grantable=f grantor=postgres'),
  ('grant', 'postgres', 'TRIGGER grantable=f grantor=postgres'),
  ('grant', 'postgres', 'TRUNCATE grantable=f grantor=postgres'),
  ('grant', 'postgres', 'UPDATE grantable=f grantor=postgres'),
  ('grant', 'service_role', 'DELETE grantable=f grantor=postgres'),
  ('grant', 'service_role', 'INSERT grantable=f grantor=postgres'),
  ('grant', 'service_role', 'REFERENCES grantable=f grantor=postgres'),
  ('grant', 'service_role', 'SELECT grantable=f grantor=postgres'),
  ('grant', 'service_role', 'TRIGGER grantable=f grantor=postgres'),
  ('grant', 'service_role', 'TRUNCATE grantable=f grantor=postgres'),
  ('grant', 'service_role', 'UPDATE grantable=f grantor=postgres'),
  ('index', 'email_follow_ups_id_user_unique', 'CREATE UNIQUE INDEX email_follow_ups_id_user_unique ON public.email_follow_ups USING btree (id, user_id)'),
  ('index', 'email_follow_ups_pkey', 'CREATE UNIQUE INDEX email_follow_ups_pkey ON public.email_follow_ups USING btree (id)'),
  ('index', 'email_follow_ups_user_chase_idx', 'CREATE INDEX email_follow_ups_user_chase_idx ON public.email_follow_ups USING btree (user_id, next_chase_date) WHERE (state = ''awaiting_them''::text)'),
  ('index', 'email_follow_ups_user_conversation_unique', 'CREATE UNIQUE INDEX email_follow_ups_user_conversation_unique ON public.email_follow_ups USING btree (user_id, conversation_id) WHERE (conversation_id IS NOT NULL)'),
  ('index', 'email_follow_ups_user_state_idx', 'CREATE INDEX email_follow_ups_user_state_idx ON public.email_follow_ups USING btree (user_id, state) WHERE (state <> ''closed''::text)'),
  ('policy', 'email_follow_ups_own', 'PERMISSIVE {authenticated} ALL using=(auth.uid() = user_id) check=(auth.uid() = user_id)'),
  ('table', 'email_follow_ups', 'kind=r persistence=p replident=d rls=t force_rls=f owner=postgres'),
  ('trigger', 'trg_email_follow_ups_updated_at', 'CREATE TRIGGER trg_email_follow_ups_updated_at BEFORE UPDATE ON public.email_follow_ups FOR EACH ROW EXECUTE FUNCTION update_updated_at_column() enabled=O');

-- On PostgreSQL 17 a table owner also holds MAINTAIN by default; live 15.8
-- has no such privilege, so the owner's MAINTAIN row is left out here.
SELECT harness.same(
  $q$SELECT section, name, detail FROM harness.cat_before
      WHERE NOT (section = 'grant' AND name = current_user::text AND detail LIKE 'MAINTAIN %')$q$,
  $q$SELECT section,
            CASE WHEN section = 'grant' THEN replace(name, 'postgres', current_user::text) ELSE name END,
            CASE WHEN section IN ('grant', 'table') THEN replace(detail, 'postgres', current_user::text) ELSE detail END
       FROM harness.live_catalogue$q$,
  'harness table matches the live catalogue: 22 columns, 17 constraints, 5 indexes, trigger, policy, RLS, owner, grants');

-- ============================================================
-- 3. Negative tests: each run must fail and change nothing
-- ============================================================
--
-- Each attempt runs in a separate psql session, as `db push` would, so its
-- failure and rollback happen exactly as they would live. Its output and exit
-- status come back through a psql variable.

\echo
\echo '== 3a. Negative test: a view reading the table'

CREATE VIEW public.follow_ups_guard_view AS
  SELECT id, subject FROM public.email_follow_ups;

\set attempt `psql -X -v ON_ERROR_STOP=1 -f :'retire_sql' 2>&1; echo "exit_status=$?"`
\echo :attempt

SELECT harness.ok(:'attempt' LIKE '%exit_status=3', 'view: the migration fails');
SELECT harness.ok(:'attempt' LIKE '%these objects depend on the table (pg_depend): view public.follow_ups_guard_view%',
                  'view: stopped by the pg_depend guard, which names the view');
SELECT harness.ok(to_regclass('public.email_follow_ups_archive') IS NULL, 'view: no archive table left behind');
SELECT harness.same($q$SELECT * FROM harness.catalogue('public', 'email_follow_ups')$q$,
                    $q$SELECT * FROM harness.cat_before$q$, 'view: table catalogue unchanged');
SELECT harness.same($q$SELECT * FROM public.email_follow_ups$q$,
                    $q$SELECT * FROM harness.rows_before$q$, 'view: rows unchanged');
SELECT harness.ok(to_regclass('public.follow_ups_guard_view') IS NOT NULL, 'view: the view still exists');

DROP VIEW public.follow_ups_guard_view;

\echo
\echo '== 3b. Negative test: a plpgsql function reading the table'

-- A function body is not in pg_depend, so only the source guard can see this.
CREATE FUNCTION public.follow_ups_guard_count() RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN
  RETURN (SELECT count(*) FROM public.email_follow_ups);
END $$;

\set attempt `psql -X -v ON_ERROR_STOP=1 -f :'retire_sql' 2>&1; echo "exit_status=$?"`
\echo :attempt

SELECT harness.ok(:'attempt' LIKE '%exit_status=3', 'function: the migration fails');
SELECT harness.ok(:'attempt' LIKE '%these functions still name the table: public.follow_ups_guard_count()%',
                  'function: stopped by the function-source guard, which names the function');
SELECT harness.ok(to_regclass('public.email_follow_ups_archive') IS NULL, 'function: no archive table left behind');
SELECT harness.same($q$SELECT * FROM harness.catalogue('public', 'email_follow_ups')$q$,
                    $q$SELECT * FROM harness.cat_before$q$, 'function: table catalogue unchanged');
SELECT harness.same($q$SELECT * FROM public.email_follow_ups$q$,
                    $q$SELECT * FROM harness.rows_before$q$, 'function: rows unchanged');
SELECT harness.ok(public.follow_ups_guard_count() = 6, 'function: the function still works');

DROP FUNCTION public.follow_ups_guard_count();

\echo
\echo '== 3c. Negative test: an archive table already exists'

CREATE TABLE public.email_follow_ups_archive (placeholder text);
INSERT INTO public.email_follow_ups_archive VALUES ('left by an earlier attempt');

\set attempt `psql -X -v ON_ERROR_STOP=1 -f :'retire_sql' 2>&1; echo "exit_status=$?"`
\echo :attempt

SELECT harness.ok(:'attempt' LIKE '%exit_status=3', 'existing archive: the migration fails');
SELECT harness.ok(:'attempt' LIKE '%relation "email_follow_ups_archive" already exists%',
                  'existing archive: stopped at CREATE TABLE (no IF NOT EXISTS)');
SELECT harness.same(
  $q$SELECT * FROM harness.catalogue('public', 'email_follow_ups_archive') WHERE section IN ('column', 'constraint')$q$,
  $q$VALUES ('column', 'placeholder', '1 text notnull=f default=(none)')$q$,
  'existing archive: its shape is unchanged');
SELECT harness.same($q$SELECT placeholder FROM public.email_follow_ups_archive$q$,
                    $q$VALUES ('left by an earlier attempt')$q$, 'existing archive: its row is unchanged');
SELECT harness.same($q$SELECT * FROM harness.catalogue('public', 'email_follow_ups')$q$,
                    $q$SELECT * FROM harness.cat_before$q$, 'existing archive: table catalogue unchanged');
SELECT harness.same($q$SELECT * FROM public.email_follow_ups$q$,
                    $q$SELECT * FROM harness.rows_before$q$, 'existing archive: rows unchanged');

DROP TABLE public.email_follow_ups_archive;

\echo
\echo '== 3d. Negative test: the table has a column the archive does not copy'

-- The copy names its columns, so without the column check a column added on
-- live after this migration was written would be dropped without an error.
ALTER TABLE public.email_follow_ups ADD COLUMN extra_note text;

\set attempt `psql -X -v ON_ERROR_STOP=1 -f :'retire_sql' 2>&1; echo "exit_status=$?"`
\echo :attempt

SELECT harness.ok(:'attempt' LIKE '%exit_status=3', 'extra column: the migration fails');
SELECT harness.ok(:'attempt' LIKE '%archive columns do not match the table: source only: extra_note text notnull=f%',
                  'extra column: stopped by the column check, which names the column');
SELECT harness.ok(to_regclass('public.email_follow_ups_archive') IS NULL, 'extra column: no archive table left behind');
SELECT harness.same('SELECT ' || :'cols' || ' FROM public.email_follow_ups',
                    'SELECT * FROM harness.rows_before', 'extra column: rows unchanged');

ALTER TABLE public.email_follow_ups DROP COLUMN extra_note;

SELECT harness.same($q$SELECT * FROM harness.catalogue('public', 'email_follow_ups')$q$,
                    $q$SELECT * FROM harness.cat_before$q$, 'extra column: catalogue back to the original once it is dropped');

-- ============================================================
-- 4. The retirement
-- ============================================================

\echo
\echo '== 4. Apply the retirement migration'

\i :retire_sql


SELECT harness.ok(to_regclass('public.email_follow_ups') IS NULL, 'source table is gone');
SELECT harness.ok(
  NOT EXISTS (SELECT FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'email\_follow\_ups\_%' AND tablename <> 'email_follow_ups_archive')
  AND NOT EXISTS (SELECT FROM pg_trigger WHERE tgname = 'trg_email_follow_ups_updated_at')
  AND NOT EXISTS (SELECT FROM pg_policies WHERE policyname = 'email_follow_ups_own'),
  'its indexes, trigger and policy went with it');
SELECT harness.ok(to_regprocedure('public.update_updated_at_column()') IS NOT NULL,
                  'the shared update_updated_at_column() function is kept');

SELECT harness.ok((SELECT count(*) FROM public.email_follow_ups_archive) = 6,
                  'archive holds all 6 rows');
SELECT harness.same('SELECT ' || :'cols' || ' FROM public.email_follow_ups_archive',
                    'SELECT * FROM harness.rows_before',
                    'archive equals the original rows: all 22 columns, both directions, nulls and empty strings kept');
SELECT harness.ok(count(DISTINCT archived_at) = 1 AND bool_and(archived_at IS NOT NULL),
                  'every row carries the one archived_at of the migration transaction')
  FROM public.email_follow_ups_archive;

SELECT harness.same(
  $q$SELECT name, regexp_replace(detail, ' default=.*$', '')
       FROM harness.catalogue('public', 'email_follow_ups_archive')
      WHERE section = 'column' AND name <> 'archived_at'$q$,
  $q$SELECT name, regexp_replace(detail, ' default=.*$', '')
       FROM harness.cat_before WHERE section = 'column'$q$,
  'archive has the 22 source columns in order, with the same types and NOT NULL rules');
SELECT harness.same(
  $q$SELECT section, name, detail FROM harness.catalogue('public', 'email_follow_ups_archive')
      WHERE section IN ('table', 'constraint', 'index', 'trigger', 'policy')
         OR (section = 'column' AND name = 'archived_at')$q$,
  $q$VALUES
      ('table', 'email_follow_ups_archive', format('kind=r persistence=p replident=d rls=t force_rls=f owner=%s', current_user)),
      ('column', 'archived_at', '23 timestamp with time zone notnull=t default=now()'),
      ('constraint', 'email_follow_ups_archive_pkey', 'PRIMARY KEY (id)'),
      ('index', 'email_follow_ups_archive_pkey', 'CREATE UNIQUE INDEX email_follow_ups_archive_pkey ON public.email_follow_ups_archive USING btree (id)')$q$,
  'archive: RLS enabled with no policies, primary key on id, no foreign keys, no triggers, archived_at column');

SELECT harness.same(
  $q$SELECT name, detail FROM harness.catalogue('public', 'email_follow_ups_archive') WHERE section = 'grant'$q$,
  $q$SELECT current_user::text, g.privilege_type || ' grantable=f grantor=' || current_user
       FROM aclexplode(acldefault('r', to_regrole(current_user::text))) g
     UNION ALL
     SELECT 'service_role', 'SELECT grantable=f grantor=' || current_user$q$,
  'archive grants are exactly: the owner''s defaults, and service_role SELECT (no PUBLIC, anon or authenticated)');
SELECT harness.same(
  $q$SELECT grantee::text, privilege_type::text FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'email_follow_ups_archive'
        AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')$q$,
  $q$VALUES ('service_role', 'SELECT')$q$,
  'information_schema.role_table_grants: service_role SELECT only; nothing for anon or authenticated');

SELECT harness.ok(harness.try_as('anon', 'SELECT count(*) FROM public.email_follow_ups_archive') = '42501',
                  'as anon: reading the archive is denied');
SELECT harness.ok(harness.try_as('authenticated', 'SELECT count(*) FROM public.email_follow_ups_archive') = '42501',
                  'as authenticated: reading the archive is denied');
SELECT harness.ok(harness.try_as('service_role', 'SELECT count(*) FROM public.email_follow_ups_archive') = 'ok',
                  'as service_role: reading the archive works');
SELECT harness.ok(harness.try_as('service_role', 'DELETE FROM public.email_follow_ups_archive') = '42501'
                  AND harness.try_as('service_role', 'UPDATE public.email_follow_ups_archive SET feedback = NULL') = '42501'
                  AND harness.try_as('service_role', 'INSERT INTO public.email_follow_ups_archive (id, user_id, mailbox, state, draft_status, urgent, chase_count, created_at, updated_at) VALUES (gen_random_uuid(), gen_random_uuid(), ''anchor'', ''closed'', ''none'', false, 0, now(), now())') = '42501'
                  AND harness.try_as('service_role', 'TRUNCATE public.email_follow_ups_archive') = '42501',
                  'as service_role: insert, update, delete and truncate are denied');

SELECT harness.ok(
  obj_description('public.email_follow_ups_archive'::regclass, 'pg_class') LIKE '%of public.email_follow_ups, taken on '
    || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD') || ' (UTC)%'
  AND obj_description('public.email_follow_ups_archive'::regclass, 'pg_class') LIKE '%supabase/restore/restore_email_follow_ups.sql%',
  'archive comment records the source, the date and the restore path');

-- ============================================================
-- 5. The restore
-- ============================================================

\echo
\echo '== 5a. Restore with every user and customer present'

CREATE TABLE harness.archive_before_restore AS SELECT * FROM public.email_follow_ups_archive;

\i :restore_sql

SELECT harness.same($q$SELECT * FROM harness.catalogue('public', 'email_follow_ups')$q$,
                    $q$SELECT * FROM harness.cat_before$q$,
                    'restored catalogue equals the original: columns, defaults, constraints, indexes, trigger, policy, RLS, owner, grants');
SELECT harness.same($q$SELECT * FROM public.email_follow_ups$q$,
                    $q$SELECT * FROM harness.rows_before$q$,
                    'restored rows equal the originals, all 22 columns including created_at and updated_at');
SELECT harness.same($q$SELECT * FROM public.email_follow_ups_archive$q$,
                    $q$SELECT * FROM harness.archive_before_restore$q$,
                    'the archive is untouched by the restore');

UPDATE public.email_follow_ups SET feedback = 'trigger check'
 WHERE id = '00000000-0000-4000-8000-0000000000e2';
SELECT harness.ok(
  (SELECT updated_at FROM public.email_follow_ups WHERE id = '00000000-0000-4000-8000-0000000000e2')
    > (SELECT updated_at FROM harness.rows_before WHERE id = '00000000-0000-4000-8000-0000000000e2'),
  'the restored updated_at trigger fires');

\echo
\echo '== 5b. Restore after customer C2 and user U2 are deleted'

-- Test only: remove the restored copy so the restore can run again.
DROP TABLE public.email_follow_ups;
DELETE FROM public.customers WHERE id = '00000000-0000-4000-8000-0000000000c2';
DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-0000000000a2';

\set attempt `psql -X -v ON_ERROR_STOP=1 -f :'restore_sql' 2>&1; echo "exit_status=$?"`
\echo :attempt

SELECT harness.ok(:'attempt' LIKE '%exit_status=0', 'edge restore: completes');
SELECT harness.ok(:'attempt' LIKE '%Restored 4 of 6 archived email_follow_ups row(s)%', 'edge restore: reports 4 of 6 restored');
SELECT harness.ok(:'attempt' LIKE '%Skipped 2 row(s) whose user no longer exists: 00000000-0000-4000-8000-0000000000e4, 00000000-0000-4000-8000-0000000000e6%',
                  'edge restore: lists both rows whose user is gone');
SELECT harness.ok(:'attempt' LIKE '%customer no longer exists: 00000000-0000-4000-8000-0000000000e3%',
                  'edge restore: lists the row whose customer is gone');
SELECT harness.same(
  $q$SELECT * FROM public.email_follow_ups$q$,
  $q$SELECT id, user_id, mailbox, conversation_id, message_id, counterpart_name,
            counterpart_email, subject, needs, state, last_message_at, last_message_from,
            proposed_draft, draft_status, feedback, urgent, next_chase_date, chase_count,
            sent_at,
            CASE WHEN id = '00000000-0000-4000-8000-0000000000e3' THEN NULL ELSE customer_id END,
            created_at, updated_at
       FROM harness.rows_before
      WHERE user_id <> '00000000-0000-4000-8000-0000000000a2'$q$,
  'edge restore: E3 back with customer_id null, E1, E2 and E5 unchanged, E4 and E6 skipped');
SELECT harness.same($q$SELECT * FROM harness.catalogue('public', 'email_follow_ups')$q$,
                    $q$SELECT * FROM harness.cat_before$q$,
                    'edge restore: catalogue still equals the original');
SELECT harness.same($q$SELECT * FROM public.email_follow_ups_archive$q$,
                    $q$SELECT * FROM harness.archive_before_restore$q$,
                    'edge restore: the archive is still untouched');

\echo
\echo 'All retirement and restore assertions passed.'
