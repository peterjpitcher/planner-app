'use client';

import { XMarkIcon } from '@heroicons/react/24/outline';
import { useState } from 'react';

import { formatDate } from '@/lib/dateUtils';

/**
 * Capitalise the first letter of a relative window label for use at the start
 * of a sentence ("today" -> "Today's planned").
 */
function toSentenceCase(label) {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default function PlanningBanner({
  isPlanned,
  isDayPlanned = false,
  hasNewTasks,
  newTaskCount = 0,
  totalCandidates,
  windowType,
  windowDate,
  windowLabel,
  onPlanNow,
}) {
  const [isDismissed, setIsDismissed] = useState(false);

  if (isDismissed) return null;

  const isDaily = windowType === 'daily';
  // The window a daily plan covers is "tomorrow" only while you are planning it
  // in the evening. From midnight it is "today", so the label has to be computed
  // rather than assumed, or a planned day reads as still needing planning.
  const timeLabel =
    windowLabel ||
    (isDaily
      ? formatDate(windowDate, 'EEEE d MMM')
      : `the week of ${formatDate(windowDate, 'd MMM')}`);

  // The week is outstanding but the day itself is already built, typically by
  // the morning autopilot. Say so, rather than implying nothing is planned.
  const weekPendingOverPlannedDay = !isPlanned && !hasNewTasks && isDayPlanned;

  // Not yet planned, or genuinely new tasks arrived after the plan was made
  if (!isPlanned || hasNewTasks) {
    const count = hasNewTasks ? newTaskCount : totalCandidates;
    let message;
    if (hasNewTasks) {
      message = `${count} new task${count !== 1 ? 's' : ''} since you planned ${timeLabel}`;
    } else if (weekPendingOverPlannedDay) {
      message = `Today's planned. You haven't planned ${timeLabel} yet`;
    } else {
      message = `You have ${count} task${count !== 1 ? 's' : ''} to plan for ${timeLabel}`;
    }

    let action = 'Plan now';
    if (hasNewTasks) action = 'Review';
    else if (weekPendingOverPlannedDay) action = 'Plan week';

    return (
      <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm">
        <span className="text-blue-800">{message}</span>
        <button
          type="button"
          onClick={onPlanNow}
          className="ml-4 rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
        >
          {action}
        </button>
      </div>
    );
  }

  // Already planned
  const plannedMessage = `${toSentenceCase(timeLabel)}'s planned`;
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 px-4 py-2.5 text-sm">
      <span className="text-muted-foreground">{plannedMessage}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPlanNow}
          className="text-xs text-muted-foreground underline hover:text-foreground"
        >
          Revisit
        </button>
        <button
          type="button"
          onClick={() => setIsDismissed(true)}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted"
          aria-label="Dismiss"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
