'use client';

import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { format, parseISO } from 'date-fns';
import { apiClient } from '@/lib/apiClient';
import { STATE, TODAY_SECTION, SOFT_CAPS, WINDOW_TYPE } from '@/lib/constants';
import { getMondayOfWeek } from '@/lib/planningWindow';
import { getLondonDateKey } from '@/lib/timezone';
import PlanningTaskRow from './PlanningTaskRow';

/**
 * Full-screen planning wizard modal.
 * Supports daily, weekly, and Sunday combined (weekly then daily) flows.
 */
export default function PlanningModal({
  isOpen,
  onClose,
  onComplete,
  windowType,
  windowDate,
  tasks,
  isManual = false,
}) {
  // Combined flow: Sunday starts with weekly, then transitions to daily (Monday)
  const isSundayCombined = windowType === WINDOW_TYPE.WEEKLY;
  const [step, setStep] = useState(isSundayCombined ? 'weekly' : windowType);
  const [sectionCounts, setSectionCounts] = useState({
    [TODAY_SECTION.MUST_DO]: 0,
    [TODAY_SECTION.GOOD_TO_DO]: 0,
    [TODAY_SECTION.QUICK_WINS]: 0,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [skippedIds, setSkippedIds] = useState(new Set());
  const [dailyTasks, setDailyTasks] = useState(null);
  // Count of tasks the user acted on in this session (assign / accept / defer / skip),
  // so Finish Planning can warn only when the user truly did nothing.
  const [actionedCount, setActionedCount] = useState(0);

  // Reset wizard state whenever the modal opens for a new window. The modal
  // stays mounted in AppShell, so without this a reopened session inherits
  // stale step / counter / skipped values.
  useEffect(() => {
    if (!isOpen) return;
    setStep(isSundayCombined ? 'weekly' : windowType);
    setSkippedIds(new Set());
    setDailyTasks(null);
    setActionedCount(0);
  }, [isOpen, isSundayCombined, windowType, windowDate]);

  // Fetch current today section counts for soft cap warnings
  // TODO: This hits /api/tasks which triggers Office365 auto-sync as a side effect.
  // Acceptable for now since the sync has a min-interval guard (default 2 min).
  // A future optimisation could add section counts to /api/planning-candidates.
  useEffect(() => {
    async function fetchCounts() {
      try {
        const todayTasks = await apiClient.getTasks(null, { state: STATE.TODAY });
        const counts = {
          [TODAY_SECTION.MUST_DO]: 0,
          [TODAY_SECTION.GOOD_TO_DO]: 0,
          [TODAY_SECTION.QUICK_WINS]: 0,
        };
        for (const t of todayTasks) {
          if (t.today_section && counts[t.today_section] !== undefined) {
            counts[t.today_section]++;
          }
        }
        setSectionCounts(counts);
      } catch (err) {
        console.error('Failed to fetch section counts:', err);
      }
    }
    if (isOpen) fetchCounts();
  }, [isOpen]);

  // Compute max sort_order for appending
  // TODO: Same O365 sync side effect as fetchCounts above.
  const getMaxSortOrder = useCallback(async (state, section = null) => {
    try {
      const stateTasks = await apiClient.getTasks(null, { state });
      let max = 0;
      for (const t of stateTasks) {
        if (section && t.today_section !== section) continue;
        if (t.sort_order != null && t.sort_order > max) max = t.sort_order;
      }
      return max;
    } catch {
      return 0;
    }
  }, []);

  const handleAssign = useCallback(async (taskId, updates) => {
    const maxSort = await getMaxSortOrder(
      updates.state,
      updates.today_section || null
    );
    await apiClient.updateTask(taskId, {
      ...updates,
      sort_order: maxSort + 1,
    });

    // Update section counts if assigning to today
    if (updates.today_section) {
      setSectionCounts((prev) => ({
        ...prev,
        [updates.today_section]: (prev[updates.today_section] || 0) + 1,
      }));
      setActionedCount((prev) => prev + 1);
    } else if (updates.state === STATE.THIS_WEEK) {
      // Weekly step acceptance also counts as a real action
      setActionedCount((prev) => prev + 1);
    }
  }, [getMaxSortOrder]);

  const handleSkip = useCallback((taskId) => {
    setSkippedIds((prev) => new Set(prev).add(taskId));
    setActionedCount((prev) => prev + 1);
  }, []);

  const handleMarkDone = useCallback(async (taskId) => {
    // Let the user retrospectively mark a forgotten-but-done task as complete
    // from inside the planning modal. updateTask on state=done sets completed_at
    // server-side.
    await apiClient.updateTask(taskId, { state: STATE.DONE });
    setActionedCount((prev) => prev + 1);
  }, []);

  const handleDefer = useCallback(async (taskId, newDate) => {
    // Base the "this week" boundary on the planning target, not today's date.
    // During Sunday evening weekly planning the target week starts next Monday,
    // so using today's week would wrongly demote valid target-week defers to
    // backlog.
    const weekBase = step === 'weekly' ? windowDate : getLondonDateKey();
    const monday = getMondayOfWeek(weekBase);
    const sundayDate = new Date(monday + 'T12:00:00Z');
    sundayDate.setUTCDate(sundayDate.getUTCDate() + 6);
    const weekEndStr = sundayDate.toISOString().slice(0, 10);

    const updates = { due_date: newDate };
    if (newDate > weekEndStr) {
      updates.state = STATE.BACKLOG;
    }

    await apiClient.updateTask(taskId, updates);
    setActionedCount((prev) => prev + 1);
  }, [step, windowDate]);

  // Determine which tasks to show for the current step
  // When in Sunday combined flow's daily step, use freshly-fetched dailyTasks
  const activeTasks = (isSundayCombined && step === 'daily' && dailyTasks) ? dailyTasks : tasks;
  const currentTasks = step === 'weekly'
    ? [...(tasks?.dueThisWeek || []), ...(tasks?.overdue || [])]
    : [...(activeTasks?.dueTomorrow || []), ...(activeTasks?.overdue || []), ...(activeTasks?.undatedThisWeek || [])];

  const handleFinish = useCallback(async () => {
    // Guard against finishing before the user has done anything. Any row
    // action (pill, Accept, Skip, Defer) counts; we only warn on true inaction.
    const hasCandidates = currentTasks.length > 0;
    if (hasCandidates && actionedCount === 0) {
      const confirmed = typeof window !== 'undefined'
        ? window.confirm(
            step === 'weekly'
              ? 'You haven\u2019t reviewed any tasks yet. Accept, Defer or Skip each one, or confirm to finish with nothing recorded.'
              : 'You haven\u2019t reviewed any tasks yet. Pick a section, Defer, or Skip each one, or confirm to finish with nothing recorded.'
          )
        : true;
      if (!confirmed) return;
    }

    setIsSubmitting(true);
    try {
      if (isSundayCombined && step === 'weekly') {
        // Record weekly session, transition to daily step
        await apiClient.createPlanningSession(WINDOW_TYPE.WEEKLY, windowDate);
        // Fetch daily candidates for step 2
        const dailyCandidates = await apiClient.getPlanningCandidates('daily', windowDate);
        setDailyTasks(dailyCandidates);
        setStep('daily');
        setSkippedIds(new Set());
        setActionedCount(0);
        setIsSubmitting(false);
        return;
      }

      // Record session (daily or weekly final step)
      const sessionType = isSundayCombined ? WINDOW_TYPE.DAILY : windowType;
      await apiClient.createPlanningSession(sessionType, windowDate);
      onComplete();
    } catch (err) {
      console.error('Failed to complete planning session:', err);
    } finally {
      setIsSubmitting(false);
    }
  }, [isSundayCombined, step, windowType, windowDate, onComplete, actionedCount, currentTasks.length]);

  const formatWindowDate = (dateStr) => {
    try {
      return format(parseISO(dateStr), 'EEEE do MMMM');
    } catch {
      return dateStr;
    }
  };

  const formatWeekRange = (dateStr) => {
    try {
      const start = parseISO(dateStr);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      return `${format(start, 'do MMMM')} – ${format(end, 'do MMMM')}`;
    } catch {
      return dateStr;
    }
  };

  // Decide "Today" vs "Tomorrow" wording based on the actual target date,
  // not just isManual. The auto-trigger after midnight sets windowDate=today,
  // so "Plan Your Tomorrow" over today's date is misleading.
  const todayLondon = getLondonDateKey();
  const targetIsToday = step !== 'weekly' && windowDate === todayLondon;
  const dailyLabel = targetIsToday ? 'Plan Your Day' : 'Plan Your Tomorrow';
  const title = step === 'weekly'
    ? `Plan Your Week — ${formatWeekRange(windowDate)}`
    : `${dailyLabel} — ${formatWindowDate(windowDate)}`;

  const stepIndicator = isSundayCombined
    ? step === 'weekly'
      ? 'Step 1 of 2: Plan Your Week'
      : 'Step 2 of 2: Plan Monday'
    : null;

  // Group tasks by category for section headers
  const taskSections = step === 'weekly'
    ? [
        { label: 'Due This Week', tasks: tasks?.dueThisWeek || [] },
        { label: 'Overdue', tasks: tasks?.overdue || [] },
      ]
    : [
        { label: targetIsToday ? 'Due Today' : 'Due Tomorrow', tasks: activeTasks?.dueTomorrow || [] },
        { label: 'Overdue', tasks: activeTasks?.overdue || [] },
        { label: 'Available This Week', tasks: activeTasks?.undatedThisWeek || [] },
      ];

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-[1px]" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="mx-auto flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-card shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              {stepIndicator && (
                <p className="mb-1 text-xs font-medium text-muted-foreground">{stepIndicator}</p>
              )}
              <DialogTitle className="text-lg font-semibold text-foreground">
                {title}
              </DialogTitle>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
              aria-label="Close"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          {/* Task list */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {currentTasks.length > 0 && (
              <p className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {step === 'weekly'
                  ? 'Tap Accept on each task you want on this week\u2019s plan. Complete marks tasks you\u2019ve already done; Defer changes the due date; Skip sets it aside for this session. Nothing is added until you pick an action.'
                  : `Tap Must Do, Good to Do or Quick Wins on each task to add it to ${targetIsToday ? 'today' : 'tomorrow'}. Complete marks tasks you\u2019ve already done; Defer changes the due date; Skip sets it aside for this session. Finish Planning only records the session — tasks won\u2019t move on their own.`}
              </p>
            )}
            {taskSections.map((section) => {
              if (section.tasks.length === 0) return null;
              return (
                <div key={section.label} className="mb-6">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {section.label} ({section.tasks.length})
                  </h3>
                  <div className="space-y-2">
                    {section.tasks.map((task) => (
                      <PlanningTaskRow
                        key={task.id}
                        task={task}
                        mode={step === 'weekly' ? 'weekly' : 'daily'}
                        sectionCounts={sectionCounts}
                        onAssign={handleAssign}
                        onSkip={handleSkip}
                        onDefer={handleDefer}
                        onMarkDone={handleMarkDone}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            {currentTasks.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No tasks to plan. You&apos;re all set!
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-muted"
            >
              Do This Later
            </button>
            <button
              type="button"
              onClick={handleFinish}
              disabled={isSubmitting}
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {isSubmitting
                ? 'Saving\u2026'
                : isSundayCombined && step === 'weekly'
                  ? 'Next: Plan Monday \u2192'
                  : 'Finish Planning'}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
