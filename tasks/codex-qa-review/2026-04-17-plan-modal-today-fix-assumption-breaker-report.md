**Verdict**

Claude’s RC1 fix is real for the fresh after-midnight path, but “only root cause” is overconfident. RC2 is directionally true, but the guard/copy is leaky and misses common action paths.

1. **RC1 as the only mislabel cause: breaks.**  
   Trace: `getActivePlanningWindow()` computes `windowDate` in [planningWindow.js](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/lib/planningWindow.js:77), daily after-midnight returns today at [planningWindow.js](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/lib/planningWindow.js:115), `usePlanningPrompt` stores it at [usePlanningPrompt.js](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/hooks/usePlanningPrompt.js:45), `AppShell` passes it at [AppShell.jsx](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/layout/AppShell.jsx:103), and `DialogTitle` renders it from [PlanningModal.jsx](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/planning/PlanningModal.jsx:196).  
   But the hook only rechecks on mount/path/focus/settings, not at midnight/window boundaries, so a visible tab can retain stale `windowDate`. Also `step` is initialized once from props at [PlanningModal.jsx](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/planning/PlanningModal.jsx:28).  
   **Confidence: High. Severity: Medium.**  
   Fix: add a time-bound recheck in `usePlanningPrompt`, and reset modal-local state on `{isOpen, windowType, windowDate}`.

2. **`targetIsToday = step !== 'weekly' && windowDate === todayLondon`: mostly holds, but exposes other bugs.**  
   Manual Plan Today holds: daily manual sets `computedDate = today` at [usePlanningPrompt.js](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/hooks/usePlanningPrompt.js:142). Manual Plan This Week initially holds because `step='weekly'`, but the modal wrongly treats every weekly modal as combined at [PlanningModal.jsx](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/planning/PlanningModal.jsx:27), so manual weekly can proceed to a daily step using that Monday.  
   Sunday evening combined: daily step uses Monday `windowDate`, today is Sunday, so label is “Plan Your Tomorrow — Monday”, correct. Monday morning combined: `windowDate` is Monday and today is Monday, so Claude’s new code says “Plan Your Day — Monday”, not “Tomorrow”.  
   **Confidence: High. Severity: Medium.**

3. **`todayLondon` computed during render: weak but not catastrophic.**  
   If the modal renders at 23:59 and no React state changes after midnight, the title will not update. If any state change causes a render, `getLondonDateKey()` refreshes. For a time-sensitive modal, relying on incidental re-render is not clean.  
   **Confidence: High. Severity: Low/Medium.**  
   Fix: tick while modal is open, or force a recheck at the next London midnight/planning boundary.

4. **Zero-assignment guard: breaks for Defer/Skip workflows.**  
   `assignedCount` increments only for `today_section` or `STATE.THIS_WEEK` at [PlanningModal.jsx](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/planning/PlanningModal.jsx:93). `handleDefer` updates the task at [PlanningModal.jsx](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/planning/PlanningModal.jsx:110) but never increments it; Skip also does not. A user who defers every task gets the “haven’t picked a section” warning despite taking valid planning actions.  
   Worse: `assignedCount` is only reset during Sunday step transition, so it can carry between modal runs because `AppShell` keeps the component mounted at [AppShell.jsx](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/layout/AppShell.jsx:98).  
   **Confidence: High. Severity: Medium.**  
   Fix: track `actionedIds` separately, reset it on modal open, and decide whether the guard means “zero accepted” or “zero actions.”

5. **`typeof window !== 'undefined'`: holds as harmless dead code.**  
   `PlanningModal.jsx` is a client component, and `handleFinish` only runs from a browser click. In app usage the false branch should not execute. It may matter only in non-browser tests directly invoking the handler.  
   **Confidence: High. Severity: Low.**

