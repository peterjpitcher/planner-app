# Claude Hand-Off Brief: Plan Modal "Today vs Tomorrow" Fix

**Generated:** 2026-04-17
**Review mode:** Mode B — Code Review (Adversarial)
**Overall risk assessment:** Medium (label fix is correct but 4 follow-up issues are blocking user-quality)

## DO NOT REWRITE
- `targetIsToday = step !== 'weekly' && windowDate === getLondonDateKey()` — this is correct. Keep.
- Section heading swap "Due Tomorrow" → "Due Today" keyed off the same `targetIsToday` — correct.
- `handleFinish` dep array including `assignedCount`, `currentTasks.length`, `onComplete`, etc. — correct.
- `window.confirm` guard shape — correct; just broaden what counts as "actioned".
- Unicode escapes in copy — fine, matches existing file style.

## SPEC REVISION REQUIRED
None — this is a bug fix, no spec exists.

## IMPLEMENTATION CHANGES REQUIRED

- [ ] **IMPL-01 (High, blocking)** — `src/lib/dateUtils.js:82` — In `getDueDateStatus`, remove the `|| (daysDiff === 0 && isPast(date))` clause so same-day date-only tasks return the "TODAY" branch. This eliminates the "Overdue" chip that now appears under the "Due Today" section header on every task.
- [ ] **IMPL-02 (Medium, blocking)** — `src/components/planning/PlanningModal.jsx` — Rename `assignedCount` → `actionedCount`; increment in `handleSkip` and `handleDefer` (after the persisted update in the defer case). Update the `handleFinish` guard and dep.
- [ ] **IMPL-03 (Medium, blocking)** — `src/components/planning/PlanningModal.jsx` — Add `useEffect(() => { if (!isOpen) return; setStep(isSundayCombined ? 'weekly' : windowType); setSkippedIds(new Set()); setDailyTasks(null); setActionedCount(0); }, [isOpen, isSundayCombined, windowType, windowDate])` so the counter and step state actually reset when the modal reopens for a new window.
- [ ] **IMPL-04 (High, blocking for Sunday)** — `src/components/planning/PlanningModal.jsx:110-116` — In `handleDefer`, base the week boundary on `windowDate` when `step === 'weekly'`, not on `getLondonDateKey()`. Add `step`, `windowDate` to the `useCallback` deps.
- [ ] **IMPL-05 (Low, bundled with above)** — `src/components/planning/PlanningModal.jsx:252` — Change "Use Skip to hide" to "Use Skip to set it aside for this session" so the copy doesn't imply persistence.

## ASSUMPTIONS TO RESOLVE
- [ ] **ASSUMPTION-01** — Is the Sunday-combined flow (weekly → forced daily step) supposed to run for every weekly session, or only when the user opened the app on Sunday evening? Current code triggers it whenever `windowType === 'weekly'`. → Ask Peter: should manual "Plan This Week" or Monday-morning weekly window force a follow-up daily step?
- [ ] **ASSUMPTION-02** — Should Skip persist across sessions (so a skipped task stops re-prompting), or stay session-only as today? → Ask Peter.

## REPO CONVENTIONS TO PRESERVE
- Plain JavaScript (not TypeScript) for `planningWindow.js`, `timezone.js`, `dateUtils.js`.
- London timezone via `getLondonDateKey` / `getTimeZoneParts` — never `new Date()` directly for user-facing dates.
- NextAuth sessions, not Supabase auth; direct Supabase service-role reads in API routes.
- No server actions — API routes + client `apiClient` only.
- Client mutations must reach persistence through `apiClient` (not direct Supabase in components).

## RE-REVIEW REQUIRED AFTER FIXES
- [ ] FINDING-01: Open the Plan modal on any day where a task's `due_date` equals today's London date. Verify the chip reads "Due Today", not "Overdue".
- [ ] FINDING-04: Open the Plan modal, defer every task, click Finish Planning. Confirm dialog should NOT fire.
- [ ] FINDING-04: Open the Plan modal, skip every task, click Finish Planning. Confirm dialog should NOT fire.
- [ ] FINDING-03: Open modal, assign 1 task, close modal. Reopen modal. Click Finish Planning without assigning anything. Confirm dialog SHOULD fire.
- [ ] FINDING-02: Simulate Sunday weekly planning (windowType='weekly', windowDate=next Monday). Defer a task to next Thursday. Verify task's state remains `this_week`, not `backlog`.

## REVISION PROMPT

You are applying the adversarial review fixes for the Plan Modal "Today vs Tomorrow" feature on branch main.

Apply these changes in order, committing each atomically with conventional-commit messages:

1. **IMPL-01 (getDueDateStatus)** — Edit `src/lib/dateUtils.js`. In `getDueDateStatus`, change the first conditional from `if (daysDiff < 0 || (daysDiff === 0 && isPast(date)))` to `if (daysDiff < 0)`. The `isToday` branch already covers the `daysDiff === 0` case.

2. **IMPL-02 + IMPL-03 + IMPL-05 (Modal state)** — Edit `src/components/planning/PlanningModal.jsx`:
   - Rename state to `actionedCount` / `setActionedCount`.
   - Add `setActionedCount((prev) => prev + 1)` at the end of `handleSkip` (inside the same `useCallback`).
   - Add `setActionedCount((prev) => prev + 1)` at the end of `handleDefer`, AFTER the `await apiClient.updateTask(...)` succeeds.
   - Add a `useEffect` gated on `isOpen` that resets `step`, `skippedIds`, `dailyTasks`, `actionedCount` when `isOpen` becomes true (deps: `[isOpen, isSundayCombined, windowType, windowDate]`).
   - Update the guard condition in `handleFinish` to use `actionedCount`; update dep array.
   - Update the hint copy: change "Use Skip to hide" → "Use Skip to set it aside for this session".

3. **IMPL-04 (Defer week base)** — In `handleDefer`, compute the week base from `windowDate` when in weekly step, otherwise from `getLondonDateKey()`. Add `step` and `windowDate` to the `useCallback` deps.

After applying changes, verify:
- [ ] `npm run build` passes
- [ ] `npx next lint` clean
- [ ] Manual checks in Re-Review section above
- [ ] No existing behaviour regressed on the happy path (manual Plan Today, auto daily, Sunday combined)

Leave FINDING-06 (dead `isManual` prop) and FINDING-07 (Sunday combined trigger condition) for a follow-up once Peter has answered ASSUMPTION-01. Do not remove or repurpose `isManual` in this pass.
