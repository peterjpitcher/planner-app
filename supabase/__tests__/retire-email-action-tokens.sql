-- Test for supabase/migrations/20260930133014_retire_email_action_tokens.sql and
-- supabase/restore/restore_email_action_tokens.sql.
--
-- Run it through supabase/__tests__/run-retire-email-action-tokens.sh, which
-- creates a throwaway database, passes the three SQL file paths in as psql
-- variables (create_sql, retire_sql, restore_sql) and always drops the
-- database afterwards. The migration and the restore carry their own BEGIN and
-- COMMIT, so each attempt runs in a separate psql session, as `db push` would.
-- All data is synthetic.
--
-- Covered:
--   1. 20260711000001 applied (with stubs for the two tables it alters) and
--      the live grants of the time reproduced; the table matches the live
--      catalogue captured on 30 September 2026.
--   2. Negative tests, each of which must fail with nothing changed: a row in
--      the table, a view on it, a plpgsql function reading it, a foreign key
--      to it, and a trigger on it.
--   3. The retirement: table gone, stubs untouched.
--   4. The restore: same shape as live, service_role-only grants (also checked
--      by acting as each role), a second run refused; then the retirement runs
--      cleanly again on the restored table.
--
-- Helper functions live in schema harness. None of them may contain the
-- table's name in its source, or the migration's function guard would
-- (rightly) stop the positive run; they take names as arguments.

\set ON_ERROR_STOP on
\set QUIET on
\pset pager off
\pset format unaligned
\pset tuples_only on
SET client_min_messages = notice;

\echo '== 1. Setup'

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

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA harness;
GRANT USAGE ON SCHEMA harness TO anon, authenticated, service_role;

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

-- The shape of a table, in the terms of the live capture on 30 September:
-- columns, constraints, indexes, row-level security, policies and triggers.
-- Grants are checked separately because the restore changes them on purpose.
CREATE FUNCTION harness.shape(p_schema text, p_table text)
RETURNS TABLE (section text, name text, detail text)
LANGUAGE sql STABLE AS $$
  WITH t AS (
    SELECT c.oid, c.relrowsecurity, c.relforcerowsecurity, c.relowner
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = p_schema AND c.relname = p_table
  )
  SELECT 'table', p_table,
         format('rls=%s force_rls=%s owner=%s', t.relrowsecurity, t.relforcerowsecurity,
                pg_get_userbyid(t.relowner))
    FROM t
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
  SELECT 'trigger', tg.tgname::text, pg_get_triggerdef(tg.oid)
    FROM t JOIN pg_trigger tg ON tg.tgrelid = t.oid AND NOT tg.tgisinternal
  UNION ALL
  SELECT 'policy', p.policyname::text, p.cmd
    FROM pg_policies p WHERE p.schemaname = p_schema AND p.tablename = p_table
$$;

-- Every grant except the owner's own. MAINTAIN is left out: PostgreSQL 17
-- added it, live runs an older major version and has none.
CREATE FUNCTION harness.grants(p_schema text, p_table text)
RETURNS TABLE (grant_text text)
LANGUAGE sql STABLE AS $$
  SELECT format('%s:%s', CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(g.grantee) END,
                g.privilege_type)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace,
         aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
   WHERE n.nspname = p_schema AND c.relname = p_table
     AND g.grantee <> c.relowner
     AND g.privilege_type <> 'MAINTAIN'
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

-- 20260711000001 also alters user_settings and tasks; stub just enough of
-- them for it to run.
CREATE TABLE public.user_settings (user_id uuid PRIMARY KEY);
CREATE TABLE public.tasks (id uuid PRIMARY KEY);

\set QUIET off
\i :create_sql
\set QUIET on

-- When 20260711000001 ran on live, the schema's default privileges still gave
-- anon, authenticated and service_role every table privilege.
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.email_action_tokens TO anon, authenticated, service_role;

-- Live catalogue captured read only on 30 September 2026.
CREATE TABLE harness.live_shape (section text, name text, detail text);
INSERT INTO harness.live_shape VALUES
  ('table', 'email_action_tokens', 'rls=t force_rls=f owner=postgres'),
  ('column', 'jti', '1 uuid notnull=t default=(none)'),
  ('column', 'user_id', '2 uuid notnull=t default=(none)'),
  ('column', 'action', '3 text notnull=t default=(none)'),
  ('column', 'task_id', '4 uuid notnull=f default=(none)'),
  ('column', 'used_at', '5 timestamp with time zone notnull=t default=now()'),
  ('constraint', 'email_action_tokens_pkey', 'PRIMARY KEY (jti)'),
  ('index', 'email_action_tokens_pkey',
   'CREATE UNIQUE INDEX email_action_tokens_pkey ON public.email_action_tokens USING btree (jti)');

CREATE TABLE harness.live_grants (grant_text text);
INSERT INTO harness.live_grants
SELECT r || ':' || p
  FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r,
       unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p;

SELECT harness.same($q$SELECT * FROM harness.shape('public', 'email_action_tokens')$q$,
                    $q$SELECT * FROM harness.live_shape$q$, 'setup: table shape matches live');
