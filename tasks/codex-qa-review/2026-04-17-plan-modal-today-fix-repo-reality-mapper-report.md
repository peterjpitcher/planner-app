**Inspected**
- Working-tree diff: `src/components/planning/PlanningModal.jsx`, plus unrelated diff entries in `.gitignore` and `supabase/.temp/cli-latest`.
- [PlanningModal.jsx](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/planning/PlanningModal.jsx:1)
- [PlanningTaskRow.jsx](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/planning/PlanningTaskRow.jsx:1)
- [usePlanningPrompt.js](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/hooks/usePlanningPrompt.js:1)
- [planningWindow.js](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/lib/planningWindow.js:1)
- [timezone.js](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/lib/timezone.js:1)
- [constants.js](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/lib/constants.js:1)
- [AppShell.jsx](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/layout/AppShell.jsx:1)
- [Header.jsx](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/layout/Header.jsx:1)
- [planning-sessions route](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/app/api/planning-sessions/route.js:1)
- [planning-candidates route](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/app/api/planning-candidates/route.js:1)
- [taskService.js](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/services/taskService.js:1)
- [dateUtils.js](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/lib/dateUtils.js:1)
- [TodayView.jsx](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/today/TodayView.jsx:1)
- Additional glue read for factual flow: [apiClient.js](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/lib/apiClient.js:1), [tasks route](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/app/api/tasks/route.js:1), [authServer.js](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/lib/authServer.js:1), [supabaseServiceRole.js](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/lib/supabaseServiceRole.js:1)
- `src/lib/__tests__/` listing and `rg` search for `planningWindow`, `timezone`, `getActivePlanningWindow`, `getLondonDateKey`, `getTimeZoneParts`, `getMondayOfWeek`.

**Not Inspected**
- Individual test file bodies under `src/lib/__tests__/`: skipped because the targeted search found no tests referencing `planningWindow` or `timezone`; only `validators.test.js` contains the string `planning` as a task type.
- `.claude/worktrees/*/CLAUDE.md`: skipped because the project rule file requested here is root `CLAUDE.md`.
- `PlanningBanner.jsx`: skipped because `AppShell.jsx` shows its inputs for this flow; banner internals are outside the requested modal/task movement path.

**Flow Map: App Open At 09:00 London, Friday 2026-04-17**
1. `AppShell` mounts `usePlanningPrompt()` and passes planning controls into `Header` and `PlanningModal`.
2. `usePlanningPrompt` runs `checkPlanningState()` on mount/pathname change.
3. It fetches user settings through `apiClient.getUserSettings()`.
4. It calls `getActivePlanningWindow(settings)`.
5. In `getActivePlanningWindow`, London parts are computed through `getTimeZoneParts(now, 'Europe/London')`.
6. With default bounds at 09:00 on Friday:
   - Weekly branch does not fire: day is Friday, not Sunday after weekly start and not Monday before weekly end.
   - Daily window check fires: default `20:05` to `20:00` wraps overnight, and `09:00 < 20:00`.
   - Daily “before end time / after midnight” branch fires.
   - Return value is `{ isActive: true, windowType: 'daily', windowDate: '2026-04-17' }`.
7. `usePlanningPrompt` stores that state with `isManual: false`.
8. It calls `GET /api/planning-sessions?windowType=daily&windowDate=2026-04-17`.
9. If no session exists, `isPlanned` is false.
10. It calls `GET /api/planning-candidates?windowType=daily&windowDate=2026-04-17`.
11. Daily candidates returned:
   - `dueTomorrow`: tasks with `due_date = '2026-04-17'`, excluding `state in ("today","done")`.
   - `overdue`: tasks with `due_date < '2026-04-17'`, excluding `state in ("today","done")`.
   - `undatedThisWeek`: tasks with `state = 'this_week'` and `due_date IS NULL`.
12. If any candidate bucket has tasks and `lastCheckRef` is not already `daily-2026-04-17`, `showModal` becomes true.
13. `AppShell` renders `PlanningModal` when `(planning.isActive || planning.showModal) && !planning.isLoading`.
14. `PlanningModal` receives `windowType='daily'`, `windowDate='2026-04-17'`, `isManual=false`.
15. Claude’s changed title logic compares `windowDate` to `getLondonDateKey()`.
16. On 2026-04-17 London, `targetIsToday` is true.
17. Modal title becomes `Plan Your Day — Friday 17th April`.
18. The first daily section label becomes `Due Today`, even though the API bucket name remains `dueTomorrow`.

