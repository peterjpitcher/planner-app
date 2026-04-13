# Claude Hand-Off Brief: Task Auto-Demote, Backlog Sort & Calendar View

**Generated:** 2026-04-13
**Review mode:** Spec Compliance (Mode C)
**Overall risk assessment:** Medium (2 blocking, 6 medium, 6 advisory)

## DO NOT REWRITE

- Email infrastructure — `sendMicrosoftEmail()` with client credentials OAuth2 is confirmed working from cron contexts
- Bulk state update approach — PostgreSQL atomicity with per-row trigger `fn_task_state_cleanup` is correct
- Calendar DndContext isolation — separate page, separate context, no conflicts
- Calendar page architecture — thin page.js wrapper → CalendarView component
- Task ownership verification on PATCH — `updateTask` already checks `user_id`
- `cron_runs` table schema — `UNIQUE(operation, run_date)` with RLS + service_role-only access is correct
- Two-tier backlog sort design (due_date → sort_order) — correct decision
- All four original requirements are fully covered in the spec

## SPEC REVISION REQUIRED

- [ ] **SPEC-1: Idempotency pattern** — Change "query... if already run, return early" to atomic INSERT-first claim pattern. Insert `(operation, run_date, status='claimed')`, catch unique violation `23505` to detect duplicate. Match the existing `daily_task_email_runs` claim pattern in `dailyTaskEmailService.js`.

- [ ] **SPEC-2: Add London-hour guard** — Before executing, check that the current hour in `Europe/London` is 20 (use `getTimeZoneParts()` from `src/lib/timezone.js`). This ensures 19:00 UTC fires only during BST and 20:00 UTC fires only during GMT. Add this check to both cron endpoints.

- [ ] **SPEC-3: Fix backlog sort description** — Remove claim that backlog "switches from `compareTasksBySortOrderAsc`" — PlanBoard uses server-side order, not a client-side sort function. Instead specify: "Add client-side `.sort(compareBacklogTasks)` to the backlog tasks array before rendering in `PlanBoard.jsx`." Note that drag-reorder only affects position within the same due-date group.

- [ ] **SPEC-4: Specify MonthStrip/EdgeNavigator DnD approach** — dnd-kit has no native hover-delay-while-dragging. Specify: make each month label and edge zone a droppable (`useDroppable`). Track `onDragOver` events with `setTimeout`/`clearTimeout` — after the delay (400ms for months, 500ms for edges), call `setCurrentMonth()` to navigate. The drop itself still targets CalendarDayCell. This is custom but straightforward with dnd-kit's droppable API.

- [ ] **SPEC-5: Add empty sweep handling** — When zero tasks match the sweep query, skip email, log `cron_runs` with `tasks_affected = 0`, return `{ skipped: true, reason: 'no_tasks' }`. Follow existing pattern from daily-task-email.

- [ ] **SPEC-6: Task fetching pagination** — Specify: use `getAllTasks()` from `useApiClient` (which handles pagination) with `states=today,this_week,backlog,waiting`. Do not use `getTasks()` which has a 200-task limit.

- [ ] **SPEC-7: Email via environment variable** — Replace hardcoded `peter@orangejelly.co.uk` with `process.env.DEMOTE_EMAIL_TO || process.env.DAILY_TASK_EMAIL_TO`. Follow existing env-var pattern.

- [ ] **SPEC-8: Cron HTTP method** — Change endpoint descriptions from POST to GET. Vercel cron sends GET requests. Match existing cron handler exports (`export async function GET(request)`).

- [ ] **SPEC-9: Add minor spec details:**
  - Calendar sidebar sort order: `due_date ASC` for overdue tasks, `created_at DESC` for undated
  - Calendar intra-day task order: `sort_order ASC`, no drag-reorder within a single day cell
  - Calendar collision detection: `pointerWithin` for the dense grid
  - Sidebar Lucide icon: `Calendar` from `lucide-react`
  - Cron user_id scoping: query tasks with `.eq('user_id', userId)` using resolved user ID

