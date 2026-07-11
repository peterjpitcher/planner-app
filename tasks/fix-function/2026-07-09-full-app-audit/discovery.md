# Fix-Function Audit — Full-App Discovery Report

- **Date:** 2026-07-09
- **Mode:** Read-only Diagnosis (no fixes applied)
- **Base commit:** `1b1122b` (`1b1122b7833865a55d51da419c3c3b657346591d`, branch `fix/quickcapture-refetch`)
- **Method:** 8 parallel discovery dimensions — lifecycle, security, api-contracts, client-data, dates, office365, ui-states, and prior-QA-report mining — with every Critical/High/Medium finding adversarially verified by an independent agent; 72 agents in total. Findings below are the deduplicated, confirmed defect log.

## Totals (after dedupe)

| Severity | Confirmed findings |
|---|---|
| Critical | 1 |
| High | 18 |
| Medium | 35 |
| Low | 2 |
| **Total confirmed** | **56** |

Raw pipeline output: 63 confirmed findings deduplicated to 56 (7 cross-dimension duplicates merged, richest evidence kept); 1 unverified Low folded into its confirmed counterpart (FF-055); 17 unverified Low-severity findings listed separately; 1 finding refuted during verification.

## Confirmed findings

### FF-001 — Office365 pull creates tasks with invalid state 'todo', so new active Outlook tasks never import (Critical)
- **Type / Dimension:** bug / lifecycle
- **Files:** src/services/office365SyncService.js:642; supabase/migrations/20260404000001_prioritisation_replacement.sql:151
- **Evidence:** The pull path inserts `state: remoteIsCompleted ? 'done' : 'todo'` (office365SyncService.js:642), but the DB constraint tasks_state_check only allows today/this_week/backlog/waiting/done (migration line 151-152), and STATE in src/lib/constants.js:13-19 has no 'todo'. The insert error is swallowed with console.warn and `continue` (lines 655-658).
- **Impact:** Every non-completed task created in Outlook fails to import into the planner, silently, on every minute of the office365-sync cron (vercel.json schedule '* * * * *'). Only already-completed Outlook tasks sync in.
- **Root cause:** The state value was not updated when the priority model was replaced by the five-state model; 'todo' is a leftover from the old vocabulary.
- **Siblings checked:** The pull-update path (lines 779-789) correctly uses only 'done'; outbound mapping (lines 65, 190) correctly maps state==='done' to Graph 'completed'. No other invalid state literals found (grep for 'todo' matched only line 642).
- **Recommended fix:** Change line 642 to `state: remoteIsCompleted ? 'done' : 'backlog'` and surface insert failures in the sync summary instead of only console.warn.
- **Acceptance criteria:** A pull of a new, uncompleted Outlook task inserts a local task with state='backlog' (insert succeeds against tasks_state_check), and any pull insert failure appears in the sync summary rather than only console.warn.
- **Approval bucket:** Risky (needs approval) — one-line change, but it alters Office365 import behaviour — previously-unimported Outlook tasks will flood in on the first sync after the fix

### FF-002 — Demote crons fire after the planning window opens during BST and wipe the plan the user just made (High)
- **Type / Dimension:** bug / lifecycle + dates
- **Files:** vercel.json:14; src/app/api/cron/demote-today-tasks/route.js:28; src/app/api/cron/demote-week-tasks/route.js:35; src/components/planning/PlanningTaskRow.jsx:73; vercel.json:12; src/app/api/cron/demote-today-tasks/route.js:27; src/app/api/cron/demote-week-tasks/route.js:34; src/lib/constants.js:66
- **Merged duplicates:** "Demote crons fire inside the 20:05 London planning window during BST and wipe freshly planned tasks" (dates, High)
- **Evidence:** Both demote crons are scheduled '55 19 * * *' (UTC), which is 20:55 London in summer; the route gate accepts any London hour 19-20 (demote-today route.js:28, demote-week route.js:35). The daily planning window opens at 20:05 London (PLANNING_DEFAULTS in constants.js:66-71) and assigning a task in the modal sets state:'today' immediately (PlanningTaskRow.jsx:73); demote-today then moves ALL state='today' tasks to this_week (route.js:65-103). [Independently confirmed by the dates dimension:] vercel.json schedules demote-today-tasks and demote-week-tasks once at 55 19 * * * (UTC), and each route's guard accepts London hours 19 OR 20 (demote-today-tasks/route.js:28, demote-week-tasks/route.js:35). During BST 19:55 UTC is 20:55 London, but the daily/weekly planning windows open at 20:05 London (constants.js:66-71, getActivePlanningWindow) and planning assignment sets state:'today' immediately (PlanningTaskRow.jsx:73). The design doc (docs/superpowers/plans/2026-04-14-smart-planning-prompts.md:142-207) specifies dual schedules at 55 18 and 55 19 UTC so demotion completes before 20:05; only the 19:55 schedule was shipped.
- **Impact:** In BST, any daily plan made between 20:05 and ~20:55 is silently demoted back to this_week at 20:55, leaving the Today view empty next morning. On Sundays demote-week equally moves the just-accepted weekly plan (state 'this_week', PlanningTaskRow.jsx:87) to backlog.
- **Root cause:** A fixed UTC cron schedule combined with a two-hour-wide London-hour tolerance means the run drifts to after the 20:05 window start under DST; the cron has no awareness of a completed planning session.
- **Siblings checked:** daily-task-email cron already uses the dual-schedule + exact-hour pattern; office365-sync runs every minute so is unaffected. Only the two demote crons have the loose gate.
- **Recommended fix:** Use the pattern already proven in daily-task-email (two UTC schedules + exact London-hour gate, daily-task-email/route.js:18-20): schedule '55 18 * * *' and '55 19 * * *' and gate on londonHour === 19 && minute >= 55, or skip demotion when a planning_sessions row exists for tomorrow. [From the merged duplicate:] Add the second schedule (55 18 * * *) for both demote crons per the original plan — the existing claimCronRun idempotency claim already prevents the duplicate 20:55-London run from executing. Optionally tighten the hour guard so the demote never runs at London hour 20 once dual schedules exist.
- **Acceptance criteria:** During BST, both demote crons execute at 19:55 London (before the 20:05 planning window opens) and a task planned into today/this_week during the evening session is still there the next morning.
- **Approval bucket:** Safe fix

### FF-003 — Plan board drag-reorder rewrites every task's sort_order from stale neighbour values, corrupting the persisted order (High)
- **Type / Dimension:** bug / lifecycle
- **Files:** src/components/plan/PlanBoard.jsx:526; src/lib/sortOrder.js:9
- **Evidence:** After a same-column drag, PlanBoard maps over ALL tasks and sets each one's sort_order to computeSortOrder(prevNeighbour.sort_order, nextNeighbour.sort_order) using the neighbours' OLD values (PlanBoard.jsx:526-533). For [A=1000,B=2000,C=3000], moving B to top persists B=0, A=2500, C=2000, which sorts as B,C,A instead of the intended B,A,C.
- **Impact:** Nearly every drag reorder on /plan stores a different order than the user chose; the corruption becomes visible on the next refetch (any mutation fires 'tasks-changed' which reloads columns from the server, PlanBoard.jsx:272-280). Errors are also swallowed (`.catch(() => {})`, line 534).
- **Root cause:** computeSortOrder is designed for inserting ONE item between two others, but the code applies it to every row simultaneously against un-updated neighbour values, so the computed values are mutually inconsistent.
- **Siblings checked:** TodayView.jsx:353-367 implements this correctly for today sections. No other reorder sites exist (grep for computeSortOrder).
- **Recommended fix:** Copy the correct TodayView pattern (TodayView.jsx:353-367): compute a new sort_order only for the moved task from its new neighbours, and fall back to reindex() when the gap is too small; PlanBoard also never calls needsReindex so duplicate values accumulate.
- **Acceptance criteria:** After a same-column drag in PlanBoard, only the moved task's sort_order changes (or an explicit reindex runs); reloading the page reproduces the dropped order exactly.
- **Approval bucket:** Safe fix

### FF-004 — Completed-items report uses projects.updated_at as the completion date — completed projects drift between reporting periods (High)
- **Type / Dimension:** data-risk / api-contracts + lifecycle
- **Files:** src/app/api/completed-items/route.js:40; supabase/migrations/20250707_initial_schema.sql:101; src/services/taskService.js:107; src/services/taskService.js:106
- **Merged duplicates:** "Completed-projects report keys off updated_at, which churns constantly, so projects appear in or vanish from the wrong month" (lifecycle, Medium)
- **Evidence:** completed-items/route.js:40-47 filters completed projects by `updated_at` between startDate/endDate; the projects table has no completed_at column (initial_schema.sql:95-105). taskService bumps the parent project's updated_at on every task create/update/delete (taskService.js:107-111, 238-243, 314-319), and handle_projects_updated_at bumps it on any project edit. [Independently confirmed by the lifecycle dimension:] The report selects projects with status='Completed' filtered by updated_at between startDate/endDate (completed-items/route.js:40-47). But projects.updated_at is bumped by every task create/update/delete touch (taskService.js:106-111, 238-243, 314-319) and by the every-minute Office365 sync (office365SyncService.js:714-717, 805-808, 890-893; vercel.json '* * * * *'); the projects table has no completed timestamp (initial_schema.sql:92-104) and the PATCH route never records one.
- **Impact:** A project completed in one month appears in a later month's report (or vanishes from its own month) as soon as the project or any of its tasks is touched again. Monthly completion reports and CSV exports are silently wrong.
- **Root cause:** updated_at is used as a proxy for completion time because projects never got a completed_at column, while unrelated writes constantly move updated_at.
- **Siblings checked:** Tasks in the same route are correctly filtered on completed_at (maintained by the fn_task_state_cleanup trigger), confirming projects are the odd one out.
- **Recommended fix:** Add projects.completed_at, set/clear it when status transitions to/from 'Completed' (route or trigger, mirroring fn_task_state_cleanup), backfill from updated_at, and filter the report on it.
- **Acceptance criteria:** A project completed in month M still appears in month M's completed report after later task edits or Office365 syncs bump its updated_at (report filters on projects.completed_at).
- **Approval bucket:** Risky (needs approval) — requires a schema migration (new projects.completed_at column) plus a backfill from updated_at

### FF-005 — TaskCard completed-state logic reads columns dropped by migration — completed tasks render as incomplete and cannot be un-completed (High)
- **Type / Dimension:** bug / ui-states + client-data
- **Files:** src/components/shared/TaskCard.jsx:166; src/app/api/tasks/route.js:9; supabase/migrations/20260404000001_prioritisation_replacement.sql:140; src/components/today/TodayView.jsx:187-224; src/components/plan/PlanBoard.jsx:327-341; src/services/taskService.js:69; src/components/today/TodayView.jsx:187; src/components/plan/PlanBoard.jsx:327
- **Merged duplicates:** "TaskCard completed detection uses removed fields, so 'Completed today' renders as incomplete and un-complete is impossible" (client-data, High)
- **Evidence:** TaskCard.jsx:166 computes `isCompleted = task.is_completed || task.status === 'completed'`, but TASK_SELECT_FIELDS (api/tasks/route.js:9) returns neither field, and the migration at line 140 executed `ALTER TABLE public.tasks DROP COLUMN IF EXISTS is_completed`. Tasks in TodayView's 'Completed today' list therefore render with unchecked checkboxes, no strikethrough, and a menu reading 'Complete' instead of 'Un-complete'; TodayView.handleComplete always sends `{ state: 'done' }` so clicking it on a done task is a no-op. [Independently confirmed by the client-data dimension:] TaskCard.jsx:166 computes isCompleted from `task.is_completed || task.status === 'completed'`, but the tasks API select list (tasks/route.js:9) returns neither field and taskService.js:69 deletes is_completed on writes. TodayView renders done tasks in the 'Completed today' list through TaskCard, and TodayView.handleComplete (TodayView.jsx:187-224) unconditionally sends state:'done'.
- **Impact:** Completed tasks in the Today view look identical to open ones, and there is no working way to undo an accidental completion from any card. PlanBoard's un-complete branch (wasCompleted → backlog, line 327-341) is dead code, and it sends the non-existent `is_completed` field in updates (silently stripped by filterTaskUpdates).
- **Root cause:** The is_completed/status → state schema migration was not propagated to TaskCard and the complete handlers.
- **Siblings checked:** Checked all TaskCard consumers (TodayView, PlanBoard, ProjectWorkspace, DragOverlay) — all pass tasks from the same API so none can ever set isCompleted true.
- **Recommended fix:** Derive completion from `task.state === 'done'` (or completed_at) in TaskCard, and make TodayView/PlanBoard handleComplete toggle state between 'done' and the prior state instead of unconditionally sending 'done'.
- **Acceptance criteria:** A task with state='done' renders as completed in TaskCard/PlanBoard, and activating its checkbox returns it to a non-done state (toggle works both ways).
- **Approval bucket:** Safe fix

