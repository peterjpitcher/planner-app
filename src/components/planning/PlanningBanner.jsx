'use client';

import { XMarkIcon } from '@heroicons/react/24/outline';
import { useState } from 'react';

export default function PlanningBanner({
  isPlanned,
  hasNewTasks,
  totalCandidates,
  windowType,
  onPlanNow,
}) {
  const [isDismissed, setIsDismissed] = useState(false);

  if (isDismissed) return null;

  const isDaily = windowType === 'daily';
  const timeLabel = isDaily ? 'tomorrow' : 'this week';

  // Not yet planned or new tasks arrived
  if (!isPlanned || hasNewTasks) {
    const count = totalCandidates;
    const message = hasNewTasks
      ? `${count} new task${count !== 1 ? 's' : ''} due ${timeLabel}`
      : `You have ${count} task${count !== 1 ? 's' : ''} due ${timeLabel}`;

    return (
      <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm">
        <span className="text-blue-800">{message}</span>
        <button
          type="button"
          onClick={onPlanNow}
          className="ml-4 rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
        >
          Plan now
        </button>
      </div>
    );
  }

  // Already planned
  const plannedMessage = isDaily ? "Tomorrow's planned" : 'Week planned';
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