## IMPLEMENTATION CHANGES REQUIRED

None yet — spec-only review, no code written.

## ASSUMPTIONS TO RESOLVE

- [ ] **ASM-1: Office 365 sync for demoted tasks** — The cron bypasses `taskService.updateTask()` which calls `syncOffice365Task()`. Should demoted tasks sync to O365? Options: (a) call `updateTask()` per-task in a loop (slower but syncs), (b) skip O365 sync intentionally (faster, document the decision). → Ask Peter.

- [ ] **ASM-2: Backlog drag-reorder UX** — With due-date-first sorting, dragging a task with a due date into a position among undated tasks will snap it back to the dated group on re-render. Is this acceptable, or should manual ordering fully override date sort? → Ask Peter.

## REPO CONVENTIONS TO PRESERVE

- Cron auth: multi-layer check (`x-vercel-cron` → `CRON_SECRET` → optional `CRON_MANUAL_TOKEN`). Extract to shared utility.
- Email: `sendMicrosoftEmail({ fromUser, to, subject, html, text })` from `src/lib/microsoftGraph.js`
- Timezone: `getTimeZoneParts()` and `getLondonDateKey()` from `src/lib/timezone.js`
- API routes export GET handlers for crons
- Pages: thin `page.js` wrapper rendering a single component
- DnD: each page owns its own `DndContext` with `PointerSensor`
- Task updates: use `filterTaskUpdates()` allowlist in `taskService.js`

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] **CR-1:** Re-review cron routes after implementation to verify claim pattern works
- [ ] **CR-2:** Re-review MonthStrip/EdgeNavigator DnD after implementation to verify hover-navigation UX
- [ ] **SD-2:** Verify London-hour guard handles BST/GMT boundary correctly in tests
- [ ] **SEC-2:** Verify Vercel cron HTTP method before deployment

## REVISION PROMPT

You are revising the spec at `docs/superpowers/specs/2026-04-13-task-automation-calendar-view-design.md` based on an adversarial review.

Apply these changes in order:

1. **Idempotency:** In Features 1 & 2, replace step 2 with: "Atomically insert `(operation, run_date, status='claimed')` into `cron_runs`. If unique violation (23505), return early — already executed today."

2. **London-hour guard:** In Features 1 & 2, add step between auth and idempotency: "Check `getTimeZoneParts().hour === 20` in Europe/London. If not 20:00 London, return early."

3. **Cron HTTP method:** Change "POST" to "GET" for both cron endpoints.

4. **Backlog sort:** In Feature 3, replace "backlog column switches from `compareTasksBySortOrderAsc`" with "Add client-side `.sort(compareBacklogTasks)` to backlog tasks array before rendering in PlanBoard — currently uses server-side order with no client-side sort."

5. **MonthStrip/EdgeNavigator DnD:** In Feature 4, add implementation note: "Month labels and edge zones are `useDroppable` targets. Track `onDragOver` with setTimeout/clearTimeout timers. After delay, call setCurrentMonth(). Drop targets remain CalendarDayCell components only."

6. **Empty sweep:** Add to both cron features: "If zero tasks match, skip email, log cron_runs with tasks_affected=0, return { skipped: true }."

7. **Pagination:** In calendar data fetching section, specify "Use getAllTasks() which handles pagination, not getTasks() which is limited to 200."

8. **Email env var:** Replace hardcoded email with `process.env.DEMOTE_EMAIL_TO || process.env.DAILY_TASK_EMAIL_TO`.

9. **Minor details:** Add sidebar sort order (due_date ASC for overdue, created_at DESC for undated), intra-day order (sort_order ASC), collision detection (pointerWithin), Lucide icon (Calendar), user_id scoping on cron queries.

Preserve these decisions (DO NOT change):
- sendMicrosoftEmail for email
- cron_runs table schema
- Two-tier backlog sort (due_date → sort_order)
- Calendar DndContext isolation
- Optimistic UI for drag-drop

After applying, flag ASM-1 (O365 sync) and ASM-2 (drag-reorder UX) for human decision.