### FF-006 — TaskDetailDrawer wipes the notes list and any unsaved note draft on every field save (High)
- **Type / Dimension:** bug / client-data
- **Files:** src/components/shared/TaskDetailDrawer.jsx:137; src/components/shared/TaskDetailDrawer.jsx:151; src/components/today/TodayView.jsx:283; src/components/plan/PlanBoard.jsx:407; src/components/calendar/CalendarView.jsx:146; src/components/Projects/ProjectsView.jsx:265
- **Evidence:** The sync effect (TaskDetailDrawer.jsx:137-161) runs on every `task` object identity change and calls setNotes([]) and setNewNoteContent('') at lines 151-152, but only refetches notes when task.id changed (156-159). Every parent (TodayView.jsx:283, PlanBoard.jsx:407, CalendarView.jsx:146-148, ProjectsView.jsx:265) replaces selectedTask with a new object on each optimistic field update.
- **Impact:** Blur-saving any field (description, chip toggle, due date, etc.) makes the notes section flip to 'No notes yet.' and silently discards a note the user was typing; notes only reappear after closing and opening a different task.
- **Root cause:** The reset effect is keyed on the task object reference rather than task.id, while the notes refetch is gated by prevTaskIdRef, so resets fire without a reload.
- **Siblings checked:** Checked all four drawer hosts (Today, Plan, Calendar, Projects) — every one triggers the reset because each does setSelectedTask({...prev, ...updates}) optimistically before the PATCH resolves.
- **Recommended fix:** Split the effect: reset field state on task.id change only (and fetch notes there), and merge non-destructive field syncs separately so notes/newNoteContent survive same-task updates.
- **Acceptance criteria:** Editing and saving any task field in the drawer leaves the visible notes list and an unsaved note draft intact; notes only reset/refetch when task.id changes.
- **Approval bucket:** Safe fix

### FF-007 — Every task mutation dispatches tasks-changed which flips views into full loading state — spinner/skeleton flash and 3-4 extra GETs per checkbox tick (High)
- **Type / Dimension:** performance / client-data
- **Files:** src/lib/apiClient.js:172; src/components/today/TodayView.jsx:114; src/components/today/TodayView.jsx:444; src/components/calendar/CalendarView.jsx:46; src/components/calendar/CalendarView.jsx:217
- **Evidence:** createTask/updateTask/deleteTask dispatch 'tasks-changed' (apiClient.js:172, 191, 199); TodayView's listener (173-181) calls loadData which sets isLoading(true) at line 114, and the render returns a full skeleton whenever isLoading (444-455). CalendarView.fetchTasks (44-57) sets isLoading and the render swaps the whole calendar for a spinner (217-223), and it re-pages ALL tasks via getAllTasks (apiClient.js:111-133). loadData also refires the waiting-tasks fetch, so one checkbox tick costs 3 GETs.
- **Impact:** Every complete, drag-to-date, or field edit makes the entire view flash to skeleton/spinner, destroying the optimistic update the code just applied, and multiplies request volume (heading towards the 120 req/min tasks-get rate limit during planning sessions).
- **Root cause:** The fix/quickcapture-refetch approach refetches everything on every mutation, but the load functions reuse the initial-load loading flag instead of doing a background revalidation.
- **Siblings checked:** PlanBoard avoids the flash (skeleton only when column empty, PlanBoard.jsx:568) but still refires 4 column GETs per mutation; PlanningModal assignments (PlanningModal.jsx:99) each dispatch the event, so the page behind the modal reloads on every pill tap.
- **Recommended fix:** Only set isLoading on first load (e.g. skip when data already present), or refetch silently in the mutation handlers; ideally scope refetches to the affected state list rather than everything.
- **Acceptance criteria:** Ticking a task checkbox never blanks the current view with a full skeleton/spinner, and triggers at most one silent refetch of the affected list.
- **Approval bucket:** Safe fix

### FF-008 — Projects view never refetches on tasks-changed: QuickCapture tasks invisible and project reassignment leaves tasks grouped under the old project (High)
- **Type / Dimension:** bug / client-data + known-issues
- **Files:** src/components/Projects/ProjectsView.jsx:105; src/components/Projects/ProjectsView.jsx:255; src/components/Projects/ProjectsView.jsx:233; src/components/layout/AppShell.jsx:109; src/components/ideas/IdeaVault.jsx:57; src/lib/apiClient.js:290
- **Merged duplicates:** "QuickCapture refresh fix does not cover the Projects and Ideas views" (known-issues, Medium)
- **Evidence:** ProjectsView only loads data on mount (line 105) and registers no 'tasks-changed' listener, yet QuickCapture is mounted on /projects (AppShell.jsx:13,109) and createTask dispatches the event. handleUpdateTask (255-271) maps updates in place without regrouping tasksByProject, and handleMoveTask (233-253) updates tasksByProject but never touches unassignedTasks. [Independently confirmed by the known-issues dimension:] The bug #4 fix (commit 65e42ea) makes apiClient dispatch 'tasks-changed' on task mutations, but ProjectsView only loads data on mount and after its own mutations (line 105, no event listener), and IdeaVault only loads on mount (lines 57-59). apiClient.createIdea (lines 290-296) dispatches no event at all, and QuickCapture is rendered on /projects and /ideas (AppShell.jsx:13, 109).
- **Impact:** A task captured via QuickCapture while on the Projects page never appears; reassigning a task to another project via the drawer leaves it listed under the old project (and unassigned tasks moved via the menu stay stale) until a full page reload. Same gap on /ideas: IdeaVault (57-59) never refreshes when QuickCapture creates an idea.
- **Root cause:** The refetch-on-mutation fix (branch fix/quickcapture-refetch) added listeners to TodayView, PlanBoard and CalendarView but not ProjectsView or IdeaVault, and the optimistic handlers do not re-derive grouping keys.
- **Siblings checked:** Checked all TAB_ROUTES surfaces: Today/Plan/Calendar listen for tasks-changed; Projects and Ideas do not. QuickCapture.jsx:83 createIdea dispatches no event at all (apiClient.createIdea has no dispatch).
- **Recommended fix:** Add a 'tasks-changed' listener in ProjectsView that reloads (or regroup on project_id change in handleUpdateTask and include unassignedTasks in handleMoveTask); dispatch and listen for an equivalent 'ideas-changed' event for IdeaVault.
- **Acceptance criteria:** A task created via QuickCapture on /projects appears in the Projects view without a manual reload; a new idea appears in IdeaVault without reload; reassigning a task regroups it under its new project.
- **Approval bucket:** Safe fix

### FF-009 — office365-sync cron rejects Vercel's Authorization Bearer header, so the every-minute background sync 401s (High)
- **Type / Dimension:** bug / office365
- **Files:** src/app/api/cron/office365-sync/route.js:11-23; src/lib/cronAuth.js:32-34; vercel.json
- **Evidence:** The route implements its own inline auth reading only the x-cron-secret header (lines 13, 16-19) and does not use verifyCronAuth. Commit 55f48bf ('accept Authorization Bearer header for CRON_SECRET auth') states CRON_SECRET is set in Vercel prod and Vercel sends it as Authorization: Bearer, but that fix only patched src/lib/cronAuth.js (git show --stat confirms 1 file changed). vercel.json schedules this route every minute.
- **Impact:** Scheduled background sync never runs — every Vercel cron invocation returns 401. Sync only happens as a side-effect of the user loading /api/tasks, so changes made in Microsoft To Do while the app is closed never arrive.
- **Root cause:** The Bearer-auth fix was applied to the shared verifyCronAuth helper, but this route has a duplicated inline auth check that was never updated.
- **Siblings checked:** Grepped all four cron routes: daily-task-email, demote-today-tasks and demote-week-tasks all import verifyCronAuth; office365-sync is the only one with its own inline check.
- **Recommended fix:** Replace the inline check with verifyCronAuth from src/lib/cronAuth.js (as the other three cron routes do), or add the Bearer fallback to the inline check.
- **Acceptance criteria:** A request to /api/cron/office365-sync carrying Authorization: Bearer <CRON_SECRET> returns 200 and executes the sync (parity with the other three cron routes via verifyCronAuth).
- **Approval bucket:** Risky (needs approval) — auth-check change on a cron endpoint, albeit aligning with the already-shipped verifyCronAuth Bearer fix (55f48bf)

### FF-010 — OAuth callback trusts an unsigned o365_oauth_user_id cookie as the user identity (High)
- **Type / Dimension:** security / office365
- **Files:** src/app/api/integrations/office365/callback/route.js:44-46; src/app/api/integrations/office365/connect/route.js:59
- **Evidence:** callback/route.js line 46: `const userId = session?.user?.id || userIdCookie;` — when no NextAuth session is present, identity comes from a plain, unsigned cookie. The state and PKCE verifier are also just cookies, so an attacker running the flow in their own browser controls all three values sent to the callback.
- **Impact:** An unauthenticated attacker who knows a victim's user UUID can complete the Microsoft consent flow with their own Microsoft account while sending crafted state/verifier/user_id cookies, binding their Microsoft account to the victim's planner account. The cron then syncs all the victim's projects and tasks into the attacker's Microsoft To Do (exfiltration) and injects attacker tasks into the victim's planner.
- **Root cause:** The user_id cookie was added as a fallback for session loss across the cross-site OAuth redirect, but it is not signed or bound to the server-issued state, so it degrades authentication to a client-supplied value.
- **Siblings checked:** Checked the other office365 routes (connect, disconnect, status, sync): all correctly require getServerSession; only the callback has this fallback.
- **Recommended fix:** Drop the cookie fallback and require session.user.id in the callback, or HMAC-sign the (state, userId) pair in the connect route and verify the signature in the callback.
- **Acceptance criteria:** The OAuth callback binds tokens only to an authenticated NextAuth session (or an HMAC-verified state/userId pair); a request presenting only a tampered o365_oauth_user_id cookie is rejected.
- **Approval bucket:** Risky (needs approval) — auth flow change

### FF-011 — Expired or revoked Microsoft refresh token results in a permanently dead sync with no user-visible signal (High)
- **Type / Dimension:** ux-gap / office365
- **Files:** src/services/office365ConnectionService.js:113-131; src/services/office365SyncService.js:1143-1150; src/app/api/cron/office365-sync/route.js:43-46; src/app/api/integrations/office365/status/route.js:13-19
- **Evidence:** When refreshOffice365AccessToken fails (e.g. invalid_grant after 90-day inactivity or revocation), getValidOffice365AccessToken throws; the cron route and maybeAutoSyncOffice365 both catch and only console.warn/console.error. Grep confirms sync_enabled is written true in exactly one place (office365ConnectionService.js:68) and never set false, and no error/status column is ever written.
- **Impact:** Every automatic sync fails forever while the status endpoint keeps reporting connected: true — the user sees a healthy integration while local and Microsoft data silently diverge. The only clue is a stale lastSyncedAt.
- **Root cause:** All auto-sync entry points swallow token errors, and the connection row has no failure state (no sync_error column, no disable-on-auth-failure logic), so a permanent auth failure is indistinguishable from a healthy connection.
- **Siblings checked:** The manual POST /api/integrations/office365/sync does return a 500, but only with the generic text 'Office365 sync failed'; no path records or exposes the auth-failure reason.
- **Recommended fix:** On a non-retryable token error (invalid_grant/interaction_required), persist an error state on office365_connections (e.g. sync_error + sync_error_at, or sync_enabled=false with a reason) and surface it via the status endpoint so the UI can prompt reconnection.
- **Acceptance criteria:** After a simulated invalid_grant, office365_connections records a persistent error state and the integration status endpoint/UI shows a reconnect prompt instead of retrying silently forever.
- **Approval bucket:** Risky (needs approval) — needs new connection-state columns and changes sync retry semantics

### FF-012 — Deleting a list in Microsoft To Do hard-deletes every local task in that project (High)
- **Type / Dimension:** data-risk / office365
- **Files:** src/services/office365SyncService.js:403-425; src/services/office365SyncService.js:856-895
- **Evidence:** ensureProjectList handles a 404 on the remote list by creating a new empty list and repointing office365_project_lists.list_id (lines 408-422), but the task mappings still carry the old list_id/todo_task_id. The two-way delete loop (856-895) then finds those keys absent from remoteTodoTaskKeys, todoTaskExists returns false (404 on the deleted list), and every local task is hard-deleted from the tasks table (876-880), cascading away the mappings via the task_id FK.
- **Impact:** A user tidying up Microsoft To Do by deleting a list permanently loses all of that project's tasks in the planner — there is no soft delete or recovery. The recreated empty list proves the intent was to preserve and re-push the project, so this is unintended data loss, not the designed per-task two-way delete.
- **Root cause:** List recreation runs before the deletion-detection pass but does not migrate or invalidate the stale task mappings, so remote list deletion is misread as individual remote task deletions.
- **Siblings checked:** The per-task 404 paths (ensureTaskItem line 524, push phase line 1078) correctly recreate rather than delete; only the list-level 404 path funnels into local deletion.
- **Recommended fix:** When ensureProjectList recreates a list after a 404, delete (or re-key) the office365_task_items rows for that list and skip the remote-deletion pass for those tasks so they are re-pushed to the new list instead of deleted locally.
- **Acceptance criteria:** When the remote To Do list has been deleted (404), local tasks are re-pushed to the recreated list; no local task rows are deleted as a consequence of the remote list vanishing.
- **Approval bucket:** Risky (needs approval) — changes Office365 deletion-sync semantics; failure mode is irreversible data loss

### FF-013 — Completed report 'Copy to Clipboard' button is a stub that shows 'Copied!' without copying anything (High)
- **Type / Dimension:** bug / ui-states
- **Files:** src/app/completed-report/page.js:146-149; src/app/completed-report/page.js:250-253
- **Evidence:** handleCopyReport contains only `// Simplified copy logic for brevity`, `setCopyStatusMessage('Copied!')` and a 2s reset timeout — there is no navigator.clipboard call or any report-serialisation logic anywhere in the file. The button at line 250 renders this handler with a clipboard icon.
- **Impact:** The user clicks the primary action on the Reports page, sees a success confirmation ('Copied!'), and pastes nothing. False success feedback makes the failure invisible.
- **Root cause:** The copy implementation was removed during a refactor (the in-file comments admit render logic was 'simplified for brevity') and never restored.
- **Siblings checked:** Checked other clipboard usages — none exist elsewhere in src/, this is the only copy feature.
- **Recommended fix:** Reimplement report serialisation from groupItems and write it via navigator.clipboard.writeText, setting 'Copied!' only after the promise resolves and showing an error message on rejection.
- **Acceptance criteria:** Clicking 'Copy to Clipboard' places the serialised report text on the clipboard; 'Copied!' shows only after navigator.clipboard.writeText resolves, and a rejection shows an error message.
- **Approval bucket:** Safe fix

