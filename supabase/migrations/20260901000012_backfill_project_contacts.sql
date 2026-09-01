-- ============================================================
-- Rebuild project_contacts from the archived stakeholder tags
-- ============================================================
--
-- The customers data migration created every contact but never wrote the
-- project links, so project_contacts sat empty. The person-level link that
-- projects.stakeholders used to carry ("Clive is on these four projects") was
-- therefore lost, even though every contact existed.
--
-- It is recoverable because the drop migration archived the raw arrays first,
-- which is exactly what that archive was for.
--
-- Applied to the live database on 2026-09-01 and committed so a database
-- rebuilt from this directory matches production. Idempotent: the insert is
-- ON CONFLICT DO NOTHING against the (project_id, contact_id) primary key.

BEGIN;

DO $backfill$
DECLARE r record; v_contact uuid; v_target text;
BEGIN
  -- Nothing to do on a fresh database that never had the column.
  IF to_regclass('public.projects_stakeholders_archive') IS NULL THEN
    RAISE NOTICE 'no stakeholder archive, skipping';
    RETURN;
  END IF;

  FOR r IN
    SELECT a.project_id, a.user_id, btrim(part) AS raw_name
      FROM public.projects_stakeholders_archive a,
           unnest(coalesce(a.stakeholders,'{}')) AS entry,
           unnest(string_to_array(entry, ',')) AS part
     WHERE btrim(part) <> ''
  LOOP
    -- A name may have been merged into another spelling ("Kaylee" into
    -- "Kaylee Pohlmeyer"), so follow the resolution to the record it became.
    SELECT CASE WHEN sr.resolution = 'merged' THEN sr.detail ELSE r.raw_name END
      INTO v_target
      FROM public.stakeholder_resolutions sr
     WHERE sr.user_id = r.user_id AND lower(btrim(sr.name)) = lower(r.raw_name);
    v_target := coalesce(v_target, r.raw_name);

    -- Prefer the contact attached to that project's own customer, so a shared
    -- first name lands on the right person rather than the first match.
    SELECT c.id INTO v_contact
      FROM public.contacts c
      JOIN public.projects p ON p.id = r.project_id
     WHERE c.user_id = r.user_id
       AND lower(btrim(c.name)) = lower(v_target)
       AND c.customer_id IS NOT DISTINCT FROM p.customer_id
     LIMIT 1;

    IF v_contact IS NULL THEN
      SELECT c.id INTO v_contact FROM public.contacts c
       WHERE c.user_id = r.user_id AND lower(btrim(c.name)) = lower(v_target)
       LIMIT 1;
    END IF;

    CONTINUE WHEN v_contact IS NULL;

    INSERT INTO public.project_contacts (project_id, contact_id, user_id)
    VALUES (r.project_id, v_contact, r.user_id)
    ON CONFLICT (project_id, contact_id) DO NOTHING;
  END LOOP;
END $backfill$;

COMMIT;
