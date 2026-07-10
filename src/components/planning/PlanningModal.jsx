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
  // Combined flow: the Sunday/Monday auto weekly window runs weekly then daily
  // (Monday). A *manually* opened weekly plan is single-step, so gate on the real
  // context via the already-plumbed isManual prop rather than window_type alone
  // (FF-019). getActivePlanningWindow only yields an auto weekly window on the
  // Sunday-evening → Monday-evening window, so !isManual identifies that context.
  const isCombinedFlow = windowType === WINDOW_TYPE.WEEKLY && !isManual;
  const [step, setStep] = useState(isCombinedFlow ? 'weekly' : windowType);
  // During the combined-flow resume the effect below is still deciding whether to
  // jump to the daily step. Until it resolves, hold back the weekly candidate list
  // so daily-shaped candidates can never flash under the "Plan Your Week" heading
  // (R3). Only the combined flow has a resume decision to make.
  const [resumeResolving, setResumeResolving] = useState(isCombinedFlow);
  const [sectionCounts, setSectionCounts] = useState({
    [TODAY_SECTION.MUST_DO]: 0,
    [TODAY_SECTION.GOOD_TO_DO]: 0,
    [TODAY_SECTION.QUICK_WINS]: 0,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dailyTasks, setDailyTasks] = useState(null);
  // Inline error surfaced near the footer when Finish Planning fails (FF-045).
  const [finishError, setFinishError] = useState(null);
  // Count of tasks the user acted on in this session (assign / accept / defer / snooze),
  // so Finish Planning can warn only when the user truly did nothing.
  const [actionedCount, setActionedCount] = useState(0);

  // Reset wizard state whenever the modal opens for a new window. The modal
  // stays mounted in AppShell, so without this a reopened session inherits
  // stale step / counter / skipped values.
  useEffect(() => {
    if (!isOpen) return;
    setActionedCount(0);
    setFinishError(null);

    if (!isCombinedFlow) {
      setStep(windowType);
      setDailyTasks(null);
      setResumeResolving(false);
      return;
    }

    // Combined Sunday flow: default to the weekly step, but if the weekly session
    // has already been recorded the user abandoned after step 1 — resume directly
    // on the daily (Monday) step so it is not silently skipped (FF-023). Until the
    // decision resolves, keep resumeResolving true so the weekly candidate list
    // stays hidden behind a placeholder (R3).
    setStep('weekly');
    setDailyTasks(null);
    setResumeResolving(true);
    let cancelled = false;
    (async () => {
      try {
        const weeklySession = await apiClient.getPlanningSession(WINDOW_TYPE.WEEKLY, windowDate);
        if (cancelled) return;
        if (!weeklySession) {
          // No weekly session yet — stay on the weekly step and reveal its list.
          setResumeResolving(false);
          return;
        }
        const daily = await apiClient.getPlanningCandidates(WINDOW_TYPE.DAILY, windowDate);
        if (cancelled) return;
        setDailyTasks(daily);
        setStep('daily');
        setResumeResolving(false);
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to resume planning step:', err);
          // On error, fall back to the weekly step and reveal its list.
          setResumeResolving(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, isCombinedFlow, windowType, windowDate]);

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

  const handleAssign = useCallback(async (taskId, updates) => {
    // sort_order is now computed server-side (append to the target bucket) when a
    // task changes state, so the modal no longer does a racy per-row full fetch
    // to derive max+1 (FF-035).
    await apiClient.updateTask(taskId, updates);

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
  }, []);

  const handleSnooze = useCallback(async (taskId, until) => {
    // First-class snooze (F2): persist snoozed_until so the task disappears from
    // planning candidates until its date, then reappears automatically. The
    // server increments snooze_count. Replaces the old in-memory Skip, which was
    // never persisted and let the same rows reappear every session.
    await apiClient.snoozeTask(taskId, until);
    setActionedCount((prev) => prev + 1);
  }, []);

  const handleMarkDone = useCallback(async (taskId) => {
    // Let the user retrospectively mark a forgotten-but-done task as complete
    // from inside the planning modal. updateTask on state=done sets completed_at
    // server-side.
    await apiClient.updateTask(taskId, { state: STATE.DONE });
    setActionedCount((prev) => prev + 1);
  }, []);

  const handleDefer = useCallback(async (taskId, newDate, currentState) => {
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
    // Only push out-of-week defers to backlog for non-waiting tasks. A 'waiting'
    // task deferred past the week must keep its waiting status (and waiting_reason
    // / follow_up_date) — otherwise its chase-up tracking is silently lost (FF-024).
    if (newDate > weekEndStr && currentState !== STATE.WAITING) {
      updates.state = STATE.BACKLOG;
    }

    await apiClient.updateTask(taskId, updates);
    setActionedCount((prev) => prev + 1);
  }, [step, windowDate]);

  // Determine which tasks to show for the current step
  // When in Sunday combined flow's daily step, use freshly-fetched dailyTasks
  const activeTasks = (isCombinedFlow && step === 'daily' && dailyTasks) ? dailyTasks : tasks;
  const currentTasks = step === 'weekly'
    ? [...(tasks?.dueThisWeek || []), ...(tasks?.overdue || [])]
    : [...(activeTasks?.inbox || []), ...(activeTasks?.dueTomorrow || []), ...(activeTasks?.overdue || []), ...(activeTasks?.undatedThisWeek || [])];

  const handleFinish = useCallback(async () => {
    // Guard against finishing before the user has done anything. Any row
    // action (pill, Accept, Snooze, Defer) counts; we only warn on true inaction.
    const hasCandidates = currentTasks.length > 0;
    if (hasCandidates && actionedCount === 0) {
      const confirmed = typeof window !== 'undefined'
        ? window.confirm(
            step === 'weekly'
              ? 'You haven\u2019t reviewed any tasks yet. Accept, Defer or Snooze each one, or confirm to finish with nothing recorded.'
              : 'You haven\u2019t reviewed any tasks yet. Pick a section, Defer, or Snooze each one, or confirm to finish with nothing recorded.'
          )
        : true;
      if (!confirmed) return;
    }

    setIsSubmitting(true);
    setFinishError(null);
    try {
      if (isCombinedFlow && step === 'weekly') {
        // Record weekly session, transition to daily step
        await apiClient.createPlanningSession(WINDOW_TYPE.WEEKLY, windowDate);
        // Fetch daily candidates for step 2
        const dailyCandidates = await apiClient.getPlanningCandidates('daily', windowDate);
        setDailyTasks(dailyCandidates);
        setStep('daily');
        setActionedCount(0);
        setIsSubmitting(false);
        return;
      }

      // Record session (daily or weekly final step)
      const sessionType = isCombinedFlow ? WINDOW_TYPE.DAILY : windowType;
      await apiClient.createPlanningSession(sessionType, windowDate);
      onComplete();
    } catch (err) {
      // Surface the failure inline so the user can retry — otherwise Finish looks
      // like it did nothing and the planning nag keeps re-prompting (FF-045).
      console.error('Failed to complete planning session:', err);
      setFinishError('Something went wrong saving your planning. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [isCombinedFlow, step, windowType, windowDate, onComplete, actionedCount, currentTasks.length]);

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

  const stepIndicator = isCombinedFlow
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
        // Capture inbox (F3): freshly captured items are triaged FIRST, so this
        // group sits at the top of the daily step. Acting on a row (assign / defer
        // / snooze / complete) clears its inbox flag via the server triage rule.
        { label: 'Inbox — just captured', tasks: activeTasks?.inbox || [] },
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
            {isCombinedFlow && step === 'weekly' && resumeResolving ? (
              <div className="flex items-center justify-center py-16" aria-live="polite">
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
                  Loading&hellip;
                </div>
              </div>
            ) : (
            <>
            {currentTasks.length > 0 && (
              <p className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {step === 'weekly'
                  ? 'Tap Accept on each task you want on this week\u2019s plan. Complete marks tasks you\u2019ve already done; Defer changes the due date; Snooze hides it until a date you pick. Nothing is added until you pick an action.'
                  : `Tap Must Do, Good to Do or Quick Wins on each task to add it to ${targetIsToday ? 'today' : 'tomorrow'}. Complete marks tasks you\u2019ve already done; Defer changes the due date; Snooze hides it until a date you pick. Finish Planning only records the session — tasks won\u2019t move on their own.`}
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
                        onSnooze={handleSnooze}
                        onDefer={handleDefer}
                        onMarkDone={handleMarkDone}
                        onProjectNavigate={onClose}
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
            </>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-border px-6 py-4">
            {finishError && (
              <p className="mb-3 text-sm text-red-600" role="alert">
                {finishError}
              </p>
            )}
            <div className="flex items-center justify-between">
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
                  : isCombinedFlow && step === 'weekly'
                    ? 'Next: Plan Monday \u2192'
                    : 'Finish Planning'}
              </button>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