### FF-014 — Completed report never renders its error state — API failure shows misleading 'No items found for this period' (High)
- **Type / Dimension:** ux-gap / ui-states
- **Files:** src/app/completed-report/page.js:35; src/app/completed-report/page.js:70; src/app/completed-report/page.js:236-239
- **Evidence:** fetchCompletedItems sets `setError(err.message...)` at line 70, but grep confirms the only occurrence of `error` in the file is the useState/setError — it is never read in JSX. On failure groupItems is empty, so the empty state 'No items found for this period.' renders instead.
- **Impact:** When the API fails the user is told the period genuinely had no completed work, which is factually wrong and could be trusted for reporting. There is also no loading placeholder for the results list (isLoading only spins the small refresh icon), so the same misleading empty state shows during fetch.
- **Root cause:** Error state was wired into fetch logic but the corresponding render branch was dropped in the render rewrite.
- **Siblings checked:** Same page checked for loading: isLoading exists but only animates the refresh icon at line 216; all other main views (TodayView, PlanBoard, IdeaVault, ProjectsView, CalendarView) render error + loading states properly.
- **Recommended fix:** Render an error banner with a retry button when `error` is set (before the empty-state branch), and gate the 'No items found' message on `!isLoading && !error`.
- **Acceptance criteria:** When the completed-items API fails, the page renders an error banner with a retry control; 'No items found for this period' appears only when the fetch succeeded and returned nothing.
- **Approval bucket:** Safe fix

### FF-015 — 'Delete task' in the TaskCard three-dot menu permanently deletes with no confirmation (High)
- **Type / Dimension:** data-risk / ui-states
- **Files:** src/components/shared/TaskCard.jsx:393-405; src/components/today/TodayView.jsx:291-308; src/components/plan/PlanBoard.jsx:416-431; src/components/Projects/ProjectsView.jsx:273-288
- **Evidence:** The menu item at TaskCard.jsx:397 calls `onDelete?.(task.id)` directly, and all three page-level handlers (TodayView:291, PlanBoard:416, ProjectsView:273) immediately remove the task from state and call apiClient.deleteTask with no confirm step. The DELETE API is a hard delete.
- **Impact:** One misclick in a hover menu — where 'Delete task' sits directly below the date options — irreversibly destroys a task and its notes, with no undo.
- **Root cause:** The confirmation pattern used elsewhere was not applied to the quick-action menu path.
- **Siblings checked:** Contrast confirmed: TaskDetailDrawer (lines 648-681), IdeaCard.jsx:122, and ProjectWorkspace.jsx:172 all confirm before deleting — TaskCard's menu is the only unconfirmed hard-delete path.
- **Recommended fix:** Add a confirmation (window.confirm or the two-step pattern used in TaskDetailDrawer.jsx:648-681) before invoking onDelete from the TaskCard menu.
- **Acceptance criteria:** Choosing 'Delete task' from the TaskCard menu requires an explicit confirmation step before any DELETE request fires.
- **Approval bucket:** Safe fix

### FF-016 — Projects page has no mobile layout — fixed 280px sidebar leaves ~95px for content on phones (High)
- **Type / Dimension:** ux-gap / ui-states
- **Files:** src/components/Projects/ProjectSidebar.jsx:140; src/components/Projects/ProjectsView.jsx:316; src/components/Projects/ProjectWorkspace.jsx:274; src/components/layout/TabBar.jsx:12
- **Evidence:** ProjectSidebar renders `w-[280px] shrink-0` with no responsive classes, inside ProjectsView's `flex h-[calc(100vh-4rem)]` (line 316) which also has no breakpoints; ProjectWorkspace's body is a side-by-side `flex gap-6` with flex-[3]/flex-[2] columns (line 274) that never stacks. Projects is a first-class mobile route in the bottom TabBar (TabBar.jsx:12).
- **Impact:** On a 375px viewport the workspace/dashboard gets roughly 95px of width, making the Projects tab effectively unusable on mobile despite being offered in the mobile navigation.
- **Root cause:** The Projects redesign was built desktop-only; every other board (PlanBoard has a mobile tab switcher, Calendar stacks its sidebar) handles mobile but this view does not.
- **Siblings checked:** Checked PlanBoard.jsx:640-680 (has md: grid + mobile tabs) and CalendarView.jsx:313-321 (hidden lg:block sidebar + mobile fallback) — Projects is the only tab route without mobile handling.
- **Recommended fix:** Hide or collapse the sidebar below md: (e.g. drawer or list/detail toggle) and stack ProjectWorkspace's task/notes columns with flex-col md:flex-row.
- **Acceptance criteria:** At 375px viewport width, the Projects page presents a usable list/detail layout (collapsible sidebar or drawer) with no fixed 280px sidebar squeezing content to ~95px.
- **Approval bucket:** Safe fix

### FF-017 — 'Unassigned' sidebar entry is dead — clicking it shows the dashboard instead of unassigned tasks (High)
- **Type / Dimension:** bug / ui-states
- **Files:** src/components/Projects/ProjectSidebar.jsx:232; src/components/Projects/ProjectsView.jsx:133-135; src/components/Projects/ProjectsView.jsx:339-360
- **Evidence:** The sidebar button calls `onSelectProject('__unassigned__')`, but ProjectsView's selectedProject memo is `projects.find(p => p.id === selectedProjectId)` which never matches the sentinel, so the render branch at line 339 falls through to ProjectDashboard. Grep confirms '__unassigned__' appears nowhere else in src/, and the URL becomes /projects?id=__unassigned__ which loadData actively clears on reload (lines 84-96).
- **Impact:** Unassigned tasks (whose count is advertised on the button) can never be viewed from the Projects page; the click highlights the entry and silently shows the dashboard.
- **Root cause:** The unassigned-workspace render branch was never implemented for the sentinel id.
- **Siblings checked:** Verified unassignedTasks state is populated in ProjectsView.jsx:69-81 and only used for the count badge and handleTaskAdded — it is never rendered as a list.
- **Recommended fix:** Add a branch rendering the unassignedTasks list (e.g. a ProjectWorkspace-like pane) when selectedProjectId === '__unassigned__', or remove the sidebar entry until implemented.
- **Acceptance criteria:** Clicking 'Unassigned' in the project sidebar renders the unassigned-tasks list (or the entry is removed until implemented).
- **Approval bucket:** Safe fix

### FF-018 — Cron endpoints trust a client-settable x-vercel-cron header when CRON_SECRET is unset in production (High)
- **Type / Dimension:** security / known-issues + security
- **Files:** src/lib/cronAuth.js:17; src/lib/cronAuth.js:40; src/app/api/cron/demote-today-tasks/route.js:21; src/app/api/cron/demote-week-tasks/route.js:21; src/app/api/cron/office365-sync/route.js:10-23
- **Merged duplicates:** "office365-sync cron trusts a spoofable x-vercel-cron header when CRON_SECRET is unset" (security, Medium)
- **Evidence:** verifyCronAuth sets isCron purely from the request's x-vercel-cron header (lines 17-20). Line 40 only returns 403 when CRON_SECRET is unset AND isCron is false, so with CRON_SECRET unset in production any external caller who sends 'x-vercel-cron: 1' is authorised. Flagged as R-3/SEC-001 in the 2026-04-20 adversarial review; the 2026-04-20 Bearer-auth commit (55f48bf) did not change this fallback. [Independently confirmed by the security dimension:] This route is excluded from middleware (src/middleware.js:44 excludes api/cron) and reimplements cron auth inline instead of using verifyCronAuth. If CRON_SECRET is not configured, it only requires `request.headers.get('x-vercel-cron')` to be present (line 20-22) in production, and in non-production it is fully open. On success it runs syncOffice365All for every connected user (mutating tasks/projects and users' Office365 To-Do lists) on a per-minute schedule.
- **Impact:** If CRON_SECRET is not configured in Vercel production, anyone who guesses the endpoint paths can trigger mass task-state demotion and uninvited email sends from the user's Microsoft account.
- **Root cause:** The unset-secret fallback treats a spoofable request header as proof the request came from Vercel's scheduler.
- **Siblings checked:** All five cron routes (demote-today, demote-week, daily-task-email, office365-sync) route through the same verifyCronAuth, so all share the exposure.
- **Recommended fix:** Require CRON_SECRET in production (fail closed when unset) or verify against a non-spoofable signal; at minimum confirm CRON_SECRET is set in Vercel production env. [From the merged duplicate:] Require CRON_SECRET unconditionally (fail closed if unset) and route this cron through the shared verifyCronAuth helper used by the other crons.
- **Acceptance criteria:** With CRON_SECRET unset, a request bearing 'x-vercel-cron: 1' to any cron route — including the office365-sync route's inline check — is rejected (fail closed).
- **Approval bucket:** Risky (needs approval) — cron auth change; must be coordinated with confirming CRON_SECRET is set in Vercel production

### FF-019 — Any weekly planning session is treated as the Sunday combined flow, forcing a daily step and recording a daily session for a possibly past Monday (High)
- **Type / Dimension:** bug / known-issues
- **Files:** src/components/planning/PlanningModal.jsx:27; src/hooks/usePlanningPrompt.js:140; src/components/planning/PlanningModal.jsx:188
- **Evidence:** PlanningModal.jsx:27 still reads `const isSundayCombined = windowType === WINDOW_TYPE.WEEKLY;` with no Sunday/manual gate — FINDING-07 from the 2026-04-17 adversarial review, unaddressed by the subsequent fix commits. Manual 'Plan This Week' (usePlanningPrompt.js:138-144) sets windowDate to Monday of the CURRENT week, and handleFinish (lines 174-189) then forces 'Step 2 of 2: Plan Monday' and records a daily planning_sessions row for that Monday.
- **Impact:** A midweek manual weekly plan forces a mandatory second 'Plan Monday' step against a date already in the past, and records a daily session for that past Monday, corrupting planned-state used to suppress prompts.
- **Root cause:** The combined-flow discriminator uses windowType alone instead of checking that the session was auto-opened in the Sunday-evening window.
- **Siblings checked:** The related dead-prop issue (isManual passed but unread) is reported separately; no other component derives combined-flow state.
- **Recommended fix:** Gate the combined flow on the actual context, e.g. compute isCombinedFlow in usePlanningPrompt only when the weekly window opens on Sunday/Monday auto-trigger, and pass it in (the still-plumbed isManual prop can serve as the discriminator).
- **Acceptance criteria:** A manually opened weekly planning session does not force the daily step and never records a daily planning session for a past (or unrelated) Monday; the Sunday auto-triggered combined flow still works.
- **Approval bucket:** Safe fix

