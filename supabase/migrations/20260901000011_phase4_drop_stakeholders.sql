-- ============================================================
-- Customers, Phase 4: archive and drop projects.stakeholders
-- ============================================================
--
-- Spec: docs/superpowers/specs/2026-09-01-customers-crm-design.md section 5.3c.
--
-- The column is retired, as decided. Two guards, because a DROP COLUMN cannot
-- be undone and the triage behind it was a judgement call that might need
-- revisiting months from now.
--
-- Run this only after the triage screen has been worked through. It checks.

BEGIN;

-- ------------------------------------------------------------
-- 1. Refuse to drop data nobody has looked at
-- ------------------------------------------------------------
--
-- A name counts as triaged once it matches a customer or a contact. Anything
-- else is a name that was never decided about, and dropping it would lose it
-- silently, which is the one outcome this whole design exists to prevent.

DO $$
DECLARE
  v_untriaged text[];
BEGIN
  SELECT array_agg(DISTINCT s.name) INTO v_untriaged
  FROM (
    SELECT p.user_id, btrim(part) AS name
      FROM public.projects p,
           unnest(coalesce(p.stakeholders, '{}')) AS entry,
           unnest(string_to_array(entry, ',')) AS part
     WHERE btrim(part) <> ''
  ) s
  WHERE NOT EXISTS (
    SELECT 1 FROM public.customers c
     WHERE c.user_id = s.user_id AND lower(btrim(c.name)) = lower(s.name)
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.contacts ct
     WHERE ct.user_id = s.user_id AND lower(btrim(ct.name)) = lower(s.name)
  )
  -- A name can also be decided without becoming a record of its own: merged
  -- into another spelling, or discarded as a filing tag. Both are decisions,
  -- and without this the guard would block forever on names already dealt with.
  AND NOT EXISTS (
    SELECT 1 FROM public.stakeholder_resolutions sr
     WHERE sr.user_id = s.user_id AND lower(btrim(sr.name)) = lower(s.name)
  );

  IF v_untriaged IS NOT NULL AND array_length(v_untriaged, 1) > 0 THEN
    RAISE EXCEPTION
      'Cannot drop stakeholders: % name(s) have not been triaged yet, starting with %. Work through /customers/setup first.',
      array_length(v_untriaged, 1),
      array_to_string(v_untriaged[1:5], ', ');
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. Archive the raw data before removing the column
-- ------------------------------------------------------------
--
-- A few rows of text, and it makes an irreversible operation reversible. Drop
-- this table yourself once you are satisfied with the conversion; it is
-- deliberately not on a timer.

CREATE TABLE IF NOT EXISTS public.projects_stakeholders_archive AS
  SELECT id AS project_id, user_id, stakeholders, now() AS archived_at
    FROM public.projects
   WHERE stakeholders IS NOT NULL AND array_length(stakeholders, 1) > 0;

ALTER TABLE public.projects_stakeholders_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS projects_stakeholders_archive_own ON public.projects_stakeholders_archive;
CREATE POLICY projects_stakeholders_archive_own ON public.projects_stakeholders_archive
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 3. Function and view audit
-- ------------------------------------------------------------
--
-- Required before any DROP COLUMN here: a PL/pgSQL function referencing a
-- dropped column throws at runtime, and any function with an
-- EXCEPTION WHEN OTHERS handler swallows that into a generic failure, so the
-- breakage stays invisible until someone notices a feature has stopped working.

DO $$
DECLARE
  v_offenders text;
BEGIN
  SELECT string_agg(routine_name, ', ') INTO v_offenders
    FROM information_schema.routines
   WHERE routine_schema = 'public'
     AND routine_type = 'FUNCTION'
     AND routine_definition ILIKE '%stakeholders%'
     -- This migration's own guard mentions the column and is not a dependency.
     AND routine_name NOT LIKE 'pg_%';

  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION 'These functions still reference stakeholders: %', v_offenders;
  END IF;

  SELECT string_agg(table_name, ', ') INTO v_offenders
    FROM information_schema.view_column_usage
   WHERE table_schema = 'public' AND column_name = 'stakeholders';

  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION 'These views still reference stakeholders: %', v_offenders;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4. Drop
-- ------------------------------------------------------------

ALTER TABLE public.projects DROP COLUMN stakeholders;

COMMIT;
