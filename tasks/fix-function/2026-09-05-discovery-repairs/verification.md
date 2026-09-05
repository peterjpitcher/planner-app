# Verification record

All 18 approved findings have repairs and regression coverage. Production has not yet changed. Three recurrence/promotion findings depend on the unapplied migration in migration-approval.md.

## Exact local checks

- London: 56 files, 735 tests passed.
- UTC: 56 files, 735 tests passed.
- Lint: zero warnings/errors, including JSX (the prior configuration skipped JSX).
- Production build: passed, all routes generated.
- Independent data/integration review: 98 focused tests and SQL fixture passed. Reviewer found cleanup partial status prevented same-day retry; corrected to failed and proven with failed removal, successful retry, then duplicate skip.
- Real Chrome, actual TodayView and TaskCard with isolated sample API: native month arrow September to October left the card/editor visible with zero saves. Native keyboard selection chose 2026-10-19. Save date recorded exactly one due_date=2026-10-19, state=backlog update and only then removed the card from Today.
- Actual ProjectWorkspace in Chrome: Escape closed without saving; changing 3 September to 4 September and pressing Save date recorded exactly one project update.
- Actual TaskCard menu: Pick a snooze date survived menu closing; Cancel made no update.
- Actual TaskDetailDrawer: its date editor opened, changing the draft and pressing Escape kept the drawer open without saving.
- Native calendar day-cell automation did not reliably select a date; native keyboard selection and month-arrow clicks were used. No production business data was edited for testing.
- Component tests exercised actual customer drawer/menu failure, lifecycle failure/retry, journal typing during save, attachment parent navigation and settings failed load paths against controlled API responses.
- Isolated PostgreSQL exercised ownership, permissions, transactional failures, independent series, receipt idempotence, customer preservation and concurrent connections. The approval packet records exact SQL commands and outcomes.

## Release dependencies

1. codex/date-picker-repair: explicit date saves, browser regression coverage and verified existing live customer assignment.
2. codex/workflow-repairs: depends on batch 1, includes project lifecycle/impact/report routes and UI failure handling.
3. codex/integration-repairs: depends on batch 2, includes remote deletion failure propagation, attachment retries and read-only dry runs.
4. codex/discovery-repairs: depends on batch 3 and exact approved production migration before merge. Atomic recurrence and promotion require the two new RPCs.

Each boundary is being verified independently before release. Database changes remain unapplied.

## Preserved work

The original checkout /Users/peterpitcher/Cursor/OJ-Planner2.0 remains untouched, including four unpublished commits and all dirty files. Comparing 241 deployed application source files against origin/main found only the existing CustomerWorkspace customer assignment patch and its QuickTaskInput regression differed. Their SHA-1 values exactly matched the original local files. That live patch and its deployed CustomerWorkspace regression were carried into this release to prevent regression; this does not alter the original files. Already-applied database security changes remain applied and their unrelated unpublished commits were left alone.

Other application routes, authentication, existing lifecycle SQL/triggers, scheduling/business rules and integration destinations were deliberately left unchanged. Existing recurrence completion remains a separate request from spawning; this repair makes successor creation atomic/idempotent, but does not recover historical missing occurrences.

## Changed files

- `eslint.config.mjs`
- `package.json`
- `src/app/api/completed-items/__tests__/origin-notes.test.js`
- `src/app/api/completed-items/route.js`
- `src/app/api/cron/__tests__/integration-safety.test.js`
- `src/app/api/cron/office365-sync/route.js`
- `src/app/api/cron/reconcile-attachments/route.js`
- `src/app/api/notes/batch/route.js`
- `src/app/api/projects/[id]/impact/route.js`
- `src/app/settings/planning/PlanningSettingsClient.jsx`
- `src/app/settings/planning/__tests__/PlanningSettingsClient.test.jsx`
- `src/components/Customers/CustomerWorkspace.jsx`
- `src/components/Customers/CustomersView.jsx`
- `src/components/Customers/__tests__/CustomerWorkspace.test.jsx`
- `src/components/Customers/__tests__/CustomersView.tasks.test.jsx`
- `src/components/Projects/ProjectDeleteModal.jsx`
- `src/components/Projects/ProjectStatusChangeModal.jsx`
- `src/components/Projects/ProjectWorkspace.jsx`
- `src/components/Projects/ProjectsView.jsx`
- `src/components/Projects/__tests__/ProjectsView.confirmations.test.jsx`
- `src/components/journal/JournalEditor.jsx`
- `src/components/journal/__tests__/JournalEditor.test.jsx`
- `src/components/plan/PlanBoard.jsx`
- `src/components/planning/PlanningModal.jsx`
- `src/components/shared/AttachmentsPanel.jsx`
- `src/components/shared/DatePicker.jsx`
- `src/components/shared/TaskCard.jsx`
- `src/components/shared/TaskDetailDrawer.jsx`
- `src/components/shared/__tests__/AttachmentsPanel.test.jsx`
- `src/components/shared/__tests__/DatePicker.test.jsx`
- `src/components/shared/__tests__/QuickTaskInput.test.jsx`
- `src/components/today/__tests__/TodayDateSelection.test.jsx`
- `src/lib/cronAuth.js`
- `src/services/__tests__/attachmentService.test.js`
- `src/services/__tests__/ideaService.promotion.test.js`
- `src/services/__tests__/office365SyncService.recovery.test.js`
- `src/services/__tests__/projectLifecycleService.test.js`
- `src/services/__tests__/taskService.delete.test.js`
- `src/services/__tests__/taskService.recurrence.test.js`
- `src/services/attachmentService.js`
- `src/services/ideaService.js`
- `src/services/office365SyncService.js`
- `src/services/projectLifecycleService.js`
- `src/services/taskService.js`
- `supabase/__tests__/workflow-repairs.sql`
- `supabase/migrations/20260905162045_atomic_promotion_and_recurrence.sql`
- `vitest.config.js`