6. **Hint text: partly true, partly misleading.**  
   “Finish Planning only records the session” is literally true: final submit writes `planning_sessions` at [PlanningModal.jsx](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/planning/PlanningModal.jsx:165). Task movement happens on row buttons.  
   But “Use Skip to hide” is false as written. Skip sets local row state in [PlanningTaskRow.jsx](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/planning/PlanningTaskRow.jsx:94), and `skippedIds` is set at [PlanningModal.jsx](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/planning/PlanningModal.jsx:106) but never used to filter or persist anything. Skipped tasks reappear on reload; that is consistent with the spec for overdue tasks, but the copy overpromises.  
   **Confidence: High. Severity: Low/Medium.**  
   Fix: say “Skip marks it reviewed for this session” or actually filter/persist skip decisions.

7. **Due-today “Overdue” chip: genuine omission.**  
   `getDueDateStatus()` marks `daysDiff === 0 && isPast(date)` as Overdue before checking `isToday` at [dateUtils.js](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/lib/dateUtils.js:82). For date-only strings like `2026-04-17`, `parseISO` is midnight, so every due-today task becomes Overdue after midnight. In a “Due Today” section, that is highly visible and confusing.  
   **Confidence: High. Severity: High.**  
   Fix in [dateUtils.js](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/lib/dateUtils.js:75): compare calendar days first; only `daysDiff < 0` is overdue, `daysDiff === 0` is due today.

8. **Manual override: partially holds, but state cleanup is weak.**  
   Manual planning sets `manualOverrideRef.current = true` at [usePlanningPrompt.js](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/hooks/usePlanningPrompt.js:154), and close/complete clears it at [usePlanningPrompt.js](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/hooks/usePlanningPrompt.js:118) and [usePlanningPrompt.js](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/hooks/usePlanningPrompt.js:163).  
   But `closeModal` does not clear manual `windowState` or `tasks`, so a dismissed manual session can leave an active planning banner until another check runs. If an auto modal was already open, the ref was false until a manual trigger actually ran; there is no special protection for that pre-existing auto state.  
   **Confidence: Medium/High. Severity: Medium.**  
   Fix: set the ref at the start of manual trigger, and on manual close either re-run `checkPlanningState()` or clear manual window state.

9. **Daily window defaults: Claude’s mental model is probably wrong.**  
   `DAILY_START='20:05'` and `DAILY_END='20:00'` in [constants.js](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/lib/constants.js:67), combined with `start > end` wrap logic at [planningWindow.js](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/lib/planningWindow.js:35), means daily is active from 20:05 through 19:59 the next day. The only inactive slot is 20:00-20:04.  
   So a Friday 09:00 auto prompt is not an edge case; it is normal behavior. `lastCheckRef` prevents repeated modal auto-open for the same window, but checks still see the window as active.  
   **Confidence: High. Severity: Medium.**

10. **Sunday combined flow: Claude missed the real bug.**  
   Monday AM can absolutely enter the “Sunday combined” flow because `getActivePlanningWindow()` returns weekly until Monday 20:00 at [planningWindow.js](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/lib/planningWindow.js:97), and the modal defines combined as `windowType === weekly`, not “opened on Sunday.” Step 2 then fetches daily candidates with the same Monday `windowDate` at [PlanningModal.jsx](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/planning/PlanningModal.jsx:154).  
   With Claude’s label fix, Monday AM shows “Plan Your Day — Monday,” not “Plan Your Tomorrow — Monday.” The bug is semantic: Monday AM and manual weekly sessions should not necessarily get a forced second daily step.  
   **Confidence: High. Severity: High.**  
   Fix: make combined flow explicit, e.g. `!isManual && windowType === WEEKLY && windowDate !== getLondonDateKey()`, or better compute/pass `isCombinedFlow` from the hook when the weekly window is actually Sunday evening.

Additional missed fix: [PlanningModal.jsx](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/planning/PlanningModal.jsx:110) computes defer’s week boundary from `getLondonDateKey()`, not the planning `windowDate`. On Sunday weekly planning, that uses the old week’s Sunday and can wrongly push deferred target-week tasks to backlog. Use the target planning week as the base and include `step/windowDate` in the callback deps.

I did not edit files or run tests; this was code review only.