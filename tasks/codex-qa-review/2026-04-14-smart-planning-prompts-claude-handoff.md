# Claude Hand-Off Brief: Smart Planning Prompts

**Generated:** 2026-04-14
**Review mode:** Spec Compliance (Mode C)
**Overall risk assessment:** High (3 blocking issues, all spec-level)

## DO NOT REWRITE

- Two-window model (daily + weekly) with configurable per-user times
- Sunday combined flow (weekly step 1, daily step 2)
- Task surfacing categories: due tomorrow, overdue, undated THIS_WEEK (daily) / due this week, overdue (weekly)
- Section assignment during daily planning (MUST_DO/GOOD_TO_DO/QUICK_WINS)
- Soft cap warnings with allow-override
- "Finish Planning" / "Do This Later" modal flow
- planning_sessions as a separate table (decoupled from tasks)
- Client-driven approach (no push notifications)
- Reuse of updateTask mutation path for individual task changes

## SPEC REVISION REQUIRED

- [ ] **CRIT-001: Add planning query requirement.** The spec currently says "fetches candidate tasks via the existing /api/tasks endpoint with appropriate filters" — this is false. The API has no due-date filtering. Change to: "A new `/api/planning-candidates` GET endpoint returns tasks matching the planning window criteria, with server-side filtering by due_date range, state exclusions, and null due_date handling. Alternatively, extend `/api/tasks` with `dueDateFrom`, `dueDateTo`, `dueDateIsNull`, and `excludeStates` query params."

- [ ] **CRIT-002: Define cron/planning interaction.** The spec says "existing demote crons continue independently" — they conflict directly. The demote-today cron runs at hour 20 and moves ALL today tasks to this_week, which can undo planning done at 20:05+. Add to spec: "The demote crons must be updated to skip tasks where `entered_state_at` is within the last 12 hours, preventing freshly-planned tasks from being demoted. Alternatively, shift cron execution to 19:55 (before the planning window opens)."

- [ ] **CRIT-003: Add auth and validation requirements.** Add a new "Security" section: "All new API routes must: (1) call `getAuthContext(request)` and return 401 if no session, (2) derive `user_id` from `session.user.id` — never accept it from the client, (3) validate request bodies with Zod schemas, (4) return 400 with descriptive errors for invalid input."

- [ ] **SPEC-D1: Replace "priority indicator" with "chips badges and task type icon".** The priority column was removed. Current task display uses chips (HIGH_IMPACT, URGENT, etc.) and task_type.

- [ ] **SPEC-D2: Clarify weekly window semantics.** "20:05 Sunday → 20:00 next Sunday" conflicts with "Sundays only". Clarify: the weekly planning window opens on Sunday evening and remains available through the week as a revisitable prompt, with the primary intent being Sunday evening planning.

- [ ] **SPEC-D3: Define defer state transition.** Add: "When deferring a task to a date outside the current week, the state is also changed to `backlog`. When deferring within the current week, state remains unchanged."

- [ ] **SPEC-D4: Document skip-overdue behaviour.** Add: "Skipped overdue tasks will reappear in subsequent planning sessions until the user actively defers, completes, or moves them. This is intentional — overdue items should not silently disappear."

- [ ] **SPEC-D5: Add isLoading to hook contract.** Change hook return to: `{ isActive, windowType, isPlanned, isLoading, tasks, openModal }`. Add: "The modal and banner must not render until `isLoading` is false. This prevents flash-of-modal on slow networks and avoids conflating 'no tasks' with 'tasks loading'."

- [ ] **SPEC-D6: Add weekly/combined banner copy.** Add variants: "You have N tasks due this week — Plan now" (weekly, not yet planned), "Week planned — Revisit" (weekly, planned), and combined Sunday copy.

- [ ] **ARCH-D1: Specify mount points.** Add: "PlanningModal mounts as a fixed-position sibling in AppShell with z-index above all navigation elements. PlanningBanner mounts inside `<main>` below TabBar and above `{children}`. Ensure `/calendar` is included in route gating."

