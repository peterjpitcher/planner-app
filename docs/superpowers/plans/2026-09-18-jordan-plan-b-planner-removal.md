# Plan B: Remove Follow-ups from Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the implement-plan skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the email Follow-ups page, API, machine bridge and helpers from Planner once Jordan no longer uses them.

**Architecture:** Deletion only, plus two documentation edits. The table stays until Plan C.

**Tech Stack:** Next.js 15.5, React 19, plain JavaScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-18-jordan-outlook-drafts-design.md`, Part B.

**Linked plans:** Starts after Plan A Task A13. Plan C follows.

## Global Constraints

- **Branch:** `chore/remove-email-follow-ups` from `origin/main` (59c39a3), in the worktree `.claude/worktrees/remove-email-follow-ups`.
- **Leave alone:** `resolveDigestUserId`, `addDaysToDateKey`, `getLondonDateKey`, `verifyCronAuth`, `isValidEmail`, the Waiting-task `follow_up_date` feature and the migration file.
- **Gates:** `npm run lint` (zero warnings), `npm test`, `npm run test:utc`, `npm run build`.

---

### Task B1: Delete the feature and its references

**Files:**
- Delete:
  - `src/app/email-follow-ups/page.js`
  - `src/components/emailFollowUps/FollowUpList.jsx`
  - `src/components/emailFollowUps/__tests__/FollowUpList.test.jsx`
  - `src/app/api/email-follow-ups/route.js`
  - `src/app/api/email-follow-ups/[id]/route.js`
  - `src/app/api/cron/email-follow-ups/route.js`
  - `src/services/emailFollowUpService.js`
  - `src/services/__tests__/emailFollowUpService.test.js`
  - `src/lib/outlookWebLink.js`
  - `src/lib/__tests__/outlookWebLink.test.js`
- Modify:
  - `src/components/layout/Sidebar.jsx` (lines 14 and 30)
  - `src/lib/apiClient.js` (768 to 799)
  - `src/lib/constants.js` (108 to 140, 266 to 273)
  - `src/lib/validators.js` (the import on line 3; `validateEmailFollowUp`, 350 to 408)
  - `CLAUDE.md` (lines 72 and 88)
  - `docs/codebase-map.md` (lines 13, 25, 43 and 83)

- [ ] Delete the ten files. Remove each block, and remove the imports that only those blocks used (keep `isValidEmail`).
- [ ] Run a case-sensitive `git grep -n -E 'email_follow_ups|email-follow-ups|EMAIL_FOLLOWUPS|emailFollowUp|FOLLOWUP_|FollowUpList|outlookWebLink|Follow-ups' -- src supabase CLAUDE.md docs/codebase-map.md`. The only allowed hits are `supabase/migrations/20260915000001_email_follow_ups.sql` and `src/lib/noteTasks.js:21`.
- [ ] Run the four gates. The build route list must not include `/email-follow-ups`, `/api/email-follow-ups`, `/api/email-follow-ups/[id]` or `/api/cron/email-follow-ups`.
- [ ] Commit:
  - the spec, the review and the three plans, as `docs:`;
  - the removal, as `chore: remove the email Follow-ups feature from Planner`.

### Task B2: Pull request, merge, deploy and verify

- [ ] **Precondition:** every Jordan run since the cutover has logged the new prompt's hash (Plan A13).
- [ ] Push, then open a pull request that records the assumptions and the paired-repository note (none: the website does not use this feature).
- [ ] Merge to main (Vercel deploys), then record the deployment.
- [ ] Verify: `GET` and `POST /api/cron/email-follow-ups` with no credentials return 404 (previously 401). `/email-follow-ups` signed out still returns 307 to `/login`.
- [ ] Tidy: delete the local branches `feat/follow-ups-tracker`, `feat/followups-table` and `chore/remove-email-follow-ups` (after the merge). Never delete `feat/email-follow-ups` or `chore/agent-instruction-files`.
- [ ] Peter's actions: remove `EMAIL_FOLLOWUPS_USER_ID` and `EMAIL_FOLLOWUPS_USER_EMAIL` in all three Vercel environments, and confirm there is no Follow-ups link in the sidebar when he is signed in.
