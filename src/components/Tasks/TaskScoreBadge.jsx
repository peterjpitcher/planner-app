'use client';

import { useMemo } from 'react';
import { getTaskScores } from '@/lib/taskScoring';
import { cn } from '@/lib/utils';

export function TaskScoreBadge({ task, className, config }) {
  const scores = useMemo(() => getTaskScores(task, config), [
    config,
    task?.importance_score,
    task?.urgency_score,
    task?.priority,
    task?.due_date,
  ]);

  const scoreRounded = Math.round(scores.priorityScore);
  const breakdown = `PRI ${scoreRounded} • IMP ${scores.importance} • URG ${scores.urgency} • PRESS ${scores.duePressure}`;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground",
        !scores.hasManualScores ? "opacity-75" : "",
        className
      )}
      title={breakdown + (scores.hasManualScores ? '' : ' (auto)')}
    >
      <span className="text-muted-foreground">PRI</span>
      <span>{scoreRounded}</span>
      <span className="text-muted-foreground">IMP</span>
      <span>{scores.importance}</span>
      <span className="text-muted-foreground">URG</span>
      <span>{scores.urgency}</span>
      <span className="text-muted-foreground">PRESS</span>
      <span>{scores.duePressure}</span>
      {!scores.hasManualScores ? <span className="ml-1 text-muted-foreground">(auto)</span> : null}
    </span>
  );
}
