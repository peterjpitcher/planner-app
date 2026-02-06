'use client';

import { useMemo } from 'react';
import { getPriorityLabel, getTaskScores } from '@/lib/taskScoring';
import { cn } from '@/lib/utils';

export function TaskScoreBadge({ task, className, config }) {
  const scores = useMemo(() => getTaskScores(task, config), [
    config,
    task?.importance_score,
    task?.urgency_score,
    task?.priority,
    task?.due_date,
  ]);

  const priorityLabel = getPriorityLabel(scores.priorityScore);
  const toneClass = priorityLabel === 'High'
    ? 'border-red-200 bg-red-50 text-red-700'
    : priorityLabel === 'Medium'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700';

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        toneClass,
        !scores.hasManualScores ? "opacity-75" : "",
        className
      )}
      title={`Priority: ${priorityLabel}${scores.hasManualScores ? '' : ' (auto)'}`}
    >
      <span>{priorityLabel}</span>
    </span>
  );
}
