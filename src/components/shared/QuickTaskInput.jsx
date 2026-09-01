'use client';

import { useMemo, useRef, useState } from 'react';
import { PlusIcon } from '@heroicons/react/20/solid';

import { apiClient } from '@/lib/apiClient';
import { parseQuickTaskDate } from '@/lib/quickTaskDateParser';
import { getLondonDateKey } from '@/lib/timezone';

/**
 * The one task capture component.
 *
 * /today and /projects used to have separate ones with different behaviour.
 * QuickTaskList parsed natural-language due dates; AddTaskInput hardcoded the
 * due date to today and could not set one at all, so adding a task to a project
 * always landed it due today. AddTaskInput also built that date with
 * `format(new Date(), ...)`, which is machine-local rather than Europe/London,
 * so near midnight or from another timezone it wrote the wrong day.
 *
 * Copying the parser into the second component was the obvious fix and the wrong
 * one. The date grammar is subtle: chrono-node GB with forward dates, a date only
 * counts at the end of a line, recurrence tails are excluded, and there are hand
 * written special cases for "the day after tomorrow" and "a week today". Two
 * copies of that drift, and the drift is silent.
 *
 * mode="single": one line, Enter submits. Project and customer workspaces.
 * mode="multi":  textarea, up to MAX_TASKS lines, button submits. /today.
 */

const MAX_TASKS = 25;
const MAX_TASK_NAME_LENGTH = 255;

const DUE_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/London',
});

const DUE_DATE_FORMATTER_SHORT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'Europe/London',
});

export function formatDueDate(dateKey, { short = false } = {}) {
  const formatter = short ? DUE_DATE_FORMATTER_SHORT : DUE_DATE_FORMATTER;
  return formatter.format(new Date(`${dateKey}T12:00:00Z`));
}