SELECT harness.same($q$SELECT * FROM harness.grants('public', 'email_action_tokens')$q$,
                    $q$SELECT * FROM harness.live_grants$q$, 'setup: grants match live');

CREATE TABLE harness.shape_before AS SELECT * FROM harness.shape('public', 'email_action_tokens');
CREATE TABLE harness.grants_before AS SELECT * FROM harness.grants('public', 'email_action_tokens');
CREATE TABLE harness.stubs_before AS
  SELECT * FROM harness.shape('public', 'user_settings')
  UNION ALL SELECT * FROM harness.shape('public', 'tasks');

-- ============================================================
-- 2. Negative tests
-- ============================================================
--
-- Each attempt runs in a separate psql session. Its output and exit status
-- come back through a psql variable; psql exits 3 when a script fails.

\echo
\echo '== 2a. Negative test: a row in the table'

INSERT INTO public.email_action_tokens (jti, user_id, action, task_id)
VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000aa', 'task_done',
        '00000000-0000-4000-8000-0000000000bb');

\set attempt `psql -X -v ON_ERROR_STOP=1 -f :'retire_sql' 2>&1; echo "exit_status=$?"`
\echo :attempt

SELECT harness.ok(:'attempt' LIKE '%exit_status=3', 'row: the migration fails');
SELECT harness.ok(:'attempt' LIKE '%the table holds 1 row(s); archive them before dropping it%',
                  'row: stopped by the empty check, which counts the row');
SELECT harness.same($q$SELECT * FROM harness.shape('public', 'email_action_tokens')$q$,
                    $q$SELECT * FROM harness.shape_before$q$, 'row: table shape unchanged');
SELECT harness.ok((SELECT count(*) FROM public.email_action_tokens) = 1, 'row: the row is still there');

DELETE FROM public.email_action_tokens;

\echo
\echo '== 2b. Negative test: a view reading the table'

CREATE VIEW public.action_tokens_guard_view AS
  SELECT jti, action FROM public.email_action_tokens;

\set attempt `psql -X -v ON_ERROR_STOP=1 -f :'retire_sql' 2>&1; echo "exit_status=$?"`
\echo :attempt

SELECT harness.ok(:'attempt' LIKE '%exit_status=3', 'view: the migration fails');
SELECT harness.ok(:'attempt' LIKE '%these objects depend on the table (pg_depend): view public.action_tokens_guard_view%',
                  'view: stopped by the pg_depend guard, which names the view');
SELECT harness.same($q$SELECT * FROM harness.shape('public', 'email_action_tokens')$q$,
                    $q$SELECT * FROM harness.shape_before$q$, 'view: table shape unchanged');

DROP VIEW public.action_tokens_guard_view;

\echo
\echo '== 2c. Negative test: a plpgsql function reading the table'

-- A function body is not in pg_depend, so only the source guard can see this.
CREATE FUNCTION public.action_tokens_guard_count() RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN
  RETURN (SELECT count(*) FROM public.email_action_tokens);
END $$;

\set attempt `psql -X -v ON_ERROR_STOP=1 -f :'retire_sql' 2>&1; echo "exit_status=$?"`
\echo :attempt

SELECT harness.ok(:'attempt' LIKE '%exit_status=3', 'function: the migration fails');
SELECT harness.ok(:'attempt' LIKE '%these functions still name the table: public.action_tokens_guard_count()%',
                  'function: stopped by the function-source guard, which names the function');
SELECT harness.same($q$SELECT * FROM harness.shape('public', 'email_action_tokens')$q$,
                    $q$SELECT * FROM harness.shape_before$q$, 'function: table shape unchanged');

DROP FUNCTION public.action_tokens_guard_count();

\echo
\echo '== 2d. Negative test: a foreign key to the table'

CREATE TABLE public.action_tokens_guard_ref (
  jti uuid CONSTRAINT action_tokens_guard_ref_jti_fkey REFERENCES public.email_action_tokens (jti)
);

\set attempt `psql -X -v ON_ERROR_STOP=1 -f :'retire_sql' 2>&1; echo "exit_status=$?"`
\echo :attempt

SELECT harness.ok(:'attempt' LIKE '%exit_status=3', 'foreign key: the migration fails');
SELECT harness.ok(:'attempt' LIKE '%foreign keys point to the table: action_tokens_guard_ref_jti_fkey on public.action_tokens_guard_ref%',
                  'foreign key: stopped by the foreign-key guard, which names the constraint');
SELECT harness.same($q$SELECT * FROM harness.shape('public', 'email_action_tokens')$q$,
                    $q$SELECT * FROM harness.shape_before$q$, 'foreign key: table shape unchanged');

DROP TABLE public.action_tokens_guard_ref;

\echo
\echo '== 2e. Negative test: a trigger on the table'

CREATE FUNCTION public.guard_noop_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RETURN NEW;
END $$;

CREATE TRIGGER trg_action_tokens_guard BEFORE INSERT ON public.email_action_tokens
  FOR EACH ROW EXECUTE FUNCTION public.guard_noop_trigger();

