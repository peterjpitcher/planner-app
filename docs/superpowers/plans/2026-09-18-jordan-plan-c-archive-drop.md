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

- [ ] Capture the live catalogue with read-only SQL: the table's grants, indexes, trigger, policy and RLS flag. Save it as a comment block in the restore SQL, and write the grants explicitly.
- [ ] Write the migration exactly as spec Part C, steps 1 to 6.
  - The function guard searches `pg_proc.prosrc` in every schema except `pg_catalog` and `information_schema`.
  - `pg_depend` covers views, materialised views, rules and policies.
  - The trigger guard uses `NOT tgisinternal`.
  - It also checks foreign keys that point to the table, and publications.
- [ ] Write the restore SQL:
  - recreate the table as `20260915000001` did, plus the captured grants;
  - copy the rows back, setting `customer_id` to null where the customer is gone, and skipping and listing any row whose user is gone.
- [ ] Write the test harness.
  - **The script** starts the local PostgreSQL 17 cluster if needed (port 55432, as in `tasks/fix-function/2026-09-05-discovery-repairs/migration-approval.md`), creates a throwaway database, runs the SQL test with `ON_ERROR_STOP`, and always drops the database.
  - **The SQL test:**
    - sets up the live default privileges and stubs `auth.users`, `customers` and `update_updated_at_column`;
    - applies `20260915000001` and inserts synthetic rows covering every column, including nulls;
    - applies the retirement migration, and asserts archive equality, exact grants and that the source is gone;
    - runs the restore, and asserts the catalogue and rows equal the originals;
    - runs two negative tests (a view, and a plpgsql function reading the table), each of which must abort the migration with nothing changed.
- [ ] Run the harness until it passes. Also run `npm run lint`, `npm test`, `npm run test:utc` and `npm run build`.
- [ ] Commit as `chore: archive and drop the retired email_follow_ups table`.

### Task C2: Apply and verify

- [ ] **Preconditions:** Plan B has been verified in production, and the bridge route returns 404.
- [ ] Open a pull request and merge it. Apply the migration with `npx supabase db push` (history matches since PR #43).
- [ ] Verify with read-only SQL:
  - the archive row count equals the final count (84 unless changed);
  - the source table is gone;
  - `information_schema.role_table_grants` shows `service_role` with SELECT only, and nothing for `anon` or `authenticated`.
- [ ] Confirm the anon drift test still passes.
- [ ] Add "Review the email_follow_ups_archive (90 days after the drop)" to `tasks/todo.md` as an unticked item.
