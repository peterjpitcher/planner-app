# Plan C: Archive and drop `email_follow_ups` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the implement-plan skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Copy every row of `public.email_follow_ups` into a locked-down archive table, prove the copy, then drop the live table, with a tested restore path.

**Architecture:** One transactional migration with executable guards, a separate restore SQL file, and a throwaway-database test harness run with psql against the local Homebrew PostgreSQL 17.

**Tech Stack:** PostgreSQL (live 15.8, local test 17), Supabase CLI (`npx supabase db push`), psql.

**Spec:** `docs/superpowers/specs/2026-09-18-jordan-outlook-drafts-design.md`, Part C.

**Linked plans:** Starts after Plan B is deployed and verified.

## Global Constraints

- **Branch:** `chore/retire-email-follow-ups-table` from `origin/main`, in the worktree `.claude/worktrees/retire-email-follow-ups-table`.
- **No `IF NOT EXISTS`** on the archive. The migration file carries its own `BEGIN` and `COMMIT`, and uses `SET LOCAL lock_timeout = '5s'`.
- **Grants on the archive:** RLS enabled with no policies; `REVOKE ALL FROM PUBLIC, anon, authenticated, service_role`; `GRANT SELECT TO service_role`.
- **Keep** `update_updated_at_column()`.

---

### Task C1: Migration, restore SQL and tests

**Files:**
- Create:
  - `supabase/migrations/<UTC timestamp>_retire_email_follow_ups.sql`
  - `supabase/restore/restore_email_follow_ups.sql`
  - `supabase/__tests__/retire-email-follow-ups.sql`
  - `supabase/__tests__/run-retire-email-follow-ups.sh`

- [x] Capture the live catalogue with read-only SQL: the table's grants, indexes, trigger, policy and RLS flag. Save it as a comment block in the restore SQL, and write the grants explicitly.
- [x] Write the migration exactly as spec Part C, steps 1 to 6.
  - The function guard searches `pg_proc.prosrc` in every schema except `pg_catalog` and `information_schema`.
  - `pg_depend` covers views, materialised views, rules and policies.
  - The trigger guard uses `NOT tgisinternal`.
  - It also checks foreign keys that point to the table, and publications.
- [x] Write the restore SQL:
  - recreate the table as `20260915000001` did, plus the captured grants;
  - copy the rows back, setting `customer_id` to null where the customer is gone, and skipping and listing any row whose user is gone.
- [x] Write the test harness.
  - **The script** starts the local PostgreSQL 17 cluster if needed (port 55432, as in `tasks/fix-function/2026-09-05-discovery-repairs/migration-approval.md`), creates a throwaway database, runs the SQL test with `ON_ERROR_STOP`, and always drops the database.
  - **The SQL test:**
    - sets up the live default privileges and stubs `auth.users`, `customers` and `update_updated_at_column`;
    - applies `20260915000001` and inserts synthetic rows covering every column, including nulls;
    - applies the retirement migration, and asserts archive equality, exact grants and that the source is gone;
    - runs the restore, and asserts the catalogue and rows equal the originals;
    - runs two negative tests (a view, and a plpgsql function reading the table), each of which must abort the migration with nothing changed.
- [x] Run the harness until it passes. Also run `npm run lint`, `npm test`, `npm run test:utc` and `npm run build`.
- [x] Commit as `chore: archive and drop the retired email_follow_ups table`.

### Task C2: Apply and verify

- [x] **Preconditions:** Plan B has been verified in production, and the bridge route returns 404.
- [x] Open a pull request and merge it. Apply the migration with `npx supabase db push` (history matches since PR #43).
- [x] Verify with read-only SQL:
  - the archive row count equals the final count (84 unless changed);
  - the source table is gone;
  - `information_schema.role_table_grants` shows `service_role` with SELECT only, and nothing for `anon` or `authenticated`.
- [x] Confirm the anon drift test still passes.
- [x] Add "Review the email_follow_ups_archive (90 days after the drop)" to `tasks/todo.md` as an unticked item.

## Results

- **Tests:** the throwaway-database harness passed all 54 assertions on PostgreSQL 17, including the restore and the two negative tests.
- **Main after both merges (2e85c16):** lint clean; 886 tests pass and 2 skip (the live anon checks) in London and in UTC; the build passes and lists no Follow-ups routes.
- **Merged:** PR #46 (merge 2e85c16), production deployment `HMupThzvRE5vPcWCfyAJbd8bQX9M` (SQL and tests only; the app did not change). After the deploy, `/login` returns 200 and `/api/cron/email-follow-ups` returns 404.
- **Applied:** `npx supabase db push` on 18 September at about 19:21 London time. Just before it, the live table held 84 rows, last written at 06:37:44 UTC, and no archive existed. The migration reported "Archived 84 email_follow_ups row(s); every column matches in both directions".
- **Verified with read-only SQL:** `public.email_follow_ups` is gone; `email_follow_ups_archive` holds 84 rows with 84 distinct ids and the same last update; RLS is on with no policies; the only grant is `service_role:SELECT`, with nothing for `anon` or `authenticated`; the table comment carries the snapshot date; `20260918105144` is recorded in live history and `migration list --linked` matches.
- **Anon check:** `SUPABASE_DB_URL` is not set locally, so the live test would skip. The same `ANON_CATALOGUE_QUERY` was run read-only through the Supabase connector and compared with `diffAnonAccess`: 52 entries, no findings, nothing stale.
- **Order changed:** this ran while Jordan's live handover was still going, before A13 (see Plan B's Results). The handover works from a frozen export, not the table, so it was unaffected.
- **Follow-up:** "Review the email_follow_ups_archive" is in `tasks/todo.md` for mid-December 2026.
