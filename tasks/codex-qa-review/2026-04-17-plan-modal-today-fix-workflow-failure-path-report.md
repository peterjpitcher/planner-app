**Findings First**

**BUGS**

`F3-01` — **Medium**, Evidence: **High**  
`assignedCount` is not reset when the modal is closed and reopened. It is initialized at [PlanningModal.jsx:37](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/planning/PlanningModal.jsx:37) and reset only during the Sunday weekly-to-daily transition at [PlanningModal.jsx:158](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/planning/PlanningModal.jsx:158).  
Flow impact: user assigns 3 tasks, closes without Finish, reopens the still-mounted modal during the same active window, and the new zero-action confirm guard can be bypassed because `assignedCount` is still `3`.

Minimal fix:

```diff
- import { useState, useEffect, useCallback } from 'react';
+ import { useState, useEffect, useCallback } from 'react';

  const [assignedCount, setAssignedCount] = useState(0);

+ useEffect(() => {
+   if (!isOpen) return;
+   setStep(isSundayCombined ? 'weekly' : windowType);
+   setSkippedIds(new Set());
+   setDailyTasks(null);
+   setAssignedCount(0);
+ }, [isOpen, isSundayCombined, windowType, windowDate]);
```

This also fixes stale Sunday-combined `step` state on revisit.

`F3-02` — **Medium**, Evidence: **Medium**  
Partial assignments are persisted immediately via `updateTask` at [PlanningModal.jsx:88](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/planning/PlanningModal.jsx:88), but closing does not record a planning session and does not dispatch the refresh event. `onPlanningComplete` is the only path that emits `planning-complete` in [usePlanningPrompt.js:163](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/hooks/usePlanningPrompt.js:163).  
Flow impact: on the next real candidate fetch, assigned tasks are excluded because the API filters out `state='today'` at [route.js:41](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/app/api/planning-candidates/route.js:41), so the modal shows remaining tasks, not all tasks. But immediate same-page state can stay stale, and TodayView will not reload if it was already mounted.

Minimal fix options: either warn before closing after actions, or refresh state on close. The less invasive UX fix is to prevent accidental close after persisted actions:

```diff
+ const handleClose = useCallback(() => {
+   if (assignedCount > 0 && typeof window !== 'undefined') {
+     const confirmed = window.confirm(
+       'You have already moved tasks. Finish Planning records the session; closing now may keep the planning prompt active. Close anyway?'
+     );
+     if (!confirmed) return;
+   }
+   onClose();
+ }, [assignedCount, onClose]);

- <Dialog open={isOpen} onClose={onClose} className="relative z-50">
+ <Dialog open={isOpen} onClose={handleClose} className="relative z-50">

- onClick={onClose}
+ onClick={handleClose}
```

`F9-01` — **Medium**, Evidence: **High**  
Concurrent assignment clicks on different rows can compute the same `sort_order`. Each row has only local `isLoading`, and `handleAssign` fetches max order independently at [PlanningModal.jsx:83](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/planning/PlanningModal.jsx:83). Two rows can both read the same max and both write `maxSort + 1` at [PlanningModal.jsx:90](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/planning/PlanningModal.jsx:90).  
This is a real defect, though not data loss. It creates unstable ordering/ties in Today.

Minimal client-side fix:

```diff
- import { useState, useEffect, useCallback } from 'react';
+ import { useState, useEffect, useCallback, useRef } from 'react';

+ const assignQueueRef = useRef(Promise.resolve());

- const handleAssign = useCallback(async (taskId, updates) => {
+ const handleAssign = useCallback((taskId, updates) => {
+   const run = async () => {
      const maxSort = await getMaxSortOrder(
        updates.state,
        updates.today_section || null
      );
      await apiClient.updateTask(taskId, {
        ...updates,
        sort_order: maxSort + 1,
      });
      ...
- }, [getMaxSortOrder]);
+   };
+   const next = assignQueueRef.current.then(run, run);
+   assignQueueRef.current = next.catch(() => {});
+   return next;
+ }, [getMaxSortOrder]);
```

Server-side atomic append would be stronger, especially across tabs/devices.

**BAD UX**

