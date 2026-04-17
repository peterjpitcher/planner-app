'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TODAY_SECTION, SOFT_CAPS, CHIP_VALUES, TASK_TYPE } from '@/lib/constants';
import { getDueDateStatus, quickPickOptions, toDateInputValue } from '@/lib/dateUtils';
import {
  CalendarDaysIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';

const SECTION_LABELS = {
  [TODAY_SECTION.MUST_DO]: 'Must Do',
  [TODAY_SECTION.GOOD_TO_DO]: 'Good to Do',
  [TODAY_SECTION.QUICK_WINS]: 'Quick Wins',
};

const SECTION_COLORS = {
  [TODAY_SECTION.MUST_DO]: 'bg-red-100 text-red-800 border-red-200',
  [TODAY_SECTION.GOOD_TO_DO]: 'bg-amber-100 text-amber-800 border-amber-200',
  [TODAY_SECTION.QUICK_WINS]: 'bg-green-100 text-green-800 border-green-200',
};

const CHIP_LABELS = {
  [CHIP_VALUES.HIGH_IMPACT]: 'High Impact',
  [CHIP_VALUES.URGENT]: 'Urgent',
  [CHIP_VALUES.BLOCKS_OTHERS]: 'Blocks Others',
  [CHIP_VALUES.STRESS_RELIEF]: 'Stress Relief',
  [CHIP_VALUES.ONLY_I_CAN]: 'Only I Can',
};

const TYPE_LABELS = {
  [TASK_TYPE.ADMIN]: 'Admin',
  [TASK_TYPE.REPLY_CHASE]: 'Reply/Chase',
  [TASK_TYPE.FIX]: 'Fix',
  [TASK_TYPE.PLANNING]: 'Planning',
  [TASK_TYPE.CONTENT]: 'Content',
  [TASK_TYPE.DEEP_WORK]: 'Deep Work',
  [TASK_TYPE.PERSONAL]: 'Personal',
};

export default function PlanningTaskRow({
  task,
  mode, // 'daily' | 'weekly'
  sectionCounts, // { must_do: N, good_to_do: N, quick_wins: N }
  onAssign, // (taskId, { state, today_section }) => void
  onSkip, // (taskId) => void
  onDefer, // (taskId, newDate) => void
  onMarkDone, // (taskId) => Promise<void>
  onProjectNavigate, // () => void — invoked before the project link navigates so the parent modal can close
}) {
  const [showDefer, setShowDefer] = useState(false);
  const [isActioned, setIsActioned] = useState(false);
  const [actionLabel, setActionLabel] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const dueDateStatus = task.due_date ? getDueDateStatus(task.due_date) : null;

  if (isActioned) {
    return (
      <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        <CheckCircleIcon className="h-5 w-5 text-green-500" />
        <span className="font-medium">{task.name}</span>
        <span className="ml-auto text-xs">{actionLabel}</span>
      </div>
    );
  }

  const handleAssignSection = async (section) => {
    setIsLoading(true);
    setError(null);
    try {
      await onAssign(task.id, { state: 'today', today_section: section });
      setIsActioned(true);
      setActionLabel(`→ ${SECTION_LABELS[section]}`);
    } catch (err) {
      setError('Failed to assign');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAcceptWeekly = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await onAssign(task.id, { state: 'this_week' });
      setIsActioned(true);
      setActionLabel('→ This Week');
    } catch (err) {
      setError('Failed to accept');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkip = () => {
    onSkip(task.id);
    setIsActioned(true);
    setActionLabel('Skipped');
  };

  const handleMarkDone = async () => {
    if (!onMarkDone) return;
    setIsLoading(true);
    setError(null);
    try {
      await onMarkDone(task.id);
      setIsActioned(true);
      setActionLabel('Completed');
    } catch (err) {
      setError('Failed to mark complete');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDefer = async (newDate) => {
    setIsLoading(true);
    setError(null);
    try {
      await onDefer(task.id, newDate);
      setIsActioned(true);
      setActionLabel(`Deferred → ${newDate}`);
      setShowDefer(false);
    } catch (err) {
      setError('Failed to defer');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      {/* Task info row */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{task.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {task.project_name && (
              task.project_id ? (
                <Link
                  href={`/projects?id=${task.project_id}`}
                  onClick={() => onProjectNavigate?.()}
                  className="rounded bg-muted px-1.5 py-0.5 hover:bg-muted/70 hover:text-foreground hover:underline focus:outline-none focus-visible:underline"
                >
                  {task.project_name}
                </Link>
              ) : (
                <span className="rounded bg-muted px-1.5 py-0.5">{task.project_name}</span>
              )
            )}
            {task.task_type && (
              <span className="rounded bg-muted px-1.5 py-0.5">{TYPE_LABELS[task.task_type] || task.task_type}</span>
            )}
            {dueDateStatus && (
              <span className={`rounded px-1.5 py-0.5 ${dueDateStatus.styles?.badge || 'bg-muted'}`}>
                {dueDateStatus.label}
              </span>
            )}
            {(task.chips || []).map((chip) => (
              <span key={chip} className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">
                {CHIP_LABELS[chip] || chip}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <p className="mt-2 text-xs text-red-600">{error}</p>
      )}

      {/* Action buttons */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {mode === 'daily' ? (
          // Daily: section assignment pills
          <>
            {Object.entries(SECTION_LABELS).map(([section, label]) => {
              const count = sectionCounts?.[section] || 0;
              const cap = SOFT_CAPS[section.toUpperCase()] || 999;
              const isOverCap = count >= cap;
              return (
                <div key={section} className="flex flex-col items-start">
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={() => handleAssignSection(section)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:opacity-80 disabled:opacity-50 ${SECTION_COLORS[section]}`}
                  >
                    {label}
                  </button>
                  {isOverCap && (
                    <span className="mt-0.5 text-[10px] text-amber-600">
                      Already {count} tasks
                    </span>
                  )}
                </div>
              );
            })}
          </>
        ) : (
          // Weekly: Accept button
          <button
            type="button"
            disabled={isLoading}
            onClick={handleAcceptWeekly}
            className="rounded-full border border-blue-200 bg-blue-100 px-3 py-1 text-xs font-medium text-blue-800 transition-colors hover:opacity-80 disabled:opacity-50"
          >
            Accept
          </button>
        )}

        {onMarkDone && (
          <button
            type="button"
            disabled={isLoading}
            onClick={handleMarkDone}
            title="Already done — mark complete"
            className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-100 disabled:opacity-50"
          >
            <CheckCircleIcon className="mr-1 inline h-3 w-3" />
            Complete
          </button>
        )}

        <button
          type="button"
          disabled={isLoading}
          onClick={handleSkip}
          className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 disabled:opacity-50"
        >
          Skip
        </button>

        <button
          type="button"
          disabled={isLoading}
          onClick={() => setShowDefer(!showDefer)}
          className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 disabled:opacity-50"
        >
          <CalendarDaysIcon className="mr-1 inline h-3 w-3" />
          Defer
        </button>
      </div>

      {/* Defer date picker */}
      {showDefer && (
        <div className="mt-2 flex flex-wrap gap-2 rounded-md border border-border bg-muted/30 p-2">
          {quickPickOptions.map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => handleDefer(toDateInputValue(option.getValue()))}
              className="rounded border border-border bg-card px-2 py-1 text-xs hover:bg-muted"
            >
              {option.label}
            </button>
          ))}
          <input
            type="date"
            className="rounded border border-border bg-card px-2 py-1 text-xs"
            onChange={(e) => {
              if (e.target.value) handleDefer(e.target.value);
            }}
          />
        </div>
      )}
    </div>
  );
}
