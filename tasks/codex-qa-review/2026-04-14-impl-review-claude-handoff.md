# Claude Hand-Off Brief: Smart Planning Prompts (Post-Implementation)

**Generated:** 2026-04-14
**Review mode:** Spec Compliance (Mode C)
**Overall risk assessment:** Critical (migration schema mismatch = feature is DOA)

## DO NOT REWRITE
- API route auth patterns (all correct)
- API client methods (match route contracts)
- View invalidation via planning-complete event (works correctly)
- planning-candidates endpoint (server-side filtering, no O365 sync, correct queries)
- planning-sessions upsert logic (correct UNIQUE + ON CONFLICT)
- PlanningBanner component logic (all variants present)
- PlanningTaskRow UI structure (section pills, defer picker, chips display)
- AppShell mounting structure (banner in main, modal outside main)
- Sidebar planning link

## IMPLEMENTATION CHANGES REQUIRED

### Blocking (feature won't work without these)

- [ ] **IMPL-001: Rewrite migration SQL.** `supabase/migrations/20260414000001_add_planning_tables.sql` — the `user_settings` table must create columns `daily_plan_start time`, `daily_plan_end time`, `weekly_plan_start time`, `weekly_plan_end time` with defaults '20:05'/'20:00'. Remove `daily_planning_enabled`, `weekly_planning_enabled`, `planning_snooze_until`. The `planning_sessions` table should match the spec: only `id`, `user_id`, `window_type`, `window_date`, `completed_at`, `created_at`. Remove `started_at`, `dismissed_at`, `tasks_promoted`, `tasks_added`. Make `completed_at` NOT NULL DEFAULT now().

- [ ] **IMPL-002: Fix Sunday combined flow — fetch daily candidates in step 2.** `src/components/planning/PlanningModal.jsx` — when `handleFinish` transitions from weekly to daily step, it must fetch daily candidates via `apiClient.getPlanningCandidates('daily', windowDate)` and update the tasks state. Also gate `isSundayCombined` on actual Sunday (check day of week), not just `windowType === 'weekly'`.

- [ ] **IMPL-003: Fix weekly window detection.** `src/lib/planningWindow.js` — `isInsideWindow()` logic is wrong for the weekly case where start > end (20:05→20:00 is almost 24 hours). The weekly window should only be active from Sunday 20:05 through Monday 20:00 as the primary planning window. For Tue-Sat "revisiting", either remove it or add explicit day-of-week checks. The current overnight-wrap logic incorrectly activates at Sunday 10am.

- [ ] **IMPL-004: Fix cron schedule.** `vercel.json` — remove the `55 18` entries. Only keep `55 19` for both demote crons. This fires at 19:55 UTC which is either 19:55 GMT or 20:55 BST — both are before the 20:05 planning window in their respective seasons. Update the cron route guards to accept London hours 19-20 (not 18-20).

### High Priority

- [ ] **IMPL-005: Fix optimistic UI — await mutations before marking actioned.** `src/components/planning/PlanningTaskRow.jsx` — change `onAssign`/`onSkip`/`onDefer` to return promises. Await them before setting `isActioned`. Show error state on failure instead of success checkmark.

- [ ] **IMPL-006: Allow sort_order through task updates.** `src/services/taskService.js` — ensure `sort_order` is in the allowed update fields (check `filterTaskUpdates` or equivalent). The planning modal sends sort_order but it gets stripped.

### Medium Priority

- [ ] **IMPL-007: Fix banner gating.** `src/components/layout/AppShell.jsx:81` — change condition from `planning.totalCandidates > 0` to `planning.isActive` so the planned/revisit banner persists even when candidate list is empty.

- [ ] **IMPL-008: Fix banner copy.** `src/components/planning/PlanningBanner.jsx` — use `tasks.dueTomorrow?.length` for daily copy instead of `totalCandidates`. Say "tasks to plan" not "tasks due tomorrow" when the count includes overdue/undated.

- [ ] **IMPL-009: Fix defer backlog logic.** `src/components/planning/PlanningModal.jsx` `handleDefer` — for daily mode, compute the actual end of the current week (Sunday) from today's date, not `windowDate + 6`. Import `getMondayOfWeek` from planningWindow.js and use Monday + 6 as the boundary.

- [ ] **IMPL-010: Avoid O365 sync in modal.** `src/components/planning/PlanningModal.jsx` — for section counts and sort_order lookups, either: (a) add these fields to the `/api/planning-candidates` response, or (b) create a lightweight `/api/tasks/counts` endpoint that skips O365 sync, or (c) pass `noSync=true` query param and honour it in the tasks route.

- [ ] **IMPL-011: Wire settings invalidation.** Either: (a) call `planning.refreshSettings()` from the settings page after save (requires passing it down or using a global event), or (b) dispatch a `settings-updated` custom event that the hook listens for.

- [ ] **IMPL-012: Fix hasNewTasks detection.** `src/hooks/usePlanningPrompt.js` — `hasNewTasks` should only be true if candidates exist that are NOT in the states they'd be in after planning (i.e., not already in 'today' for daily, not already in 'this_week' for weekly). Currently any non-empty candidate set triggers it.

## REVISION PROMPT

Fix the smart planning prompts implementation based on adversarial review findings.

Apply in this order:

1. **IMPL-001** (migration) — rewrite the SQL to match the spec schema
2. **IMPL-004** (cron) — fix vercel.json and route guards
3. **IMPL-003** (window detection) — fix planningWindow.js
4. **IMPL-002** (Sunday flow) — fetch daily candidates in modal step 2
5. **IMPL-006** (sort_order) — unblock in taskService
6. **IMPL-005** (optimistic UI) — await mutations
7. **IMPL-007 through IMPL-012** (medium fixes)

After fixes, verify:
- [ ] Migration creates correct columns matching API code
- [ ] Cron fires at correct time in both GMT and BST
- [ ] Sunday 10am London does NOT activate weekly window
- [ ] Sunday 20:10 → weekly step → daily step has data
- [ ] sort_order persists through updateTask
- [ ] Failed PATCH shows error, not success
