# Remediation Status — 2026-07-09 audit (FINAL)

Merged to main (207a767) and pushed to origin. Branch fix/audit-remediation-2026-07-09, 14 commits.
Verification: lint clean, 78/78 tests, build compiles. 3 additive migrations applied to live DB (hufxwovthhsjmtifvign) and verified.
Two adversarial regression-review rounds run; all confirmed regressions fixed.
The FF-001/FF-002 background sessions produced no committed work, so those (and their deferred siblings) were completed in this session once the files were free.

Totals: Fixed 55 | Deferred 1 (FF-054 only).

| ID | Sev | Status | Title | Note |
|----|-----|--------|-------|------|
| FF-001 | Critical | Fixed | Office365 pull creates tasks with invalid state 'todo', so new activ | commit 5ba4f56 |
| FF-002 | High | Fixed | Demote crons fire after the planning window opens during BST and wip | commit 3f9e340 |
| FF-003 | High | Fixed | Plan board drag-reorder rewrites every task's sort_order from stale  | commit 281fae7 |
| FF-004 | High | Fixed | Completed-items report uses projects.updated_at as the completion da | commit f43fcc2 |
| FF-005 | High | Fixed | TaskCard completed-state logic reads columns dropped by migration —  | commit 697e616 |
| FF-006 | High | Fixed | TaskDetailDrawer wipes the notes list and any unsaved note draft on  | commit e06554b |
| FF-007 | High | Fixed | Every task mutation dispatches tasks-changed which flips views into  | commit e06554b |
| FF-008 | High | Fixed | Projects view never refetches on tasks-changed: QuickCapture tasks i | commit e06554b |
| FF-009 | High | Fixed | office365-sync cron rejects Vercel's Authorization Bearer header, so | commit 545cb6f |
| FF-010 | High | Fixed | OAuth callback trusts an unsigned o365_oauth_user_id cookie as the u | commit 948ddb4 |
| FF-011 | High | Fixed | Expired or revoked Microsoft refresh token results in a permanently  | PARTIAL/NOTE: signalling+status+migration done; settings-UI wiring follow-up (545cb6f) |
| FF-012 | High | Fixed | Deleting a list in Microsoft To Do hard-deletes every local task in  | commit 5ba4f56 |
| FF-013 | High | Fixed | Completed report 'Copy to Clipboard' button is a stub that shows 'Co | commit 5866c88 |
| FF-014 | High | Fixed | Completed report never renders its error state — API failure shows m | commit 5866c88 |
| FF-015 | High | Fixed | 'Delete task' in the TaskCard three-dot menu permanently deletes wit | commit 697e616 |
| FF-016 | High | Fixed | Projects page has no mobile layout — fixed 280px sidebar leaves ~95p | commit bdbc616 |
| FF-017 | High | Fixed | 'Unassigned' sidebar entry is dead — clicking it shows the dashboard | commit bdbc616 |
| FF-018 | High | Fixed | Cron endpoints trust a client-settable x-vercel-cron header when CRO | commit 545cb6f |
| FF-019 | High | Fixed | Any weekly planning session is treated as the Sunday combined flow,  | commit 7ec2e55 |
| FF-020 | Medium | Fixed | Re-sending state:'done' for an already-done task re-stamps completed | commit 697e616 |
| FF-021 | Medium | Fixed | DB trigger overwrites Outlook completion timestamps with sync time | commit 697e616 |
| FF-022 | Medium | Fixed | A failed demote cron run can never retry the same day — one transien | commit 545cb6f |
| FF-023 | Medium | Fixed | Abandoning the Sunday combined flow after the weekly step silently l | commit 7ec2e55 |
| FF-024 | Medium | Fixed | Defer in the planning modal silently moves 'waiting' tasks to backlo | commit 7ec2e55 |
| FF-025 | Medium | Fixed | completed_at is client-writable independent of state, allowing done  | commit 697e616 |
| FF-026 | Medium | Fixed | Rate limiter is in-memory per serverless instance and keyed on a spo | PARTIAL/NOTE: user-id keying; distributed Redis out of scope (948ddb4) |
| FF-027 | Medium | Fixed | Idea promotion is non-atomic and unguarded — concurrent or retried p | commit f43fcc2 |
| FF-028 | Medium | Fixed | PATCH /api/ideas/[id] applies updates with no validation — invalid v | commit f43fcc2 |
| FF-029 | Medium | Fixed | Mass assignment on POST /api/tasks and POST /api/projects — client-s | commit f43fcc2 |
| FF-030 | Medium | Fixed | Journal cleanup endpoint has no rate limit and a check-then-act race | commit 948ddb4 |
| FF-031 | Medium | Fixed | POST /api/notes ignores idea_id, skips validateNote, and lets both p | commit f43fcc2 |
| FF-032 | Medium | Fixed | TodayView.handleUpdate applies optimistic edits with no rollback or  | commit e06554b |
| FF-033 | Medium | Fixed | PlanBoard backlog pagination collapses to the first 20 tasks after a | commit e06554b |
| FF-034 | Medium | Fixed | Refetch functions have no cancellation or latest-wins guard — out-of | commit e06554b |
| FF-035 | Medium | Fixed | PlanningModal computes sort_order via read-modify-write with a full  | commit 7ec2e55 |
| FF-036 | Medium | Fixed | Date-only strings compared as UTC midnight against the current insta | commit 281fae7 |
| FF-037 | Medium | Fixed | Calendar view freezes 'today' at mount, so overdue list, today highl | commit 281fae7 |
| FF-038 | Medium | Fixed | Client due-date status uses browser-local time (three divergent impl | commit 0a5995f |
| FF-039 | Medium | Fixed | Office365 inbound due-date conversion ignores the Graph timeZone fie | PARTIAL/NOTE: timezone conversion with fallback; confirm vs real Graph payload (5ba4f56) |
| FF-040 | Medium | Fixed | Sync fabricates a due date of 'today' for remote tasks that have non | commit 5ba4f56 |
| FF-041 | Medium | Fixed | No concurrency guard between cron, fire-and-forget auto-sync, and pe | PARTIAL/NOTE: per-user claimed-lock done (was partial) (5ba4f56) |
| FF-042 | Medium | Fixed | Pull-phase mapping insert failure (non-unique error) strands an unma | commit 5ba4f56 |
| FF-043 | Medium | Fixed | Quick-add inputs swallow creation failures with deliberate 'silently | commit 5866c88 |
| FF-044 | Medium | Fixed | Journal entries list has no loading state and load failures are cons | commit 5866c88 |
| FF-045 | Medium | Fixed | PlanningModal 'Finish Planning' failure is console-only — button app | commit 7ec2e55 |
| FF-046 | Medium | Fixed | Calendar drag-and-drop and drawer mutations revert silently — errors | commit 281fae7 |
| FF-047 | Medium | Fixed | QuickCapture floating button overlaps the mobile bottom tab bar, cov | commit bdbc616 |
| FF-048 | Medium | Fixed | Header ships dead UI: non-functional search box, permanent fake noti | commit 5866c88 |
| FF-049 | Medium | Fixed | Weekly planning-candidates filters make unfinished this_week tasks f | commit 7ec2e55 |
| FF-050 | Medium | Fixed | Demote crons record status='success' even when individual task updat | commit 3f9e340 |
| FF-051 | Medium | Fixed | PlanBoard backlog due-date-first ordering is wrong across pagination | commit 281fae7 |
| FF-052 | Medium | Fixed | Mid-session close of the planning modal shows inconsistent candidate | commit 7ec2e55 |
| FF-053 | Medium | Fixed | No cross-tab or multi-device refresh: data views never refetch on fo | commit e06554b |
| FF-054 | Medium | Deferred | No morning rollover: incomplete Today tasks stay in Today until the  | to redesign (Today-wipe semantics) |
| FF-055 | Low | Fixed | user-settings PATCH validates start!=end against hardcoded defaults  | commit 0a5995f |
| FF-056 | Low | Fixed | requestCache can re-cache stale data after clearCache, and deletePro | commit e06554b |

## Deferred
- FF-054 (Medium) morning rollover — belongs to the "stop wiping Today" redesign (Phase 2, Wave 1 A1 carry-forward).

## Follow-ups (non-blocking)
- FF-011: reconnect-needed status is exposed by the API; wiring the settings UI prompt is outstanding.
- FF-039: timezone conversion has a safe fallback; confirm against a real To Do payload / Prefer header.
- FF-041: push-side remote-orphan cleanup on unique violation is a separate candidate (serialisation itself is done).
- Legacy dead components (TaskItem.js, ProjectItem.js) still reference dropped columns — remove in a cleanup pass.
- Migrations were applied via Supabase MCP; a later `supabase db push` will re-run the idempotent files harmlessly.

## Migrations applied (additive, verified)
- 20260709000001 fn_task_state_cleanup COALESCE
- 20260709000002 office365_connections.sync_error/sync_error_at
- 20260709000003 projects.completed_at + trigger + backfill (82 rows)