### FF-020 — Re-sending state:'done' for an already-done task re-stamps completed_at to now() (Medium)
- **Type / Dimension:** bug / lifecycle
- **Files:** src/services/taskService.js:204; src/components/today/TodayView.jsx:210
- **Evidence:** updateTask guards entered_state_at with `newState !== oldState` (taskService.js:187-189) but sets `completed_at = new Date().toISOString()` whenever newState === DONE with no transition check (lines 204-209); the DB trigger only stamps on actual transitions so the explicit column write passes through. Clicking the checkbox of a task in TodayView's 'Completed today' list sends exactly this repeat PATCH (TodayView.jsx:210, 583-587).
- **Impact:** The original completion timestamp is silently overwritten, shifting the task between days/months in the completed report if the repeat PATCH happens later (e.g. clicking an old done task's checkbox after midnight).
- **Root cause:** The done-state branch in updateTask lacks the `newState !== oldState` guard the entered_state_at branch has.
- **Siblings checked:** The DB trigger (migration lines 178-181) has the correct transition guard; only the service layer over-writes. handleMarkDone in PlanningModal (line 126) targets non-done candidates so is unaffected on first click.
- **Recommended fix:** In taskService.js, only set completed_at when `oldState !== STATE.DONE`; keep the null-out branch for leaving done as-is.
- **Acceptance criteria:** PATCHing state:'done' on an already-done task leaves completed_at unchanged (timestamp only set on the transition into done).
- **Approval bucket:** Safe fix

### FF-021 — DB trigger overwrites Outlook completion timestamps with sync time (Medium)
- **Type / Dimension:** data-risk / lifecycle
- **Files:** supabase/migrations/20260404000001_prioritisation_replacement.sql:178; src/services/office365SyncService.js:643
- **Evidence:** fn_task_state_cleanup sets `NEW.completed_at := now()` on any INSERT with state='done' and on any transition into done (migration lines 178-181). The O365 pull explicitly supplies the real Graph completedDateTime on insert (office365SyncService.js:643-646) and on update (lines 783-785), but the BEFORE trigger replaces it.
- **Impact:** Tasks completed in Outlook get completed_at equal to the next sync run, not the actual completion time, so the completed report attributes them to the wrong day. The taskService `preserveCompletedAt` option (taskService.js:205) is both never called and defeated by the same trigger.
- **Root cause:** The trigger unconditionally stamps now() instead of respecting an explicitly provided completed_at.
- **Siblings checked:** For UI-driven completions the client sends no completed_at, so behaviour there is unchanged; only the O365 pull (and any future backdating feature) is affected.
- **Recommended fix:** Change the trigger to `NEW.completed_at := COALESCE(NEW.completed_at, now())` on the into-done branches (requires a new migration recreating the function).
- **Acceptance criteria:** An Office365 pull of a completed task stores the Graph completedDateTime; the trigger only stamps now() when no completed_at was supplied (COALESCE behaviour).
- **Approval bucket:** Risky (needs approval) — requires a migration recreating fn_task_state_cleanup

### FF-022 — A failed demote cron run can never retry the same day — one transient error skips demotion entirely (Medium)
- **Type / Dimension:** bug / lifecycle
- **Files:** src/lib/cronAuth.js:83; src/app/api/cron/demote-today-tasks/route.js:41
- **Evidence:** claimCronRun INSERT-first claims (operation, run_date) and returns already_run on unique violation regardless of the prior run's status (cronAuth.js:95-98). The routes claim before doing any work (demote-today route.js:41-49), then mark the row 'failed' on errors (e.g. resolveDigestUserId throwing on a transient auth.admin.listUsers error, dailyTaskEmailService.js:87-89) but never release or re-open the claim.
- **Impact:** If the single daily invocation fails after claiming, no retry (manual or scheduled) can run that day — that evening's Today/This Week review silently doesn't happen and no email is sent.
- **Root cause:** The idempotency claim treats 'attempted' as 'completed'; there is no reclaim path for status='failed' rows.
- **Siblings checked:** Same claimCronRun pattern is shared by demote-week-tasks (route.js:48) and any other cron using cronAuth; all inherit the no-retry behaviour.
- **Recommended fix:** On 23505, read the existing row and allow reclaim (update status back to 'claimed') when its status is 'failed', or delete the claim row in the failure handlers.
- **Acceptance criteria:** After a cron run recorded status='failed', a retry on the same run_date proceeds (reclaims) instead of returning already_run.
- **Approval bucket:** Safe fix

### FF-023 — Abandoning the Sunday combined flow after the weekly step silently loses Monday's daily planning prompt (Medium)
- **Type / Dimension:** ux-gap / lifecycle
- **Files:** src/components/planning/PlanningModal.jsx:174; src/hooks/usePlanningPrompt.js:59; src/lib/planningWindow.js:91
- **Evidence:** The Sunday flow records the weekly session and only transitions to the daily step in component memory (PlanningModal.jsx:174-185); the daily session is recorded only at the final Finish (line 189). usePlanningPrompt checks a session only for the currently active window (line 59), and the active window stays 'weekly' from Sunday 20:05 until Monday 20:00 (planningWindow.js:91-100).
- **Impact:** If the user closes the modal ('Do This Later', Escape, or a page reload) between the two steps, the weekly session already exists so the banner shows 'Week planned' and the auto-modal never reopens — Monday's daily plan is skipped without any indication.
- **Root cause:** Two-step completion is tracked only in transient React state while the resume logic keys off the persisted weekly session alone.
- **Siblings checked:** Single-step daily and weekly flows are safe: no session row is written until Finish, so abandoning them re-prompts correctly.
- **Recommended fix:** In checkPlanningState, when windowType is weekly also check the daily session for the same windowDate and re-prompt (step 2 only) if it is missing.
- **Acceptance criteria:** Closing the Sunday combined flow after the weekly step but before Finish causes the next planning check to re-prompt for Monday's daily planning (daily session missing for windowDate).
- **Approval bucket:** Safe fix

### FF-024 — Defer in the planning modal silently moves 'waiting' tasks to backlog, dropping their waiting status (Medium)
- **Type / Dimension:** bug / lifecycle
- **Files:** src/components/planning/PlanningModal.jsx:141; src/app/api/planning-candidates/route.js:42
- **Evidence:** Planning candidates exclude only today/done (daily, route.js:42/52) or this_week/today/done (weekly overdue, line 105), so dated 'waiting' tasks appear in the modal. handleDefer unconditionally sets state:'backlog' whenever the new date falls beyond the target week (PlanningModal.jsx:141-146), regardless of the task's current state.
- **Impact:** A waiting-on-someone task deferred past the week silently leaves the Waiting column and loses its waiting semantics, while waiting_reason/follow_up_date remain as stale fields; the user's chase-up tracking is broken without feedback.
- **Root cause:** handleDefer assumes candidates are this_week/backlog tasks and encodes only the this_week→backlog demotion rule.
- **Siblings checked:** The same Defer handler serves both daily and weekly steps, so both are affected. TaskDetailDrawer date edits do not change state, so the drawer path is safe.
- **Recommended fix:** Skip the state change when the task's current state is 'waiting' (only update due_date), or exclude waiting tasks from planning candidates.
- **Acceptance criteria:** Deferring a 'waiting' task in the planning modal updates its due_date but leaves state='waiting' (or waiting tasks no longer appear as candidates).
- **Approval bucket:** Safe fix

### FF-025 — completed_at is client-writable independent of state, allowing done tasks to become invisible in every view (Medium)
- **Type / Dimension:** data-risk / lifecycle
- **Files:** src/services/taskService.js:19; src/app/api/completed-items/route.js:29
- **Evidence:** TASK_UPDATE_FIELDS includes 'completed_at' (taskService.js:6-21), so a PATCH without a state change writes it directly; the DB trigger only acts on state transitions. Every surface for done tasks filters on completed_at ranges: the completed report (completed-items/route.js:29-32) and TodayView's 'Completed today' (state:'done' + completedSince, TodayView.jsx:119-122).
- **Impact:** PATCH {completed_at: null} on a done task leaves it state='done' but excluded from the report and the today list — invisible in every view while still existing. Legacy ProjectItem.js:174-178 sends exactly this shape (completed_at without state), showing the pattern has existed in client code.
- **Root cause:** completed_at is treated as an ordinary updatable column instead of being derived exclusively from state transitions.
- **Siblings checked:** No live UI component sends completed_at (grep confirmed only dead ProjectItem.js); the API surface remains exposed to any client or script.
- **Recommended fix:** Remove 'completed_at' from TASK_UPDATE_FIELDS (let the state-transition logic own it), or reject completed_at values inconsistent with the resulting state.
- **Acceptance criteria:** A PATCH supplying completed_at without a corresponding state transition is rejected or ignored; a done task cannot be made invisible-to-all-views by a client write.
- **Approval bucket:** Safe fix

### FF-026 — Rate limiter is in-memory per serverless instance and keyed on a spoofable IP header (Medium)
- **Type / Dimension:** security / security
- **Files:** src/lib/rateLimiter.js:1-20; src/lib/rateLimiter.js:46-55
- **Evidence:** The limiter stores counters in a module-level Map (line 7), so on Vercel each concurrent function instance keeps independent state and limits are not enforced across instances (acknowledged in the file's own comment). For unauthenticated/GET calls getClientIdentifier derives the key from client-controlled x-forwarded-for/x-real-ip/cf-connecting-ip headers (lines 50-54), which an attacker can rotate to get a fresh bucket each request.
- **Impact:** The primary abuse/DoS control is largely bypassable — by fanning across instances or spoofing the forwarded IP — so the documented per-route limits provide weak protection in production.
- **Root cause:** Simple in-memory implementation chosen over a shared store; identifier trusts unauthenticated proxy headers.
- **Siblings checked:** All API routes that call checkRateLimit share this limiter, so the weakness is app-wide, not route-specific.
- **Recommended fix:** Back the limiter with a shared store (e.g. Upstash Redis) and prefer the authenticated user id as the key for authenticated routes; only fall back to IP for pre-auth endpoints.
- **Acceptance criteria:** Rate limits are enforced across serverless instances via a shared store, and authenticated routes are keyed by user id rather than a spoofable IP header.
- **Approval bucket:** Risky (needs approval) — introduces external infrastructure (e.g. Upstash Redis) and changes limiter behaviour

### FF-027 — Idea promotion is non-atomic and unguarded — concurrent or retried promotes create duplicate tasks (Medium)
- **Type / Dimension:** bug / api-contracts
- **Files:** src/services/ideaService.js:144; src/app/api/ideas/[id]/promote/route.js:18; supabase/migrations/20260404000001_prioritisation_replacement.sql:39
- **Evidence:** promoteIdea (ideaService.js:144-197) reads the idea, checks idea_state !== 'promoted' in JS, inserts a task, then updates the idea in a second statement — no transaction, no conditional update, and source_idea_id has no UNIQUE constraint (migration line 39). If the idea update fails after the task insert, the route returns 500 while the task already exists.
- **Impact:** Double-click or concurrent promote requests both pass the 'already promoted' check and each insert a task, duplicating the idea. A failure between insert and update leaves the idea unpromoted with a task created; the natural retry duplicates it again.
- **Root cause:** Check-then-act across two separate writes with no DB-level idempotency guard (unique index or single RPC/transaction).
- **Siblings checked:** Checked the other multi-write flows: planning-sessions POST uses upsert with onConflict (safe); journal entries POST handles 23505 idempotently; project/task deletes do O365 cleanup best-effort after the DB write (acceptable).
- **Recommended fix:** Make the promoted-state flip conditional and first: `update ideas set idea_state='promoted' where id=? and user_id=? and idea_state<>'promoted'` and only insert the task if a row was affected; add a partial UNIQUE index on tasks(source_idea_id). Ideally wrap both in one Postgres function.
- **Acceptance criteria:** Two concurrent (or retried) promote calls for the same idea create exactly one task and flip the idea to promoted exactly once (conditional update + partial unique index on tasks.source_idea_id).
- **Approval bucket:** Risky (needs approval) — includes a migration (partial UNIQUE index) and ideally a transactional function

### FF-028 — PATCH /api/ideas/[id] applies updates with no validation — invalid values surface as generic 500s and bypass business rules (Medium)
- **Type / Dimension:** bug / api-contracts
- **Files:** src/services/ideaService.js:89; src/lib/validators.js:179; supabase/migrations/20260404000001_prioritisation_replacement.sql:167
- **Evidence:** updateIdea (ideaService.js:89-106) filters to allowed fields but never calls validateIdea, unlike createIdea (line 46) and taskService.updateTask (line 220-222). An invalid idea_state hits the ideas_state_check CHECK constraint (migration line 167) — error code 23514 is unmapped in handleSupabaseError, so the client gets a 500 'Failed to update item'.
- **Impact:** Bad input returns 500 instead of 400 with field details; title length limits and non-empty rules from validateIdea are unenforced on update; a client can also set idea_state='promoted' directly, hiding the idea from listIdeas (which excludes promoted) with no task ever created.
- **Root cause:** Validation step was omitted from the update path in ideaService; only create validates.
- **Siblings checked:** taskService.updateTask and both project PATCH routes do validate the merged object — ideas is the only update path that skips it. review_date/follow_up_date remain unvalidated everywhere (invalid dates become DB 22P02 errors).
- **Recommended fix:** Merge existing row with filtered updates and run validateIdea before the write (same pattern as taskService.updateTask); reject or special-case idea_state='promoted' on direct PATCH.
- **Acceptance criteria:** PATCH /api/ideas/[id] with an invalid idea_state (or other invalid field) returns a 400 with a validation message instead of a generic 500 from the DB constraint.
- **Approval bucket:** Safe fix

### FF-029 — Mass assignment on POST /api/tasks and POST /api/projects — client-supplied columns inserted verbatim (Medium)
- **Type / Dimension:** security / api-contracts
- **Files:** src/services/taskService.js:43; src/app/api/projects/route.js:121
- **Evidence:** createTask builds the insert row as `{ ...rest, user_id, state }` (taskService.js:43-50), deleting only 5 legacy fields (lines 66-70); projects POST inserts `{ ...body, user_id }` (projects/route.js:121-124). There is no allowlist on create, in contrast to TASK_UPDATE_FIELDS/PROJECT_UPDATE_FIELDS used on update.
- **Impact:** A client can set id, created_at, updated_at, completed_at, entered_state_at, sort_order, and source_idea_id — the latter can reference another user's idea since only project ownership is checked (taskService.js:78-92). Unknown keys make the insert fail with PGRST204, returned as a misleading 500 ('No data found' mapping) instead of a 400.
- **Root cause:** Create paths spread the raw request body into the insert payload instead of picking allowed fields.
- **Siblings checked:** Update paths are properly allowlisted (taskService.js:6-31, projects/route.js:9-26, ideaService.js:4-17); createIdea builds an explicit column list (ideaService.js:51-62) — only the two create paths above are affected.
- **Recommended fix:** Apply the same allowlist filtering used on the update paths to createTask and projects POST (plus an ownership check if source_idea_id is ever meant to be client-settable). Note AddProjectForm.js:97-102 currently relies on the spread to pass project_id/user_id — update that caller too.
- **Acceptance criteria:** POST /api/tasks and POST /api/projects drop non-allowlisted columns (a client-supplied user_id/completed_at/source_idea_id is ignored), and AddProjectForm still creates projects successfully.
- **Approval bucket:** Safe fix

### FF-030 — Journal cleanup endpoint has no rate limit and a check-then-act race that fires duplicate OpenAI calls (Medium)
- **Type / Dimension:** bug / api-contracts + security
- **Files:** src/app/api/journal/entries/cleanup/route.js:93; src/app/api/journal/entries/route.js:16; src/app/api/journal/entries/cleanup/route.js:93-107
- **Merged duplicates:** "Expensive OpenAI cleanup endpoint has no rate limiting" (security, Medium)
- **Evidence:** cleanup/route.js POST (lines 93-204) has no checkRateLimit call, unlike its siblings (journal entries POST: 20/min at entries/route.js:16; summary: 10/min). It guards on `entry.cleaned_content` (line 127) read before the OpenAI call, with no atomic claim of the pending state. [Independently confirmed by the security dimension:] The POST handler authenticates but never calls checkRateLimit. Each call invokes the OpenAI chat completions API with up to AI_MAX_RETRIES (2) retries plus the initial attempt (src/app/api/journal/entries/cleanup/route.js:63-91). The sibling journal endpoints (entries POST, summary POST) do apply checkRateLimit.
- **Impact:** Concurrent cleanup requests for the same entry each pass the guard and each spend an OpenAI call (up to 3 attempts × 20s each), with last-writer-wins on cleaned_content; the endpoint is also the only unthrottled AI-spending route.
- **Root cause:** Missing rate limiter and a non-atomic read-check-write around ai_status/cleaned_content.
- **Siblings checked:** All other mutation routes under api/tasks, api/projects, api/notes, api/ideas and api/journal carry rate limits except tasks/sort-order, planning-sessions POST and this one; only this one spends money per call.
- **Recommended fix:** Add checkRateLimit like the sibling routes, and claim the entry atomically: `update ... set ai_status='pending' where id=? and user_id=? and cleaned_content is null and ai_status<>'pending'` returning the row, bailing out if no row is claimed.
- **Acceptance criteria:** Rapid duplicate cleanup POSTs for the same entry trigger at most one OpenAI call (atomic ai_status claim), and requests beyond the limit receive 429 like the sibling journal routes.
- **Approval bucket:** Safe fix

### FF-031 — POST /api/notes ignores idea_id, skips validateNote, and lets both parents through to a DB constraint failure (Medium)
- **Type / Dimension:** bug / api-contracts
- **Files:** src/app/api/notes/route.js:89; src/lib/validators.js:164; supabase/migrations/20260404000001_prioritisation_replacement.sql:112
- **Evidence:** notes/route.js:89-101 hand-rolls validation ('content and project_id or task_id'), never calls validateNote, never reads body.idea_id, and inserts both project_id and task_id when both are supplied. The DB constraint check_note_parent (migration lines 112-116) requires exactly one of project_id/task_id/idea_id, and 23514 is unmapped in handleSupabaseError.
- **Impact:** Idea notes are impossible via the API even though validator, schema and FK support them (dead capability); a request with both parents fails at the DB and returns a generic 'Failed to create item' 400 with no field details; NOTE_MAX content length is unenforced.
- **Root cause:** The route predates the idea_id parent and duplicates validation inline instead of using validateNote.
- **Siblings checked:** notes/batch has a related gap: when both taskIds and projectIds are sent, projectIds are silently ignored (else-if at notes/batch/route.js:53-57) although the 200-item cap counts both — latent, since apiClient.js:248/260 always sends one array.
- **Recommended fix:** Use validateNote, accept idea_id with an ideas ownership check (same pattern as the task/project checks at lines 106-129), and reject more than one parent with a 400 before hitting the DB.
- **Acceptance criteria:** POST /api/notes accepts idea_id (with an ideas ownership check), rejects more than one parent with a 400 before the DB, and runs validateNote.
- **Approval bucket:** Safe fix

### FF-032 — TodayView.handleUpdate applies optimistic edits with no rollback or refetch on failure (Medium)
- **Type / Dimension:** bug / client-data
- **Files:** src/components/today/TodayView.jsx:272
- **Evidence:** handleUpdate (TodayView.jsx:272-289) merges updates into sections, completedToday and selectedTask before the PATCH, and the catch block only alerts — no state revert and no loadData. The tasks-changed reconciliation only fires on success (apiClient.js:187-192), so nothing corrects the UI after a failure.
- **Impact:** If the PATCH fails (offline, 500, validation), the UI permanently shows the unsaved value (e.g. a new due date) until the user navigates away, so they believe a change was saved when it was not.
- **Root cause:** The optimistic handler was written without a failure path; sibling handlers gained reverts/reloads but this one only alerts.
- **Siblings checked:** Checked the same pattern elsewhere: PlanBoard.handleUpdate reloads on failure, CalendarView.handleDrawerUpdate reverts from a snapshot, ProjectsView.handleUpdateTask reloads — TodayView is the only host without recovery.
- **Recommended fix:** In the catch, either restore the captured previous task objects or call loadData(), matching PlanBoard.handleUpdate (PlanBoard.jsx:410-413) which reloads on failure.
- **Acceptance criteria:** When a task PATCH from TodayView fails, the UI restores the previous task state (or reloads), so what is displayed matches the server.
- **Approval bucket:** Safe fix

### FF-033 — PlanBoard backlog pagination collapses to the first 20 tasks after any mutation (Medium)
- **Type / Dimension:** ux-gap / client-data
- **Files:** src/components/plan/PlanBoard.jsx:246; src/components/plan/PlanBoard.jsx:271; src/components/plan/PlanBoard.jsx:286
- **Evidence:** The tasks-changed listener (271-280) calls loadAllColumns, which fetches backlog with limit 20 offset 0 (246) and replaces the column and resets backlogOffset to 20 (250-264), discarding pages accumulated by handleLoadMoreBacklog (286-307).
- **Impact:** After loading several backlog pages, any single action anywhere (complete a task, edit a due date, QuickCapture) truncates the visible backlog back to 20 items, losing the user's scroll/browse position.
- **Root cause:** The refetch-everything listener reuses the initial-load routine, which is pagination-unaware.
- **Siblings checked:** The same listener also races the 300ms debounced sort-order write (PlanBoard.jsx:524-537): a refetch between drop and write repaints the pre-drag order while the write later persists the new order, leaving UI and server disagreeing until the next refetch.
- **Recommended fix:** On tasks-changed, refetch backlog with limit = current backlogOffset (preserving loaded depth), or reconcile mutations into the existing backlog array instead of a full reset.
- **Acceptance criteria:** After any task mutation, the PlanBoard backlog column retains its previously loaded pagination depth instead of collapsing to the first 20 tasks.
- **Approval bucket:** Safe fix

### FF-034 — Refetch functions have no cancellation or latest-wins guard — out-of-order responses can resurrect stale lists (Medium)
- **Type / Dimension:** bug / client-data
- **Files:** src/components/today/TodayView.jsx:113; src/components/plan/PlanBoard.jsx:242; src/components/calendar/CalendarView.jsx:44; src/components/shared/TaskDetailDrawer.jsx:163
- **Evidence:** loadData/loadAllColumns/fetchTasks are invoked once per tasks-changed event with no AbortController or request sequence check; two rapid mutations start two overlapping fetch cycles and whichever resolves last wins setState. TaskDetailDrawer.fetchNotes (163-170) likewise has no cancellation, and prevTaskIdRef prevents a corrective refetch.
- **Impact:** Completing two tasks quickly can make the first (already-completed) task reappear in Today if its pre-mutation response lands last; switching between tasks quickly in the drawer can display task A's notes under task B.
- **Root cause:** Event-driven refetches fire per mutation without deduplication, versioning, or aborting the previous request.
- **Siblings checked:** ProjectNotes.jsx:17-42 already implements the abort-guard pattern correctly — the other loaders never adopted it.
- **Recommended fix:** Keep a monotonically increasing request id (or AbortController) per loader and ignore responses that are not the latest; debounce the tasks-changed handler so bursts coalesce into one refetch.
- **Acceptance criteria:** Two rapid mutations leave every view rendering the latest response only — stale/out-of-order fetch responses are discarded (request-id or AbortController guard).
- **Approval bucket:** Safe fix

### FF-035 — PlanningModal computes sort_order via read-modify-write with a full state fetch per assignment (Medium)
- **Type / Dimension:** bug / client-data + known-issues
- **Files:** src/components/planning/PlanningModal.jsx:80; src/components/planning/PlanningModal.jsx:94
- **Merged duplicates:** "Concurrent planning assignments can write duplicate sort_order values (read-max-then-write race)" (known-issues, Medium)
- **Evidence:** handleAssign (94-115) awaits getMaxSortOrder (80-92), which fetches every task in the target state client-side to find the max, then PATCHes maxSort + 1. Two assignments started in quick succession (different rows are independently clickable) can read the same max and write duplicate sort_order values; each PATCH also dispatches tasks-changed, refetching the page behind the modal per pill tap. [Independently confirmed by the known-issues dimension:] handleAssign fetches the current max sort_order via getMaxSortOrder (lines 80-92, a client-side GET) and then PATCHes max+1 (lines 94-102) with no atomicity; two rapid assignments read the same max and both write max+1. FINDING-09 from the 2026-04-17 review, unchanged. getMaxSortOrder also computes the max from a default-limit (100-row) page of /api/tasks, so it can under-read with large states.
- **Impact:** Tasks assigned during planning can end up with identical sort_order, producing unstable ordering in Today sections, and each assignment triggers an extra full-state GET plus a background page refetch.
- **Root cause:** Ordering is computed client-side from a racy read instead of server-side (e.g. max+1 in the PATCH handler or a fractional-order append).
- **Siblings checked:** TodayView.handleDragEnd uses the sortOrder helpers (computeSortOrder/reindex) for the same problem and avoids the extra fetch; PlanningModal never adopted them.
- **Recommended fix:** Compute the append sort_order server-side in taskService.updateTask when state/today_section changes, or serialise assignments through a queue and reuse a cached max incremented locally. [From the merged duplicate:] Compute the appended sort_order server-side in taskService (e.g. max(sort_order)+1 within the update), or use the existing fn_batch_update_sort_order RPC path.
- **Acceptance criteria:** Two planning assignments in quick succession receive distinct sort_order values (server-assigned append), with no full task-list fetch per assignment.
- **Approval bucket:** Safe fix

### FF-036 — Date-only strings compared as UTC midnight against the current instant classify items due today as overdue (Medium)
- **Type / Dimension:** bug / dates
- **Files:** src/components/today/TodayView.jsx:134; src/components/today/TodayView.jsx:149; src/components/plan/BoardColumn.jsx:109
- **Evidence:** TodayView.jsx:134 computes overdue follow-ups with `new Date(t.follow_up_date) < today` and lines 149-152 compute the first-run banner with `new Date(t.due_date) < now`; `new Date('YYYY-MM-DD')` parses as UTC midnight, so a date equal to today compares as past for nearly the whole day. BoardColumn.jsx:108-109 uses the same `new Date(task.follow_up_date) < new Date()` pattern for the Waiting column's red overdue badge. The canonical rule in TaskCard.jsx:34-36 (differenceInCalendarDays(now, followUp) > 0) treats a follow-up due today as NOT overdue.
- **Impact:** A follow-up or task dated today is flagged/counted as overdue from 00:00 UTC (01:00 London in BST), so the Today banner can claim 'N overdue follow-ups' while TaskCard-rendered items show none flagged, and the first-run banner counts today-due tasks as overdue instead of due-this-week. BoardColumn's toLocaleDateString on the UTC-midnight Date (line 101) also displays the previous day for users in timezones west of UTC.
- **Root cause:** Date-only DB strings are parsed to a UTC-midnight instant and compared against the current instant, instead of comparing London (or calendar-day) date keys.
- **Siblings checked:** Grepped all `new Date(x) <` comparisons across src: dailyTaskEmailService and CalendarSidebar correctly compare YYYY-MM-DD strings; validators.js:129 only checks parseability (safe); journalService compares full timestamps (safe).
- **Recommended fix:** Compare date strings lexically against getLondonDateKey() (e.g. t.follow_up_date < todayKey), matching the pattern already used in dailyTaskEmailService.js:128-129, and reuse one shared isOverdue helper in TodayView, BoardColumn and TaskCard.
- **Acceptance criteria:** On a BST day, a task whose follow_up_date/due_date equals today's London date key is not classified as overdue (lexical comparison against getLondonDateKey()).
- **Approval bucket:** Safe fix

### FF-037 — Calendar view freezes 'today' at mount, so overdue list, today highlight and month bounds go stale after midnight (Medium)
- **Type / Dimension:** bug / dates
- **Files:** src/components/calendar/CalendarView.jsx:26; src/components/calendar/CalendarSidebar.jsx:19
- **Evidence:** CalendarView.jsx:26-29 memoises `now`, `minMonth`, `maxMonth` and `todayStr` with empty/one-shot dependency arrays, so they are captured once at mount. `todayStr` is passed to CalendarSidebar (lines 314, 320) which splits overdue tasks with `dueKey < today` (CalendarSidebar.jsx:19), and min/max month clamp navigation (lines 77-78).
- **Impact:** With the tab left open past midnight, tasks that became overdue never appear in the Overdue sidebar, the today ring can sit on the wrong day until a state-changing re-render, and at a month boundary the user cannot navigate into the new current month. The stale date is also device-local, not Europe/London.
- **Root cause:** Mount-time `new Date()` cached in useMemo with no refresh mechanism (no interval, no visibilitychange recompute).
- **Siblings checked:** Checked MonthStrip.jsx:51 (recomputes new Date() per render — fine) and TodayView (refetches on events/focus — fine); CalendarGrid's isToday(day) re-evaluates on render but only re-renders when state changes, so it shares the staleness in practice.
- **Recommended fix:** Store todayStr in state and refresh it on a timer or visibilitychange (as usePlanningPrompt.js:95-105 already does), deriving it from getLondonDateKey() for consistency with the crons.
- **Acceptance criteria:** Leaving the calendar open across London midnight updates the today highlight, overdue list and month bounds without a reload.
- **Approval bucket:** Safe fix

### FF-038 — Client due-date status uses browser-local time (three divergent implementations) while all server logic uses Europe/London (Medium)
- **Type / Dimension:** maintainability / dates
- **Files:** src/lib/dateUtils.js:74; src/components/Tasks/TaskItem.js:30; src/lib/projectHelpers.js:3; src/lib/dateUtils.js:19
- **Evidence:** getDueDateStatus (dateUtils.js:74-120) classifies Today/Tomorrow/Overdue with local `new Date()`/parseISO; TaskItem.js:30-64 and projectHelpers.js:3-14 are separate near-duplicate implementations (using differenceInDays/isPast instead of differenceInCalendarDays). Meanwhile crons, digests and planning windows all use Europe/London (timezone.js, planningWindow.js), and quickPickOptions (dateUtils.js:19-54) generates due-date strings from local time.
- **Impact:** On a device outside London the UI's 'Due Today'/'Overdue' flips at the wrong wall-clock time and disagrees with the London-based daily email and planning candidates; since these are client components, the SSR pass also computes labels in server UTC, so between 00:00-01:00 London (BST) the first paint can show yesterday's classification. Three copies of the same rule invite drift (they already disagree on library functions).
- **Root cause:** Due-date classification was implemented per-component against the ambient local clock instead of one London-anchored helper, contrary to the workspace dateUtils/Europe-London convention.
- **Siblings checked:** TaskCard.jsx and PlanningTaskRow.jsx already delegate to dateUtils.getDueDateStatus; completed-report/page.js uses local day/week/month ranges (acceptable — completed_at comparisons are instant-based).
- **Recommended fix:** Collapse TaskItem.getTaskDueDateStatus and projectHelpers.getDueDateStatus into dateUtils.getDueDateStatus, and base the 'today' anchor on getLondonDateKey()/getStartOfTodayLondon so client, SSR and cron agree.
- **Acceptance criteria:** One shared due-date-status helper anchored to Europe/London serves TaskItem, projectHelpers and dateUtils consumers; the three divergent implementations are gone.
- **Approval bucket:** Safe fix

### FF-039 — Office365 inbound due-date conversion ignores the Graph timeZone field, risking off-by-one dates (Medium)
- **Type / Dimension:** data-risk / dates
- **Files:** src/services/office365SyncService.js:45; src/services/office365SyncService.js:35
- **Evidence:** fromGraphDueDateTime (office365SyncService.js:45-51) takes `dueDateTime.dateTime` and slices the first 10 characters, discarding `dueDateTime.timeZone` entirely. Outbound writes use noon UTC (lines 35-43, commented as an off-by-one guard), which round-trips safely, but inbound tasks created in Outlook/To Do clients arrive with whatever dateTime/timeZone Graph stored.
- **Impact:** If Graph returns a due date as a UTC-converted instant of another zone's midnight (e.g. 2026-07-08T23:00:00Z for a task due 9 July BST), the local task gets due_date 2026-07-08 — one day early — which then feeds overdue logic, digests and demotion flows.
- **Root cause:** The date component of dateTime is assumed to equal the intended calendar date regardless of the accompanying timeZone value.
- **Siblings checked:** Checked microsoftGraph.js — no Prefer timezone header is set on any Graph request; completedDateTime/lastModified handling uses toIsoTimestamp (instant-correct, lines 106-116) and is fine.
- **Recommended fix:** Convert dateTime+timeZone to a London/UTC calendar date (or request a Prefer: outlook.timezone="Europe/London" header on Graph reads) before slicing; log a sample payload from a To Do-created task to confirm the stored shape first.
- **Acceptance criteria:** A due date set in Outlook under a non-UTC timezone lands on the same calendar date locally (dateTime+timeZone converted before slicing), verified against a real To Do payload.
- **Approval bucket:** Risky (needs approval) — changes Office365 inbound date conversion; needs verification against real Graph payloads first

### FF-040 — Sync fabricates a due date of 'today' for remote tasks that have none and writes it back to Microsoft (Medium)
- **Type / Dimension:** bug / office365
- **Files:** src/services/office365SyncService.js:640; src/services/office365SyncService.js:82-87; supabase/migrations/20250707_initial_schema.sql:117
- **Evidence:** Line 640 pulls a new remote task with `due_date: fromGraphDueDateTime(...) || new Date().toISOString().slice(0, 10)` even though tasks.due_date is nullable in the schema. normalizeRemoteTask treats a missing dueDateTime as null (lines 84-87), so tasksMatch fails and the push phase PATCHes the fabricated date back onto the Microsoft task; the same push-back also means a due date cleared in To Do gets re-added from the stale local value.
- **Impact:** Tasks created in Microsoft To Do without a due date silently acquire today's date on both sides, and users cannot remove a due date from To Do — the sync reinstates it. The fallback also uses UTC, so after 11pm BST the fabricated date is tomorrow's.
- **Root cause:** An unnecessary non-null fallback on pull, combined with the deliberate 'missing remote dueDateTime means push local date' rule, turns absent remote data into fabricated data that then propagates outward.
- **Siblings checked:** The pull-update path (lines 775-777) only writes due_date when the property is present, so the fabrication is limited to newly pulled tasks plus the push-back loop.
- **Recommended fix:** Store due_date as null when the remote task has no dueDateTime (the column allows it); if a default is genuinely wanted, derive it with the project's dateUtils in Europe/London and do not let it win conflict resolution over the remote null.
- **Acceptance criteria:** Pulling a remote task with no dueDateTime stores due_date NULL and never pushes a fabricated date back to Microsoft.
- **Approval bucket:** Risky (needs approval) — changes sync conflict/default semantics for due dates

### FF-041 — No concurrency guard between cron, fire-and-forget auto-sync, and per-mutation syncs enables duplicate remote tasks and lists (Medium)
- **Type / Dimension:** bug / office365
- **Files:** src/app/api/cron/office365-sync/route.js:37-47; src/app/api/tasks/route.js:41-49; src/services/office365SyncService.js:130-182; src/services/office365SyncService.js:952-977
- **Evidence:** The cron runs syncOffice365All unconditionally every minute per user (no claimCronRun lock, no last_synced_at interval check), while /api/tasks GET fires maybeAutoSyncOffice365 without awaiting and task mutations run syncOffice365Task inline; last_synced_at is only written at the end of a sync, so overlapping runs are routine. The DB unique indexes only protect the mapping tables — Graph task/list creation is not idempotent, and the in-code dedupeTaskMappings plus migration 20260209110000 exist precisely because duplicate mappings occurred; dedupe deletes the losing mapping row but leaves its local task unmapped, which the push phase (952-977) then re-creates as a fresh remote task.
- **Impact:** Concurrent syncs can create duplicate tasks in Microsoft To Do (and duplicate lists via racing ensureProjectList calls, where the second list is orphaned when the mapping insert hits the unique index), and duplicates re-enter the planner on the next pull. The dedupe pass masks the mapping symptom but perpetuates the task duplication.
- **Root cause:** syncOffice365All is not serialised per user (no advisory lock or claimed-run row) and remote creates are not idempotent, so two overlapping syncs both decide a task/list needs creating.
- **Siblings checked:** claimCronRun exists in src/lib/cronAuth.js:83 and is used by demote-today/demote-week crons, but not by office365-sync; the sync service has no locking anywhere.
- **Recommended fix:** Serialise syncs per user (e.g. pg advisory lock or a claimed sync-run row like claimCronRun) and have the cron respect a minimum interval since last_synced_at; on mapping unique-violation after a remote create, delete the just-created remote task/list.
- **Acceptance criteria:** Overlapping cron, auto-sync and per-mutation syncs for one user are serialised (lock/claim), and no duplicate remote tasks or lists appear under concurrent runs.
- **Approval bucket:** Risky (needs approval) — adds locking around external sync; wrong lock scope could stall syncs

### FF-042 — Pull-phase mapping insert failure (non-unique error) strands an unmapped local task that duplicates the remote task on the next sync (Medium)
- **Type / Dimension:** bug / office365
- **Files:** src/services/office365SyncService.js:660-707
- **Evidence:** After inserting the pulled local task, the mapping insert error path only rolls back the created task when isUniqueConstraintError matches (lines 672-702); any other insert failure (timeout, transient 5xx from PostgREST) hits `console.warn(...); continue;` at 705-706, leaving the local task in the DB with no office365_task_items row.
- **Impact:** On the next sync the unmapped local task is pushed as a brand-new remote task while the original remote task is pulled again as another new local task — one transient DB error yields permanent duplicates on both sides.
- **Root cause:** The task insert and mapping insert are two non-atomic writes, and the compensation (delete created task) only covers the unique-violation branch.
- **Siblings checked:** The push-phase equivalents (lines 958-970, 926-938) throw on mapping errors, aborting the sync instead of stranding state, though they still leak the just-created remote task.
- **Recommended fix:** Delete the just-created local task on any mapping-insert failure (not just 23505), or perform task+mapping creation in a single RPC/transaction.
- **Acceptance criteria:** Any mapping-insert failure after a pull rolls back the just-created local task (or task+mapping commit atomically), so the next sync cannot duplicate the remote task.
- **Approval bucket:** Risky (needs approval) — error-path deletes data as cleanup; safest done as a transactional RPC

### FF-043 — Quick-add inputs swallow creation failures with deliberate 'silently fail' catches (Medium)
- **Type / Dimension:** ux-gap / ui-states
- **Files:** src/components/shared/AddTaskInput.jsx:30-31; src/components/Projects/ProjectNotes.jsx:73-74
- **Evidence:** AddTaskInput's catch is `catch { // silently fail — task creation errors are rare }` and ProjectNotes' handleCreateNote catch is `catch { // silently fail }`. Neither sets any error state, logs, nor notifies the user; the typed text stays in the input but nothing indicates the save failed.
- **Impact:** When the API errors (401 session expiry, 429 rate limit, network drop) the user presses Enter/Add, the spinner clears, and they cannot tell whether the task/note was created — likely losing the item or creating duplicates.
- **Root cause:** Error paths were intentionally stubbed out on the assumption failures are rare.
- **Siblings checked:** Contrast: QuickCapture.jsx:96-97 surfaces the same failure via flash message, and IdeaVault.jsx:76-77 via error banner — only these two inputs are silent.
- **Recommended fix:** Set an inline error message (pattern already used in the same drawer: TaskDetailDrawer noteError, lines 291-296 and 614-618) instead of an empty catch.
- **Acceptance criteria:** A failed quick-add (task or note) shows an inline error message and preserves the typed text instead of silently discarding the failure.
- **Approval bucket:** Safe fix

### FF-044 — Journal entries list has no loading state and load failures are console-only, showing a false 'No entries yet' empty state (Medium)
- **Type / Dimension:** ux-gap / ui-states
- **Files:** src/app/journal/page.js:56-62; src/app/journal/page.js:176-179
- **Evidence:** fetchEntries catches errors with only `console.error('Failed to load entries:', error)` — no error state exists on the page. entries initialises to [] and there is no isLoading flag, so the 'No entries yet. Start writing above!' branch (line 176-179) renders both while the fetch is in flight and permanently on failure.
- **Impact:** A journal user whose entries fail to load is told they have no entries — alarming for a personal journal — with no retry affordance and no indication anything went wrong.
- **Root cause:** The page tracks no loading/error state for the entries fetch.
- **Siblings checked:** handleGenerateSummary on the same page does surface failures (alert at line 145); only the entries fetch is silent.
- **Recommended fix:** Add isLoading/error state around fetchEntries, render a skeleton during load and an error banner with retry on failure.
- **Acceptance criteria:** The journal list shows a loading skeleton while fetching and an error banner with retry on failure; 'No entries yet' renders only for a genuinely empty, successful response.
- **Approval bucket:** Safe fix

### FF-045 — PlanningModal 'Finish Planning' failure is console-only — button appears to do nothing and the planning nag persists (Medium)
- **Type / Dimension:** ux-gap / ui-states
- **Files:** src/components/planning/PlanningModal.jsx:191-193
- **Evidence:** handleFinish's catch is `console.error('Failed to complete planning session:', err)` with no user-facing state; isSubmitting resets in finally so the button flips from 'Saving…' back to 'Finish Planning' with the modal still open and no message. If createPlanningSession fails, onComplete never fires so the session is never recorded.
- **Impact:** The user clicks Finish, nothing visibly happens, and because the session is unrecorded the planning banner/modal keeps re-prompting them for a session they believe they completed.
- **Root cause:** No error state in the modal's finish path.
- **Siblings checked:** Per-row actions in the same flow handle errors correctly (PlanningTaskRow.jsx:76-77, 90-91, 111-112, 126-127 set inline 'Failed to …' messages); only the finish step is silent. The section-count fetch at PlanningModal.jsx:71-73 is also console-only but is non-critical.
- **Recommended fix:** Add an error state rendered near the footer buttons on catch, prompting retry.
- **Acceptance criteria:** A failed 'Finish Planning' renders an error message near the footer buttons and the user can retry; the button no longer appears to do nothing.
- **Approval bucket:** Safe fix

### FF-046 — Calendar drag-and-drop and drawer mutations revert silently — errors only console.logged (Medium)
- **Type / Dimension:** ux-gap / ui-states
- **Files:** src/components/calendar/CalendarView.jsx:120-126; src/components/calendar/CalendarView.jsx:152-160; src/components/calendar/CalendarView.jsx:171-174; src/components/calendar/CalendarView.jsx:196-199; src/components/calendar/CalendarView.jsx:210-213
- **Evidence:** All five mutation handlers (drag-to-reschedule, drawer update, delete, move, complete) catch errors with only console.error and revert the optimistic state. Example: handleDragEnd reverts due_date and logs 'Failed to update task due date' with no UI feedback.
- **Impact:** A user drags a task to a new date, sees it land, then it snaps back (or simply stays wrong until refetch) with zero explanation — the reschedule is silently lost.
- **Root cause:** Optimistic-update pattern implemented without a user-facing failure channel on this view.
- **Siblings checked:** Same silent pattern exists in PlanBoard.jsx (complete revert 343-349, move revert 387-394, update refetch 410-413, load-more 302-303, sort-order 534-536) and ProjectsView.jsx (all handlers at 182-184, 192-194, 228-230, 250-252, 268-270, 285-287 silently loadData()). TodayView is the only board that alerts.
- **Recommended fix:** Surface failures the same way TodayView does (alert at TodayView.jsx:219/268/287) or via a shared toast; minimum: an inline error banner with the revert.
- **Acceptance criteria:** A failed calendar drag-reschedule/update/delete/move/complete shows a user-visible error alongside the optimistic revert.
- **Approval bucket:** Safe fix

### FF-047 — QuickCapture floating button overlaps the mobile bottom tab bar, covering the Ideas tab (Medium)
- **Type / Dimension:** ux-gap / ui-states
- **Files:** src/components/shared/QuickCapture.jsx:122; src/components/layout/TabBar.jsx:50; src/components/layout/AppShell.jsx:82-109
- **Evidence:** The FAB is `fixed bottom-6 right-6 z-50 h-14 w-14` with no responsive offset, while the mobile TabBar is `fixed bottom-0 ... z-50 lg:hidden` (~56px tall). Both render on tab routes (AppShell.jsx:82 and 109), and the FAB (occupying roughly 24-80px from the bottom, 295-351px from the left on a 375px screen) paints over the right-most 'Ideas' tab since it appears later in the DOM at equal z-index.
- **Impact:** On phones the Ideas tab is partially obscured and mis-taps hit the capture button instead of navigation.
- **Root cause:** The FAB's fixed offset was chosen for desktop and never adjusted for the mobile bottom navigation.
- **Siblings checked:** AppShell already compensates content padding for the tab bar (pb-20 lg:pb-6 at AppShell.jsx:94) but the FAB was missed.
- **Recommended fix:** Raise the FAB above the tab bar on small screens (e.g. `bottom-20 lg:bottom-6`) to clear the ~56px bar plus margin.
- **Acceptance criteria:** On mobile widths the QuickCapture FAB sits above the bottom tab bar (e.g. bottom-20 lg:bottom-6) and the Ideas tab is fully visible and tappable.
- **Approval bucket:** Safe fix

### FF-048 — Header ships dead UI: non-functional search box, permanent fake notification dot, hardcoded 'JD' avatar (Medium)
- **Type / Dimension:** ux-gap / ui-states
- **Files:** src/components/layout/Header.jsx:43-50; src/components/layout/Header.jsx:84-87; src/components/layout/Header.jsx:90-92
- **Evidence:** The search input has no value, onChange, or submit handler — typing does nothing on any page. The bell button has no click handler or aria-label and renders a hardcoded always-on notification dot (line 86). The avatar shows literal 'JD' initials regardless of the signed-in user.
- **Impact:** Users on every page are offered a search that silently does nothing, a notification indicator that permanently implies unread alerts, and initials that belong to no one — all eroding trust in the UI.
- **Root cause:** Placeholder scaffolding from a template was shipped without implementation.
- **Siblings checked:** Checked src/ for any search implementation or notifications API — none exist, confirming these are decorative.
- **Recommended fix:** Remove the search box, bell, and avatar until implemented, or wire the avatar to session.user and the bell to real state.
- **Acceptance criteria:** The header contains no dead controls: search box, bell dot and hardcoded avatar are removed or wired to real behaviour/session data.
- **Approval bucket:** Safe fix

### FF-049 — Weekly planning-candidates filters make unfinished this_week tasks from a previous week invisible in the planning modal (Medium)
- **Type / Dimension:** bug / known-issues
- **Files:** src/app/api/planning-candidates/route.js:93; src/app/api/planning-candidates/route.js:104
- **Evidence:** The weekly dueThisWeek bucket requires due_date >= windowDate (line 93), and the overdue bucket excludes state='this_week' (line 105: .not('state','in','("this_week","today","done")')). A task left in state='this_week' with last week's due_date fails both filters and is returned in neither bucket — exactly the bug #3 filter defect verified (✓) in the 2026-04-20 adversarial review.
- **Impact:** If the Sunday demote-week cron misses one run, a week's unfinished tasks silently vanish from the weekly planning flow until a later cron demotes them to backlog. Tasks remain reachable only via the Plan board's This Week column, not the planning modal.
- **Root cause:** The overdue bucket unconditionally excludes state='this_week', assuming the Sunday cron always demoted last week's leftovers before planning runs.
- **Siblings checked:** Checked the daily branch (lines 46-54): its overdue bucket only excludes today/done, so the gap is specific to the weekly window. Undated this_week tasks are also absent from both weekly buckets (both require a due_date comparison).
- **Recommended fix:** Include state='this_week' tasks with due_date < windowDate in the weekly overdue bucket (or a dedicated 'carried over' bucket) so the filter degrades gracefully when the cron misses.
- **Acceptance criteria:** A task left in state='this_week' with a due date before the current window appears in the weekly planning candidates (carried-over/overdue bucket).
- **Approval bucket:** Safe fix

### FF-050 — Demote crons record status='success' even when individual task updates fail (Medium)
- **Type / Dimension:** observability / known-issues
- **Files:** src/app/api/cron/demote-today-tasks/route.js:100; src/app/api/cron/demote-today-tasks/route.js:151; src/app/api/cron/demote-week-tasks/route.js:107; src/app/api/cron/demote-week-tasks/route.js:158
- **Evidence:** In both demote routes the per-task loop silently drops failed updateTask results (demote-today lines 100-102, demote-week lines 107-109), and finalStatus (lines 151/158) is 'partial' only when the email send fails. A run where some or all state flips failed is still written to cron_runs as status='success'. This is the still-open half of the 2026-04-13 Medium finding (the email-body over-reporting half was fixed).
- **Impact:** Tasks stuck in Today/This Week after a partially failed cron look like a healthy run in cron_runs, defeating the exact diagnostic the 2026-04-20 discovery spec relies on (R-2).
- **Root cause:** Update failures are only used to exclude tasks from the email list; they never feed the run status or error column.
- **Siblings checked:** Both demote routes share the identical pattern (checked both); daily-task-email has its own separate run-tracking table and was not re-verified for this pattern.
- **Recommended fix:** Track failed update count and set status='partial' (with the errors in the error column) whenever demotedTasks.length < tasks.length.
- **Acceptance criteria:** A demote run in which any individual task update fails records status='partial' with the failures captured in the error column.
- **Approval bucket:** Safe fix

### FF-051 — PlanBoard backlog due-date-first ordering is wrong across pagination pages (Medium)
- **Type / Dimension:** bug / known-issues
- **Files:** src/components/plan/PlanBoard.jsx:36; src/components/plan/PlanBoard.jsx:246; src/components/plan/PlanBoard.jsx:297; src/app/api/tasks/route.js:90
- **Evidence:** Backlog loads in pages of 20 (BACKLOG_PAGE_SIZE, line 36) from /api/tasks, which orders by sort_order ASC then created_at (tasks/route.js:90-92); compareBacklogTasks is applied client-side per accumulated set (lines 253, 297). Because pagination happens before due-date ordering, the earliest-due backlog task can sit on an unfetched page — the still-open half of the 2026-04-13 final-review Medium finding.
- **Impact:** With more than 20 backlog tasks, the visible backlog column violates the due-date-first rule until every page is manually loaded, so urgent dated tasks can be hidden below the fold.
- **Root cause:** The primary due-date ordering lives client-side while the API paginates on a different sort key.
- **Siblings checked:** The other half of the original finding (order drift after moves/updates) is now self-correcting because every apiClient.updateTask dispatches tasks-changed and PlanBoard reloads all columns (PlanBoard.jsx:272-280).
- **Recommended fix:** Order the backlog query by due_date (nulls last) then sort_order in the API before applying range pagination.
- **Acceptance criteria:** Backlog pages arrive from the API already ordered by due_date (nulls last) then sort_order, so ordering is correct across pagination boundaries.
- **Approval bucket:** Safe fix

### FF-052 — Mid-session close of the planning modal shows inconsistent candidates on reopen (no draft session state) (Medium)
- **Type / Dimension:** ux-gap / known-issues
- **Files:** src/app/api/planning-candidates/route.js:95; src/components/planning/PlanningTaskRow.jsx:53; src/components/planning/PlanningModal.jsx:44
- **Evidence:** Row 'actioned' state is purely local (PlanningTaskRow.jsx:53) and now deliberately resets on reopen (PlanningModal.jsx:44-50), while task mutations commit immediately; the weekly dueThisWeek query still includes state='this_week' (route.js:95 excludes only today/done). So weekly-accepted tasks reappear as unactioned on reopen, while daily-assigned tasks (now state='today') disappear — WF-002 from the 2026-04-14 impl review, never scheduled for fix.
- **Impact:** Closing and reopening an unfinished planning session presents a contradictory list (accepted tasks look unreviewed; assigned tasks vanish), and no session row exists to suppress the prompt.
- **Root cause:** Planning progress lives only in component state; the candidates API cannot distinguish 'accepted this session' from 'stale this_week'.
- **Siblings checked:** The related reopen-counter staleness (FINDING-03) was fixed by the reset effect; the disappearing-daily-task half is inherent to the same missing draft state.
- **Recommended fix:** Either exclude state='this_week' tasks already due in the target week from weekly candidates once accepted, or persist per-task actioned state (draft session) so reopen reconstructs progress.
- **Acceptance criteria:** Closing and reopening the planning modal mid-session shows a consistent candidate list: already-accepted tasks are not re-offered as if unactioned.
- **Approval bucket:** Safe fix

### FF-053 — No cross-tab or multi-device refresh: data views never refetch on focus/visibility (Medium)
- **Type / Dimension:** ux-gap / known-issues
- **Files:** src/components/today/TodayView.jsx:173; src/components/plan/PlanBoard.jsx:272; src/hooks/usePlanningPrompt.js:95
- **Evidence:** TodayView, PlanBoard, CalendarView and ProjectsView refetch only on mount and on window-scoped CustomEvents ('planning-complete'/'tasks-changed'), which never cross tabs; repo-wide grep finds no storage/BroadcastChannel listener and the only visibilitychange handler is in usePlanningPrompt (line 95-105), which refreshes planning prompt state, not task lists. This is the S-3/WF-007 gap from the 2026-04-20 review, still unaddressed.
- **Impact:** A second tab or device shows stale task lists indefinitely after mutations elsewhere, which also confounds diagnosis of the cron-related staleness bugs.
- **Root cause:** The mutation→refetch contract is an in-tab CustomEvent with no cross-tab or refocus reconciliation.
- **Siblings checked:** usePlanningPrompt already implements the refocus pattern, so the fix has an in-repo template; all four data views share the omission.
- **Recommended fix:** Add a visibilitychange/focus refetch to the data views (mirroring usePlanningPrompt) or broadcast mutations via BroadcastChannel/localStorage.
- **Acceptance criteria:** Returning focus to a backgrounded tab (visibilitychange) refetches the data views, so multi-tab/multi-device edits become visible without a manual reload.
- **Approval bucket:** Safe fix

### FF-054 — No morning rollover: incomplete Today tasks stay in Today until the 19:55 evening cron (bug #1 design mismatch) (Medium)
- **Type / Dimension:** ux-gap / known-issues
- **Files:** src/components/today/TodayView.jsx:113; src/app/api/cron/demote-today-tasks/route.js:28; vercel.json:17
- **Evidence:** TodayView.loadData (lines 113-126) just fetches state='today' with no calendar-boundary logic, and the only code moving tasks out of Today remains the demote cron scheduled at 55 19 * * * with a London 19-20 hour guard. The user-reported expectation 'incomplete tasks leave Today when a new day begins' (2026-04-20 discovery spec bug #1) is still unmet before evening even with healthy crons.
- **Impact:** Yesterday's unfinished tasks sit in Today all day, which is the original user complaint; whether this is a bug or intended close-of-day semantics is an unresolved product decision (R-1).
- **Root cause:** Lifecycle transitions are exclusively evening-cron-driven; no page-load or midnight rollover exists, and the reports left the intended behaviour as an open question for Peter.
- **Siblings checked:** Checked vercel.json and all cron routes: no morning/midnight job was added since the report.
- **Recommended fix:** Decide the product semantics (evening demotion vs morning rollover); if morning rollover is wanted, add an on-load or early-morning-cron demotion for state='today' tasks not updated since the previous day.
- **Acceptance criteria:** Rollover semantics are decided and implemented: incomplete Today tasks either demote in the evening (documented) or roll over at the morning boundary — observed behaviour matches the written spec.
- **Approval bucket:** Risky (needs approval) — requires a product-semantics decision (evening demotion vs morning rollover) before any code change

### FF-055 — user-settings PATCH validates start!=end against hardcoded defaults instead of the user's stored settings (Low)
- **Type / Dimension:** bug / api-contracts + known-issues
- **Files:** src/app/api/user-settings/route.js:72
- **Merged duplicates:** unverified Low "user_settings PATCH validates start/end equality against defaults, not the stored row, so zero-length planning windows can be persisted" (known-issues)
- **Evidence:** Lines 72-85 compute effectiveDaily/effectiveWeekly as `provided value || DEFAULTS.*` — the existing row in user_settings is never read, even though partial updates are allowed (line 65) and the write is an upsert of only the provided fields (lines 92-113).
- **Impact:** A user whose saved start differs from the default can save end == saved start (invalid pair persisted, since the check compared against the default), or be wrongly rejected when the new value equals the default but not their stored value. A zero-length planning window then feeds PLANNING_DEFAULTS-driven features.
- **Root cause:** Cross-field validation uses static defaults as the baseline for unspecified fields rather than the current DB row.
- **Siblings checked:** planning-sessions and planning-candidates validate their params fully (enum + regex + real-calendar-date check) — this is the only planning route with a stale-baseline check.
- **Recommended fix:** Fetch the existing user_settings row first and validate provided values merged over stored values (falling back to defaults only when no row exists).
- **Acceptance criteria:** A partial user-settings PATCH that would make the stored start equal the stored end is rejected — validation merges the request over the stored row, not over hardcoded defaults.
- **Approval bucket:** Safe fix

### FF-056 — requestCache can re-cache stale data after clearCache, and deleteProject never invalidates the projects cache (Low)
- **Type / Dimension:** data-risk / client-data
- **Files:** src/lib/requestCache.js:21; src/lib/requestCache.js:41; src/lib/apiClient.js:86; src/components/Projects/ProjectNotes.jsx:72
- **Evidence:** dedupedFetch's .then (requestCache.js:21-29) writes to the cache unconditionally when the promise resolves, so a clearCache call (41-44) that lands while the request is in flight is undone with a fresh 5s TTL of pre-mutation data. Separately, apiClient.deleteProject (86-90) does not call clearCache('projects-true'/'projects-false'), unlike createProject (70-71) and updateProject (81-82).
- **Impact:** ProjectNotes' notes-<projectId> key (ProjectNotes.jsx:27-29, cleared at 72) can serve a note list missing the just-created note for up to 5 seconds after project switches; a deleted project can be served from getProjects' cache after deletion.
- **Root cause:** Cache writes are not fenced against invalidations issued mid-flight, and the delete path was missed when invalidation calls were added.
- **Siblings checked:** Task mutations never clear the 'tasks-batch-' cache either (apiClient.js:213-222), but the only consumer (ProjectItem.js) is not imported anywhere, so that gap is dead-code-only today.
- **Recommended fix:** Record an invalidation epoch per key and skip the cache.set if clearCache ran after the request started; add the two clearCache calls to deleteProject.
- **Acceptance criteria:** clearCache during an in-flight request prevents that response from being cached (invalidation epoch), and deleteProject invalidates the projects cache keys.
- **Approval bucket:** Safe fix

## Unverified Low-severity findings

The following Low-severity findings are **plausible but were NOT adversarially verified** — treat as leads, re-verify before fixing. (The 18th, the user-settings defaults-validation finding, was independently confirmed and merged into FF-055.)

1. **Cross-section drag on the Today view never persists the drop position**
   - Files: src/components/today/TodayView.jsx:402
   - Evidence: Moving a task between must_do/good_to_do/quick_wins splices it into the target list at the drop index optimistically (lines 388-400) but PATCHes only { state: 'today', today_section } (lines 402-406) — sort_order is untouched.
   - Fix: Compute the moved task's sort_order from its new neighbours (same computeSortOrder/needsReindex logic as lines 355-367) and include it in the PATCH.
2. **Demote crons only process the single env-configured digest user; any other user's tasks are never demoted**
   - Files: src/app/api/cron/demote-today-tasks/route.js:51; src/services/dailyTaskEmailService.js:72
   - Evidence: Both demote crons resolve one user id from DIGEST_USER_EMAIL/DIGEST_USER_ID env vars (demote-today route.js:51-63, resolveDigestUserId in dailyTaskEmailService.js:72-102) and filter tasks with .eq('user_id', userId), while the app supports multiple users via NextAuth credentials.
   - Fix: Acceptable for a personal app; if multi-user is ever intended, iterate over all users (or all distinct user_ids with tasks in the source state) inside the cron.
3. **Journal summary endpoint summarises client-supplied entries with no ownership binding**
   - Files: src/app/api/journal/summary/route.js:75-82
   - Evidence: After the auth check, the handler reads `const { entries } = body` (line 78, with an inline comment noting entries are passed in 'to avoid Auth issues') and forwards that arbitrary array straight to OpenAI (lines 84-140). It never fetches the caller's own journal_entries from the DB or verifies t…
   - Fix: Fetch entries server-side scoped by `.eq('user_id', session.user.id)` for the requested date range instead of accepting them from the request body.
4. **All data access uses the service-role client with no RLS; project writes filter only by id**
   - Files: src/lib/supabaseServiceRole.js:21-28; src/app/api/projects/route.js:204-209; src/app/api/projects/route.js:262-265; src/app/api/projects/[id]/route.js:88-96; src/app/api/projects/[id]/route.js:158-161
   - Evidence: Every route uses getSupabaseServiceRole() (RLS-bypassing) and relies solely on manual `.eq('user_id', ...)` filters for isolation. Project PATCH/DELETE do a JS ownership check then issue the mutating query filtered only by `.eq('id', id)` (projects/route.js:207, 265; projects/[id]/route.js:94, 16…
   - Fix: Add `.eq('user_id', session.user.id)` to the project update/delete writes for defence-in-depth, and enable RLS policies (the migrate route already defines them) as a backstop.
5. **Cron and health secrets are compared with non-constant-time equality**
   - Files: src/lib/cronAuth.js:34; src/app/api/health/app/route.js:12; src/app/api/health/supabase/route.js:9-11
   - Evidence: Secret validation uses plain `===`/string comparison: `providedSecret === cronSecret || bearerSecret === cronSecret` (cronAuth.js:34) and `provided === secret` for the healthcheck secret. These short-circuit and are not timing-safe.
   - Fix: Compare secrets with crypto.timingSafeEqual over equal-length buffers.
6. **verify-config and session-test expose config presence and full session to admins in production, inconsistently gated**
   - Files: src/app/api/auth/verify-config/route.js:6-9; src/app/api/auth/session-test/route.js:6-9; src/app/api/auth/debug-session/route.js:6-9; src/app/api/debug-env/route.js:7-10
   - Evidence: verify-config and session-test gate with `if (!isDevelopment() && !isAdminSession(session))` (OR semantics — admins pass in production), returning full session data, cookie presence, and which env vars are set/unset. debug-session and debug-env use `if (!isDevelopment() || !isAdminSession(session…
   - Fix: Make all four dev-only (use the `!isDevelopment() || !isAdminSession` form) or remove the debug endpoints from production builds entirely.
7. **tasks/sort-order: item shape never validated and duplicate ids falsely fail the ownership check**
   - Files: src/services/taskService.js:256; src/app/api/tasks/sort-order/route.js:24; supabase/migrations/20260404000001_prioritisation_replacement.sql:199
   - Evidence: updateSortOrder (taskService.js:256-277) never checks that each item has a UUID id and integer sort_order before passing JSON to fn_batch_update_sort_order, whose casts `(item->>'sort_order')::integer` (migration lines 199-210) throw on garbage; the raw Postgres error message is returned to the c…
   - Fix: Validate each item (UUID id, Number.isInteger(sort_order)) and de-duplicate ids before the ownership query; map ownership failure to 404 like updateTask/deleteTask.
8. **Inconsistent response envelopes and status codes across CRUD routes**
   - Files: src/app/api/projects/[id]/route.js:100; src/app/api/tasks/[id]/route.js:48; src/app/api/journal/entries/route.js:122; src/app/api/notes/route.js:142
   - Evidence: PATCH /api/projects/[id] returns the bare row and 400 for DB update errors (lines 100, 109) while PATCH /api/projects returns {data} and 500 (projects/route.js:213, 222); PATCH /api/tasks/[id] returns bare data (tasks/[id]/route.js:48) vs {data} on the collection route (tasks/route.js:206); GET /…
   - Fix: Standardise on {data}/{error, details} with 201 for creates, 400 for validation, 404/403 for ownership, 500 for DB faults, across both twin routes of tasks and projects.
9. **supabaseRequest.js imports retryWithBackoff from the wrong module — undefined at runtime**
   - Files: src/lib/supabaseRequest.js:1; src/lib/errorHandler.js:134
   - Evidence: supabaseRequest.js:1 does `import { retryWithBackoff } from './apiClient'`, but apiClient.js exports only the apiClient singleton; the real retryWithBackoff lives in errorHandler.js:134. Any call to supabaseRequest with operation 'fetch'/'select' would throw 'retryWithBackoff is not a function' a…
   - Fix: Either fix the import to './errorHandler' or delete supabaseRequest.js (its pagination helpers are duplicated by the API routes' own logic).
10. **useApiClient hook exposes stale endpoints and parameters the API no longer supports**
   - Files: src/hooks/useApiClient.js:36; src/hooks/useApiClient.js:44; src/hooks/useApiClient.js:74
   - Evidence: tasks.list (74-84) sends includeCompleted/range/days/includeOverdue, none of which the current GET /api/tasks parses (route.js:54-95 supports state/states/completedSince only); projects.get (44-49) downloads the entire project list to find one id. The hook's mutations also never dispatch 'tasks-c…
   - Fix: Delete the unused task/project mutation methods from useApiClient (keeping notes.list/create and projects.list), or fold the drawer onto the apiClient singleton and remove the hook.
11. **Journal summary labels entries with server-UTC toLocaleDateString, shifting late-night entries to the previous day**
   - Files: src/app/api/journal/summary/route.js:91
   - Evidence: journal/summary/route.js:91 builds per-entry date labels with `new Date(entry.created_at).toLocaleDateString()` in an API route, which formats in the server's timezone (UTC on Vercel) and default locale.
   - Fix: Format with Intl.DateTimeFormat('en-GB', { timeZone: LONDON_TIME_ZONE }) or reuse getLondonDateKey(entry.created_at).
12. **Disconnect swallows vault and mapping cleanup failures, potentially orphaning live refresh tokens**
   - Files: src/services/office365ConnectionService.js:86-93
   - Evidence: deleteOffice365Connection calls deleteSecret(...).catch(() => {}) for both token secrets (lines 86-87) and ignores the results of the two mapping-table deletes (89-90), then deletes the connection row regardless. If a vault RPC fails, the connection row (holding the only reference to the secret i…
   - Fix: Delete the secrets first and abort (or retry) if that fails before removing the connection row, and check the mapping delete errors.
13. **Task drawer notes fetch failure is swallowed and displays 'No notes yet.'**
   - Files: src/components/shared/TaskDetailDrawer.jsx:163-170; src/components/shared/TaskDetailDrawer.jsx:582-583
   - Evidence: fetchNotes destructures `{ data, error }` and only sets notes when `!error && data`; the error branch does nothing, leaving notes as []. The render then shows the empty-state text 'No notes yet.' (line 583).
   - Fix: Set a notesLoadError state on error and render it with a retry link in place of the empty-state text.
14. **Planning modal title/labels computed once per render: 'Plan Your Day' vs 'Tomorrow' goes stale if the modal stays open across London midnight**
   - Files: src/components/planning/PlanningModal.jsx:220
   - Evidence: todayLondon = getLondonDateKey() is evaluated during render (line 220) and targetIsToday/dailyLabel/section headings derive from it (lines 221-225, 240); no timer or visibility recheck forces a re-render at midnight. FINDING-10 from the 2026-04-17 review, unchanged.
   - Fix: Add a minute-interval or visibilitychange-based re-evaluation of todayLondon while the modal is open.
15. **Opening the planning modal still triggers Office365 auto-sync as a side effect (consciously accepted, documented as TODO)**
   - Files: src/components/planning/PlanningModal.jsx:53; src/app/api/tasks/route.js:38
   - Evidence: The modal's section-count fetch and getMaxSortOrder still call apiClient.getTasks → GET /api/tasks, which fires maybeAutoSyncOffice365 in the background (tasks/route.js:38-49). The original AB-006/SEC-003 Medium finding was resolved by documenting acceptance (PlanningModal.jsx:53-55 TODO comment,…
   - Fix: If revisited, add section counts/max sort_order to /api/planning-candidates or honour a noSync=true param, per the in-code TODO.
16. **PlanningModal still receives a dead isManual prop**
   - Files: src/components/planning/PlanningModal.jsx:24; src/components/layout/AppShell.jsx:106
   - Evidence: isManual is destructured with a default (line 24) and passed from AppShell (line 106) but never read anywhere in the component body — FINDING-06 from the 2026-04-17 review, unchanged.
   - Fix: Resolve together with the combined-flow fix: either use isManual to gate isSundayCombined or delete the prop end-to-end.
17. **Project CLAUDE.md describes an architecture that no longer exists**
   - Files: CLAUDE.md:84; CLAUDE.md:92; CLAUDE.md:101
   - Evidence: CLAUDE.md still lists src/components/Projects/ProjectBoard.tsx and src/components/Tasks/TaskSection.tsx as key files (neither exists), and states 'Direct Supabase queries in components (not server actions)' and 'all data fetching is client-side via direct Supabase calls', while the codebase route…
   - Fix: Update the Development Patterns, Key Files and schema sections to the current apiClient/route-handler architecture and the state-based task model.

## Refuted during verification

Do not re-report these — an independent verification agent examined and rejected them:

- Completing a task is irreversible in the UI — every 'un-complete' affordance is dead code — verifier verdict: the cited sub-facts are accurate (checkbox handlers always PATCH state:'done'; PlanBoard keys off dropped is_completed/status columns; Calendar fetches only non-done states; drawer shows a read-only badge) but the headline claim "irreversible in the UI / no way back except direct API" is false — a working un-complete path exists. The real, narrower defect is captured as confirmed FF-005.

## Top risks summary

The five findings with the worst real-world impact for a single-user personal planner, weighing silent data loss and dead automation above cosmetic issues:

1. **FF-001 — Office365 pull inserts invalid state `todo` (Critical).** Every new active task created in Outlook silently fails the DB state constraint and never imports, so the planner quietly diverges from Outlook with no error surfaced — silent capture loss at the heart of the integration.
2. **FF-012 — Deleting a Microsoft To Do list hard-deletes every local task in that project (High).** A routine tidy-up in Outlook irreversibly destroys local planner data with no confirmation and no recovery path — the single worst data-loss failure mode found.
3. **FF-002 — Demote crons fire inside the 20:05 planning window during BST (High).** For half the year the app can wipe the plan minutes after the user makes it: the automation actively destroys the user's own planning work, silently, on a schedule.
4. **FF-009 — office365-sync cron rejects Vercel's Bearer header and 401s every minute (High).** The entire background sync is dead automation in production; combined with FF-011 (expired refresh token dies silently), the O365 integration can be completely inert with zero user-visible signal.
5. **FF-005 — Completed-state logic reads columns dropped by migration (High).** The core daily loop is broken: tasks completed today render as incomplete and cannot be un-completed, undermining trust in every view and inviting duplicate "completions" that re-stamp timestamps (see also FF-020).
