-- ============================================================
-- Retire email_action_tokens: prove it is unused and empty, then drop it
-- ============================================================
--
-- The table recorded the single-use jti of each signed one-click email link
-- (created in 20260711000001). PR #48 stopped the morning email signing links
-- and PR #49 removed the /api/actions route that wrote here, so nothing reads
-- or writes it any more. On 30 September 2026 it held 0 rows, and had never
-- held one.
--
-- Archive step: with no rows there is nothing to copy, so this migration does
-- not create an empty archive table. Instead it refuses to drop the table if
-- any row exists, so it can never destroy data. The table's definition is kept
-- in supabase/restore/restore_email_action_tokens.sql.
--
-- Run only after PR #49 is deployed. Apply with `npx supabase db push` so live
-- history records this version.
--
-- Everything here is one transaction. Any guard that fails raises an error,
-- the whole migration rolls back, and nothing changes.
--
-- Tested on a throwaway database by supabase/__tests__/run-retire-email-action-tokens.sh.

BEGIN;

-- ------------------------------------------------------------
-- 1. Lock
-- ------------------------------------------------------------
--
-- Fail rather than queue behind a long transaction. ACCESS EXCLUSIVE stops a
-- row landing between the empty check and the drop.

SET LOCAL lock_timeout = '5s';
LOCK TABLE public.email_action_tokens IN ACCESS EXCLUSIVE MODE;

-- ------------------------------------------------------------
-- 2. Guard: stop if anything still uses the table, or it holds any row
-- ------------------------------------------------------------

DO $$
DECLARE
  v_table constant regclass := 'public.email_action_tokens'::regclass;
  v_hits  text;
  v_rows  bigint;
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
     AND strpos(lower(p.prosrc), 'email_action_tokens') > 0;

  IF v_hits IS NOT NULL THEN
    RAISE EXCEPTION 'email_action_tokens retirement stopped: these functions still name the table: %', v_hits;
  END IF;

  -- Views, materialised views and rules (all stored in pg_rewrite), and
  -- policies on other tables, that depend on this table.
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
    RAISE EXCEPTION 'email_action_tokens retirement stopped: these objects depend on the table (pg_depend): %', v_hits;
  END IF;

  -- The table never had a trigger. One now means something was added that
  -- this migration does not know about.
  SELECT string_agg(quote_ident(t.tgname), ', ' ORDER BY t.tgname)
    INTO v_hits
    FROM pg_trigger t
   WHERE t.tgrelid = v_table
     AND NOT t.tgisinternal;

  IF v_hits IS NOT NULL THEN
    RAISE EXCEPTION 'email_action_tokens retirement stopped: unexpected triggers on the table: %', v_hits;
  END IF;

  SELECT string_agg(format('%I on %I.%I', con.conname, n.nspname, c.relname), ', ' ORDER BY con.conname)
    INTO v_hits
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE con.contype = 'f'
     AND con.confrelid = v_table;

  IF v_hits IS NOT NULL THEN
    RAISE EXCEPTION 'email_action_tokens retirement stopped: foreign keys point to the table: %', v_hits;
  END IF;

  -- pg_publication_tables also expands FOR ALL TABLES and TABLES IN SCHEMA.
  SELECT string_agg(quote_ident(pt.pubname), ', ' ORDER BY pt.pubname)
    INTO v_hits
    FROM pg_publication_tables pt
   WHERE pt.schemaname = 'public'
     AND pt.tablename = 'email_action_tokens';

  IF v_hits IS NOT NULL THEN
    RAISE EXCEPTION 'email_action_tokens retirement stopped: the table is in these publications: %', v_hits;
  END IF;

  -- The archive check. Any row means a link was used after all, and its
  -- record must be archived first, so stop rather than drop it.
  SELECT count(*) INTO v_rows FROM public.email_action_tokens;

  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'email_action_tokens retirement stopped: the table holds % row(s); archive them before dropping it', v_rows;
  END IF;

  RAISE NOTICE 'email_action_tokens is unused and empty; dropping it';
END $$;

-- ------------------------------------------------------------
-- 3. Drop the table
-- ------------------------------------------------------------
--
-- No CASCADE: anything the guards above did not anticipate makes this fail
-- and roll everything back. The primary key index goes with the table.

DROP TABLE public.email_action_tokens;

COMMIT;