`F6-01` — **Medium**, Evidence: **High**  
Deferring every task still triggers the zero-assignment confirm. `PlanningTaskRow.handleDefer` calls `onDefer`, not `onAssign`, at [PlanningTaskRow.jsx:100](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/planning/PlanningTaskRow.jsx:100). Parent `handleDefer` persists the due date at [PlanningModal.jsx:122](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/planning/PlanningModal.jsx:122), but never increments `assignedCount`. The guard at [PlanningModal.jsx:137](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/planning/PlanningModal.jsx:137) then tells the user they did nothing.

Yes, Claude should count defer as an action, but the state should be renamed from `assignedCount` to `actionedCount`.

`F7-01` — **Medium**, Evidence: **High**  
Skipping every task has the same problem. `handleSkip` only updates local hidden state at [PlanningModal.jsx:106](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/planning/PlanningModal.jsx:106); it does not increment the count. If Skip means “reviewed and set aside for this session,” the confirm should not fire.

Minimal combined fix for `F6`/`F7`:

```diff
- const [assignedCount, setAssignedCount] = useState(0);
+ const [actionedCount, setActionedCount] = useState(0);

- setAssignedCount((prev) => prev + 1);
+ setActionedCount((prev) => prev + 1);

  const handleSkip = useCallback((taskId) => {
    setSkippedIds((prev) => new Set(prev).add(taskId));
+   setActionedCount((prev) => prev + 1);
  }, []);

  const handleDefer = useCallback(async (taskId, newDate) => {
    ...
    await apiClient.updateTask(taskId, updates);
+   setActionedCount((prev) => prev + 1);
  }, []);

- if (hasCandidates && assignedCount === 0) {
+ if (hasCandidates && actionedCount === 0) {
```

**Validated Flows**

`F1` — No break found. `getLondonDateKey()` uses `Intl.DateTimeFormat` with `Europe/London`, and date probes across the 2026-10-25 BST/GMT fallback kept the same London date key through the repeated 01:30 hour.

`F2` — Mostly OK. If the modal re-renders after midnight, `targetIsToday` flips because [PlanningModal.jsx:196](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/planning/PlanningModal.jsx:196) recomputes London today. The existing candidate list does not auto-refresh on a timer, but for a Thursday 23:58 to Friday 00:01 transition the target `windowDate` is still Friday, so the list remains semantically valid. New tasks added elsewhere will not appear until the hook rechecks.

`F4` — OK. If confirm is denied, the code returns at [PlanningModal.jsx:145](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/planning/PlanningModal.jsx:145), before `setIsSubmitting(true)` at [PlanningModal.jsx:148](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/planning/PlanningModal.jsx:148). No state corruption found.

`F5` — OK for the accepted-task path. Weekly accept increments the count at [PlanningModal.jsx:100](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/planning/PlanningModal.jsx:100), so the guard does not fire after one or more accepts. Transition to daily resets the count at [PlanningModal.jsx:158](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/planning/PlanningModal.jsx:158). If the session crosses midnight into Monday, the label correctly becomes “Plan Your Day” because `windowDate === todayLondon`.

`F8` — OK. If the modal completes while Projects is mounted, TodayView misses the event because it is not mounted, but TodayView calls `loadData()` on mount at [TodayView.jsx:168](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/today/TodayView.jsx:168). Assigned tasks should appear when the user later navigates to Today.

`F10` — OK. `assignedCount` increments only after `apiClient.updateTask` succeeds. If `updateTask` throws, control goes back to the row catch path at [PlanningTaskRow.jsx:73](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/components/planning/PlanningTaskRow.jsx:73), the row remains actionable, and the count is not incremented.

`F11` — OK. `date-fns/parseISO('YYYY-MM-DD')` produced local midnight in tested time zones, not UTC midnight. The weekday label stayed correct for London and other zones.

`F12` — OK. `getMondayOfWeek('2026-04-13')` returns `2026-04-13`. Monday weekly targeting is consistent with the active weekly window logic.

`F13` — Modal behavior is fine if opened with zero candidates: hint is hidden, guard is skipped, Finish records the session. One correction: the hook does not auto-open the modal when there are zero tasks because of the `hasTasks` gate at [usePlanningPrompt.js:75](/Users/peterpitcher/Cursor/OJ-Planner2.0/src/hooks/usePlanningPrompt.js:75). The banner may still say “You have 0 tasks…” on eligible pages, but that is outside Claude’s `PlanningModal.jsx` diff.

Validation performed: reviewed the diff, read the connected modal/row/hook/API paths, and ran small Node date probes for DST and `parseISO`. I did not run the full test suite.