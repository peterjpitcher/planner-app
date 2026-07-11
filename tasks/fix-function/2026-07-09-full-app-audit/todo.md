# Audit Fix Implementation — todo

Base: 1b1122b. Excluded (in flight elsewhere): FF-001, FF-002.
Deferred (only fixable in in-flight files office365SyncService.js / demote crons): FF-012, FF-039, FF-042, FF-050 — plus FF-011/FF-021/FF-022/FF-041 partials where they reach into excluded files.
Policy: risky fixes & migrations pre-approved. New migrations are written as files (timestamp > 20260414000001) but NOT applied to the live DB by me — flagged for `db push`.

Batches (sequential, single-owner, verify+commit each):

- [x] B1 DATA-FETCH/refetch architecture: FF-006, FF-007, FF-008, FF-032, FF-033, FF-034, FF-053, FF-056 — commit e06554b
- [x] B2 COMPLETION/done-state: FF-005, FF-015, FF-020, FF-025, FF-021(migration ...000001) — commit 697e616
- [x] B3 PLANNING modal+candidates: FF-019, FF-023, FF-024, FF-035, FF-045, FF-049, FF-052 — commit 7ec2e55
- [x] B4 PLANBOARD sort + CALENDAR dates: FF-003, FF-051, FF-036, FF-037, FF-046 — commit 281fae7
- [x] B5 CRON/O365 status+auth: FF-009, FF-018, FF-011, FF-022, FF-041(partial) — commit 545cb6f (migration ...000002)
- [x] B6 API validation/promote/reporting: FF-004, FF-027, FF-028, FF-029, FF-031 — commit f43fcc2 (migration ...000003). FF-054 DEFERRED to redesign.
- [x] B7 PERIPHERY (6 parallel agents): FF-010, FF-013, FF-014, FF-016, FF-017, FF-026(partial), FF-030, FF-038, FF-043, FF-044, FF-047, FF-048, FF-055 — commits 948ddb4, 0a5995f, 5866c88, bdbc616
- DEFERRED (excluded in-flight files): FF-012, FF-039, FF-040, FF-042, FF-050 — need office365SyncService.js / demote crons. FF-054 deferred to redesign.

Migrations APPLIED to live DB (hufxwovthhsjmtifvign) and verified:
- [x] 20260709000001_fix_completed_at_coalesce.sql — fn_task_state_cleanup COALESCE
- [x] 20260709000002_office365_sync_error.sql — sync_error/sync_error_at columns
- [x] 20260709000003_project_completed_at.sql — column+trigger+backfill (82 completed projects backfilled)

Verification: lint clean, 74/74 tests, build succeeds.
[x] Adversarial regression review of full diff — found 7 regressions, all fixed (b9f0773) + 1 hardening (6c3a545); re-review CLEAN.

DONE. 48 fixed / 6 deferred / 2 in other sessions. See remediation-summary.md.
Branch fix/audit-remediation-2026-07-09, 12 commits on 1b1122b. Migrations applied to live DB.

Phase 2 (planner-automation redesign) = separate, wave-by-wave with per-wave approval (user's choice). Not started. See docs/superpowers/brainstorms/2026-07-09-planning-automation-opportunities.md.

Verification gate per batch: npm run lint + npm test; full lint→test→build at the end.
Final: adversarial review of the whole diff, fix regressions, update discovery.md statuses.