- [ ] **ARCH-D2: Define view invalidation.** Add: "When the planning modal closes after task mutations, emit a custom event or call a callback that triggers the active view to refetch its task data. Additionally, add a `visibilitychange` listener to refetch planning state when the tab regains focus."

- [ ] **ARCH-D3: Define sort order for planned tasks.** Add: "Tasks moved to TODAY during planning are appended to the end of their target section (sort_order = max existing + 1 in that section). Tasks moved to THIS_WEEK during weekly planning are appended to the end of the THIS_WEEK list."

- [ ] **ARCH-D4: Add DB constraints.** Add to planning_sessions schema: "UNIQUE constraint on `(user_id, window_type, window_date)`. Use upsert (ON CONFLICT UPDATE `completed_at`) for idempotent writes. Add CHECK constraint on `window_type` IN ('daily', 'weekly')." Add to user_settings: "`updated_at` column with auto-update trigger. RLS policies matching existing table patterns."

## ASSUMPTIONS TO RESOLVE

- [ ] **Cron timing strategy:** Do you prefer (a) updating crons to skip recently-planned tasks via `entered_state_at` check, or (b) shifting cron execution to 19:55 before the planning window? → Ask the user.

- [ ] **Planning query approach:** Do you prefer (a) a new `/api/planning-candidates` endpoint, or (b) extending `/api/tasks` with date-range filters? → Implementation decision, but (a) is cleaner for this use case.

- [ ] **Session-level vs task-level tracking:** Current spec tracks sessions only. Should we add a `planning_session_items` table to track per-task decisions (accepted/skipped/deferred)? This enables reliable "new tasks" detection and skip-vs-unhandled distinction. → Ask the user — adds complexity but solves WF-D1 and WF-D2.

- [ ] **"Plan tomorrow" timing semantics:** When the user plans "tomorrow" at 20:30 tonight, tasks move to `state='today'` immediately. This means they appear in the Today view right now, tonight. Is that the intended behaviour, or should planned-for-tomorrow tasks only appear in Today view from midnight onwards? → Ask the user — affects whether a staging mechanism is needed.

## REPO CONVENTIONS TO PRESERVE

- Auth pattern: `getAuthContext(request)` → `getSupabaseServiceRole()` → manual `user_id` scoping → `NextResponse.json()`
- Use PATCH (not PUT) for update routes to match existing convention
- UUID primary keys, `auth.users` FK for user_id, `timestamptz` for dates
- CHECK constraints for text enums (like existing state/today_section checks)
- `updated_at` triggers on settings-style tables
- Task mutations through `apiClient.updateTask()` → `PATCH /api/tasks` → `taskService.updateTask()`
- London timezone via `getStartOfTodayLondon()` pattern — but note most date helpers use local time

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] CRIT-002: Re-review cron interaction after timing strategy is chosen
- [ ] CRIT-001: Re-review planning query after endpoint is designed
- [ ] ARCH-D2: Re-review invalidation mechanism after implementation approach is decided

## REVISION PROMPT

You are revising the Smart Planning Prompts spec based on an adversarial review.

Apply these changes in order:

1. **Spec revisions (blocking):**
   - Replace "fetches candidate tasks via existing /api/tasks" with a dedicated planning-candidates endpoint or extended task API
   - Add cron/planning interaction section defining how demote crons and planning coexist
   - Add Security section with auth, user_id derivation, and Zod validation requirements

2. **Spec revisions (non-blocking):**
   - Replace "priority indicator" with "chips badges and task type icon"
   - Clarify weekly window semantics
   - Add defer state transition rules
   - Document skip-overdue behaviour as intentional
   - Add isLoading to hook return
   - Add weekly/combined banner copy
   - Specify exact mount points in AppShell
   - Add view invalidation mechanism
   - Define sort_order for planned tasks
   - Add DB constraints (UNIQUE, CHECK, upsert, RLS)

3. **Preserve these decisions:** Two-window model, Sunday combined flow, surfacing categories, section assignment, soft caps, client-driven approach, planning_sessions table

4. **Flag for human review:** Cron timing strategy, planning query approach, session-level vs task-level tracking, "plan tomorrow" timing semantics
