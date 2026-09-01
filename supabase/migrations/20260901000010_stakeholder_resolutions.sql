-- ============================================================
-- Record of what each stakeholder name was decided to be
-- ============================================================
--
-- The drop migration refuses while any stakeholder name is undecided, and it
-- checks that by matching the name against customers and contacts. That works
-- for a name that became a record. It does not work for the two other outcomes
-- a real triage produces:
--
--   merged     "Kaylee" is the same person as "Kaylee Pohlmeyer", so only the
--              canonical spelling becomes a contact
--   discarded  "Bill" was a tag used to hide entries, not a name to keep
--
-- Both are decisions. Without somewhere to record them the guard cannot tell a
-- merged name from a forgotten one, and would block the drop forever on names
-- that have in fact been dealt with.
--
-- Applied to the live database on 2026-09-01 during the data migration, and
-- committed here so a database rebuilt from this directory matches production.

BEGIN;

CREATE TABLE IF NOT EXISTS public.stakeholder_resolutions (
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  resolution  text NOT NULL,
  detail      text,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, name),
  CONSTRAINT stakeholder_resolutions_kind
    CHECK (resolution IN ('customer', 'contact', 'merged', 'discarded', 'self'))
);

ALTER TABLE public.stakeholder_resolutions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stakeholder_resolutions_own ON public.stakeholder_resolutions;
CREATE POLICY stakeholder_resolutions_own ON public.stakeholder_resolutions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

COMMIT;