\set attempt `psql -X -v ON_ERROR_STOP=1 -f :'retire_sql' 2>&1; echo "exit_status=$?"`
\echo :attempt

SELECT harness.ok(:'attempt' LIKE '%exit_status=3', 'trigger: the migration fails');
SELECT harness.ok(:'attempt' LIKE '%unexpected triggers on the table: trg_action_tokens_guard%',
                  'trigger: stopped by the trigger guard, which names the trigger');

DROP TRIGGER trg_action_tokens_guard ON public.email_action_tokens;
DROP FUNCTION public.guard_noop_trigger();

SELECT harness.same($q$SELECT * FROM harness.shape('public', 'email_action_tokens')$q$,
                    $q$SELECT * FROM harness.shape_before$q$, 'after the negative tests: table shape unchanged');
SELECT harness.same($q$SELECT * FROM harness.grants('public', 'email_action_tokens')$q$,
                    $q$SELECT * FROM harness.grants_before$q$, 'after the negative tests: grants unchanged');
SELECT harness.ok((SELECT count(*) FROM public.email_action_tokens) = 0, 'after the negative tests: table empty again');

-- ============================================================
-- 3. The retirement
-- ============================================================

\echo
\echo '== 3. The retirement'

\set attempt `psql -X -v ON_ERROR_STOP=1 -f :'retire_sql' 2>&1; echo "exit_status=$?"`
\echo :attempt

SELECT harness.ok(:'attempt' LIKE '%exit_status=0', 'retire: the migration succeeds');
SELECT harness.ok(:'attempt' LIKE '%is unused and empty; dropping it%', 'retire: the guard passed');
SELECT harness.ok(to_regclass('public.email_action_tokens') IS NULL, 'retire: the table is gone');
SELECT harness.ok(to_regclass('public.email_action_tokens_pkey') IS NULL, 'retire: its index is gone');
SELECT harness.same($q$SELECT * FROM harness.shape('public', 'user_settings')
                       UNION ALL SELECT * FROM harness.shape('public', 'tasks')$q$,
                    $q$SELECT * FROM harness.stubs_before$q$, 'retire: the other tables are untouched');

\set attempt `psql -X -v ON_ERROR_STOP=1 -f :'retire_sql' 2>&1; echo "exit_status=$?"`
SELECT harness.ok(:'attempt' LIKE '%exit_status=3', 'retire: a second run fails rather than doing anything');

-- ============================================================
-- 4. The restore
-- ============================================================

\echo
\echo '== 4. The restore'

-- Reproduce live's current default privileges, which give authenticated and
-- service_role every privilege on a new table, so the restore has to remove them.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated, service_role;

\set attempt `psql -X -v ON_ERROR_STOP=1 -f :'restore_sql' 2>&1; echo "exit_status=$?"`
\echo :attempt

SELECT harness.ok(:'attempt' LIKE '%exit_status=0', 'restore: succeeds');
SELECT harness.same($q$SELECT * FROM harness.shape('public', 'email_action_tokens')$q$,
                    $q$SELECT * FROM harness.live_shape$q$, 'restore: table shape matches live');
SELECT harness.same($q$SELECT * FROM harness.grants('public', 'email_action_tokens')$q$,
                    $q$VALUES ('service_role:SELECT'), ('service_role:INSERT'), ('service_role:UPDATE'), ('service_role:DELETE')$q$,
                    'restore: service_role gets SELECT, INSERT, UPDATE and DELETE; nobody else gets anything');

SELECT harness.ok(harness.try_as('anon', 'SELECT 1 FROM public.email_action_tokens') = '42501',
                  'restore: anon cannot read');
SELECT harness.ok(harness.try_as('authenticated', 'SELECT 1 FROM public.email_action_tokens') = '42501',
                  'restore: authenticated cannot read');
SELECT harness.ok(harness.try_as('service_role',
                  $s$INSERT INTO public.email_action_tokens (jti, user_id, action)
                     VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000aa', 'confirm_plan')$s$) = 'ok',
                  'restore: service_role can write');
SELECT harness.ok(harness.try_as('service_role',
                  $s$INSERT INTO public.email_action_tokens (jti, user_id, action)
                     VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000aa', 'confirm_plan')$s$) = '23505',
                  'restore: a reused jti is still refused');

\set attempt `psql -X -v ON_ERROR_STOP=1 -f :'restore_sql' 2>&1; echo "exit_status=$?"`
SELECT harness.ok(:'attempt' LIKE '%exit_status=3', 'restore: a second run fails rather than doing anything');

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated, service_role;

\echo
\echo '== 4b. The retirement again, on the restored table'

DELETE FROM public.email_action_tokens;

\set attempt `psql -X -v ON_ERROR_STOP=1 -f :'retire_sql' 2>&1; echo "exit_status=$?"`
SELECT harness.ok(:'attempt' LIKE '%exit_status=0', 'retire after restore: succeeds');
SELECT harness.ok(to_regclass('public.email_action_tokens') IS NULL, 'retire after restore: the table is gone');

\echo
\echo 'All checks passed.'