**Flow Map: Must Do Pill To Visible Today Task**
1. `PlanningModal` renders each candidate as `PlanningTaskRow` with `mode='daily'`.
2. User clicks `Must Do`.
3. `PlanningTaskRow.handleAssignSection('must_do')` calls `onAssign(task.id, { state: 'today', today_section: 'must_do' })`.
4. `PlanningModal.handleAssign` calls `getMaxSortOrder('today', 'must_do')`.
5. `getMaxSortOrder` calls `apiClient.getTasks(null, { state: 'today' })`.
6. `apiClient.getTasks` calls `GET /api/tasks?state=today`.
7. `/api/tasks` uses `getAuthContext`, which reads the NextAuth session, then queries Supabase service role for the user’s `state='today'` tasks.
8. `PlanningModal` computes max `sort_order` within the target section.
9. It calls `apiClient.updateTask(taskId, { state: 'today', today_section: 'must_do', sort_order: max + 1 })`.
10. `apiClient.updateTask` sends `PATCH /api/tasks` with `{ id, state, today_section, sort_order }`.
11. `/api/tasks` PATCH authenticates via NextAuth and calls `taskService.updateTask`.
12. `taskService` allows both `state` and `today_section` in `TASK_UPDATE_FIELDS`.
13. If state changes to `today`, `entered_state_at` is set; because `today_section` is provided, the default `good_to_do` fallback is not used.
14. Supabase `tasks` row is updated.
15. `PlanningModal` increments section count and `assignedCount`.
16. `PlanningTaskRow` switches to its actioned local UI and shows `→ Must Do`.
17. The task is visible in `TodayView` after `TodayView.loadData()` runs.
18. `TodayView.loadData()` fetches `apiClient.getTasks(null, { state: 'today' })`, groups by `today_section`, sorts by `sort_order`, and renders `TodaySection`.
19. If `TodayView` is already mounted behind the modal, its planning-specific refetch is triggered by the later `planning-complete` event, not by the Must Do click itself.
20. If the user navigates to Today later, `TodayView` fetches on mount and sees the updated task.

**Flow Map: Finish Planning**
1. User clicks `Finish Planning`.
2. `PlanningModal.handleFinish` computes `hasCandidates = currentTasks.length > 0`.
3. Claude’s changed guard: if there are candidates and `assignedCount === 0`, it opens `window.confirm`.
4. If the user cancels confirmation, `handleFinish` returns and records nothing.
5. If the user confirms, or if `assignedCount > 0`, it continues.
6. Normal daily flow calls `apiClient.createPlanningSession(windowType, windowDate)`.
7. `apiClient.createPlanningSession` sends `POST /api/planning-sessions`.
8. `POST /api/planning-sessions` validates NextAuth session, `windowType`, and `windowDate`.
9. It upserts only `user_id`, `window_type`, `window_date`, and `completed_at` into `planning_sessions`.
10. It does not update or move any task rows.
11. After session creation, `PlanningModal` calls `onComplete()`.
12. `usePlanningPrompt.onPlanningComplete` closes the modal, clears manual override, marks planned, clears `hasNewTasks`, stores current candidate count, dispatches `window` event `planning-complete`, then calls `checkPlanningState()` again.
13. `TodayView` listens for `planning-complete` and calls `loadData()`.
14. Sunday combined special case: if `windowType === 'weekly'` and current step is weekly, Finish records the weekly session, fetches daily candidates with `getPlanningCandidates('daily', windowDate)`, switches modal step to daily, resets skips and `assignedCount`, and does not call `onComplete()` yet.

**Key Constants**
- `STATE`: `today`, `this_week`, `backlog`, `waiting`, `done`.
- `TODAY_SECTION`: `must_do`, `good_to_do`, `quick_wins`.
- `WINDOW_TYPE`: `daily`, `weekly`.
- `PLANNING_DEFAULTS`:
  - `DAILY_START = '20:05'`
  - `DAILY_END = '20:00'`
  - `WEEKLY_START = '20:05'`
  - `WEEKLY_END = '20:00'`
- `SOFT_CAPS`: Must Do `5`, Good to Do `5`, Quick Wins `8`, This Week `15`.

**Known Invariants**
- All active planning-window date calculations use Europe/London via `getTimeZoneParts`.
- Auto daily `windowDate` is tomorrow after the daily start time, and today after midnight before the daily end time.
- Auto weekly `windowDate` is the Monday of the target week: Sunday after weekly start returns next day; Monday before weekly end returns that Monday.
- Weekly checks run before daily checks.
- Daily and weekly end comparisons are exclusive: `< end`.
- Manual daily planning targets the current London date.
- Manual weekly planning targets `getMondayOfWeek(today)`, so on Friday 2026-04-17 it targets Monday 2026-04-13.
- `getMondayOfWeek(dateKey)` returns the Monday ISO date for the provided week.
- `planning-sessions` records completion only; task movement happens only through per-task `updateTask` actions.
- `PlanningModal` currently accepts `isManual`, and `AppShell` passes it, but title/section wording now uses `windowDate === getLondonDateKey()` instead of `isManual`.

**Date Tag Reality**
- `PlanningTaskRow` displays a due-date badge from `getDueDateStatus`.
- `getDueDateStatus('2026-04-17')` parses a date-only string, compares it with `new Date()`, and checks `daysDiff === 0 && isPast(date)` before `isToday(date)`.
- At 09:00 on 2026-04-17, a same-day date-only task can receive label `Overdue` because parsed midnight is already in the past.

**Repo Conventions That Matter**
- Project `CLAUDE.md` says this is Next.js 15.3 App Router.
- Auth convention is NextAuth.js v5, not Supabase Auth.
- Inspected API routes use `getAuthContext()` / NextAuth session checks.
- Inspected database operations use Supabase service-role direct queries through `getSupabaseServiceRole()`.
- Planning/timezone files are plain JavaScript: `planningWindow.js`, `timezone.js`.
- Project rules say no server actions and note test runner as not configured / tech debt.
- Current working-tree diff includes three changed files; only `PlanningModal.jsx` is part of the planning modal behavior.