/** Split a textarea value into trimmed, non-empty task lines. */
export function parseQuickTasks(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export default function QuickTaskInput({
  mode = 'single',
  projectId = null,
  onTaskAdded,
  disabled = false,
  state = 'backlog',
}) {
  const isMulti = mode === 'multi';

  const [value, setValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  const baseDateKey = getLondonDateKey();
  const isDisabled = disabled || isSubmitting;

  const taskNames = useMemo(
    () => (isMulti ? parseQuickTasks(value) : [value.trim()].filter(Boolean)),
    [value, isMulti]
  );

  const parsedTasks = useMemo(
    () => taskNames.map((name) => parseQuickTaskDate(name, baseDateKey)),
    [taskNames, baseDateKey]
  );

  // Only surface a preview for lines where the parser actually did something,
  // so a plain "call Bob" does not get a redundant "due today" annotation.
  const recognisedDates = parsedTasks.filter(
    (task, index) => task.name !== taskNames[index] || task.dueDate !== baseDateKey
  );

  async function submit() {
    if (isDisabled || taskNames.length === 0) return;

    if (isMulti && taskNames.length > MAX_TASKS) {
      setResult({ type: 'error', message: `Add up to ${MAX_TASKS} tasks at a time.` });
      return;
    }

    const longTaskIndex = parsedTasks.findIndex(
      (task) => task.name.length > MAX_TASK_NAME_LENGTH
    );
    if (longTaskIndex !== -1) {
      setResult({
        type: 'error',
        message: isMulti
          ? `Task ${longTaskIndex + 1} is longer than ${MAX_TASK_NAME_LENGTH} characters.`
          : `That task is longer than ${MAX_TASK_NAME_LENGTH} characters.`,
      });
      return;
    }

    setIsSubmitting(true);
    setResult(null);

    const outcomes = await Promise.allSettled(
      parsedTasks.map((task) =>
        apiClient.createTask({
          name: task.name,
          // Explicit null, not undefined: undefined is dropped by
          // JSON.stringify, so "no project" would become a missing field rather
          // than a stated one. /today has always sent null here.
          projectId: projectId ?? null,
          dueDate: task.dueDate,
          state,
        })
      )
    );

    const failedTasks = taskNames.filter((_, index) => outcomes[index].status === 'rejected');
    const createdCount = taskNames.length - failedTasks.length;

    outcomes.forEach((outcome) => {
      if (outcome.status === 'fulfilled') {
        onTaskAdded?.(outcome.value, projectId);
      }
    });

    if (failedTasks.length === 0) {
      setValue('');
      setResult(
        isMulti
          ? {
              type: 'success',
              message: `${createdCount} task${createdCount === 1 ? '' : 's'} added.`,
            }
          : null
      );
      // Re-focus for rapid-fire entry.
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      // Keep only the failed lines, so a retry cannot double-add the ones that
      // already worked, and the typed text is never lost.
      setValue(failedTasks.join('\n'));
      setResult({
        type: 'error',
        message:
          createdCount > 0
            ? `${createdCount} added. ${failedTasks.length} failed and ${
                failedTasks.length === 1 ? 'remains' : 'remain'
              } in the list.`
            : isMulti
              ? 'Tasks could not be added. Your list has been kept.'
              : 'Task could not be added.',
      });
    }

    setIsSubmitting(false);
  }

  function handleSubmit(event) {
    event.preventDefault();
    submit();
  }

  function handleKeyDown(event) {
    if (isMulti) {
      // Enter is a newline in the textarea, so submitting needs a modifier.
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
      }
      return;
    }

    if (event.key === 'Escape') {
      setValue('');
      setResult(null);
    }
  }

  if (!isMulti) {
    const preview = recognisedDates[0];

    return (
      <form onSubmit={handleSubmit} className="mt-2 flex flex-col gap-1">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (result) setResult(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Add a task… (try “next Friday”)"
            maxLength={MAX_TASK_NAME_LENGTH + 40}
            disabled={isDisabled}
            aria-label="New task"
            aria-describedby={preview ? 'quick-task-single-preview' : undefined}
            className="flex-1 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm placeholder-gray-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={taskNames.length === 0 || isDisabled}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            Add
          </button>
        </div>

        {preview && (
          <p
            id="quick-task-single-preview"
            aria-live="polite"
            className="text-xs text-indigo-600"
          >
            <span className="font-medium">{preview.name}</span>
            {' · due '}
            {formatDueDate(preview.dueDate, { short: true })}
          </p>
        )}

        {result?.type === 'error' && (
          <p className="text-xs text-red-500" role="alert">
            {result.message}
          </p>
        )}
      </form>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-sky-200 bg-sky-50/60 p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Quick task list</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            One task per line · Due today unless you add a date · No project · Backlog
          </p>
        </div>
        {taskNames.length > 0 && (
          <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs font-medium text-sky-700">
            {taskNames.length}/{MAX_TASKS}
          </span>
        )}
      </div>

      <label htmlFor="quick-task-list" className="sr-only">
        Tasks, one per line
      </label>
      <textarea
        id="quick-task-list"
        ref={inputRef}
        rows={4}
        value={value}
        disabled={isSubmitting}
        onChange={(event) => {
          setValue(event.target.value);
          if (result) setResult(null);
        }}
        onKeyDown={handleKeyDown}
        placeholder={'Chase Billy next Friday\nBook the room in a week\nSend the pack on September 1'}
        aria-describedby="quick-task-list-help"
        className="mt-3 w-full resize-y rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-inner placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
      />

      {recognisedDates.length > 0 && (
        <div
          aria-label="Recognised due dates"
          className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-sky-100 bg-white/80 px-3 py-2"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">
            Dates understood
          </p>
          <ul className="mt-1 space-y-1">
            {recognisedDates.map((task, index) => (
              <li
                key={`${task.name}-${task.dueDate}-${index}`}
                className="flex items-start justify-between gap-3 text-xs"
              >
                <span className="min-w-0 truncate text-slate-600">{task.name}</span>
                <span className="shrink-0 font-medium text-sky-700">
                  {formatDueDate(task.dueDate)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p id="quick-task-list-help" className="text-[11px] text-slate-400">
          Try “tomorrow”, “next Friday”, “in a week” or “on September 1”
        </p>
        <button
          type="submit"
          disabled={isSubmitting || taskNames.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PlusIcon className="h-4 w-4" aria-hidden="true" />
          {isSubmitting
            ? 'Adding…'
            : taskNames.length > 0
              ? `Add ${taskNames.length} task${taskNames.length === 1 ? '' : 's'}`
              : 'Add tasks'}
        </button>
      </div>

      {result && (
        <p
          role="status"
          aria-live="polite"
          className={`mt-2 text-xs font-medium ${
            result.type === 'success' ? 'text-emerald-700' : 'text-rose-600'
          }`}
        >
          {result.message}
        </p>
      )}
    </form>
  );
}
