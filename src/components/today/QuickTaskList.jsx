'use client';

import { useMemo, useState } from 'react';
import { PlusIcon } from '@heroicons/react/20/solid';

import { apiClient } from '@/lib/apiClient';
import { parseQuickTaskDate } from '@/lib/quickTaskDateParser';
import { getLondonDateKey } from '@/lib/timezone';

const MAX_TASKS = 25;
const MAX_TASK_NAME_LENGTH = 255;
const DUE_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/London',
});

function formatDueDate(dateKey) {
  return DUE_DATE_FORMATTER.format(new Date(`${dateKey}T12:00:00Z`));
}

export function parseQuickTasks(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export default function QuickTaskList() {
  const [value, setValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const taskNames = useMemo(() => parseQuickTasks(value), [value]);
  const baseDateKey = getLondonDateKey();
  const parsedTasks = useMemo(
    () => taskNames.map((name) => parseQuickTaskDate(name, baseDateKey)),
    [taskNames, baseDateKey]
  );
  const recognisedDates = parsedTasks.filter(
    (task, index) => task.name !== taskNames[index] || task.dueDate !== baseDateKey
  );

  async function handleSubmit(event) {
    event.preventDefault();
    if (isSubmitting || taskNames.length === 0) return;

    if (taskNames.length > MAX_TASKS) {
      setResult({ type: 'error', message: `Add up to ${MAX_TASKS} tasks at a time.` });
      return;
    }

    const longTaskIndex = parsedTasks.findIndex((task) => task.name.length > MAX_TASK_NAME_LENGTH);
    if (longTaskIndex !== -1) {
      setResult({
        type: 'error',
        message: `Task ${longTaskIndex + 1} is longer than ${MAX_TASK_NAME_LENGTH} characters.`,
      });
      return;
    }

    setIsSubmitting(true);
    setResult(null);

    const outcomes = await Promise.allSettled(
      parsedTasks.map((task) => apiClient.createTask({
        name: task.name,
        projectId: null,
        dueDate: task.dueDate,
        state: 'backlog',
      }))
    );

    const failedTasks = taskNames.filter((_, index) => outcomes[index].status === 'rejected');
    const createdCount = taskNames.length - failedTasks.length;

    if (failedTasks.length === 0) {
      setValue('');
      setResult({
        type: 'success',
        message: `${createdCount} task${createdCount === 1 ? '' : 's'} added.`,
      });
    } else {
      // Keep only failed lines so successful tasks are not accidentally added twice.
      setValue(failedTasks.join('\n'));
      setResult({
        type: 'error',
        message: createdCount > 0
          ? `${createdCount} added. ${failedTasks.length} failed and ${failedTasks.length === 1 ? 'remains' : 'remain'} in the list.`
          : 'Tasks could not be added. Your list has been kept.',
      });
    }

    setIsSubmitting(false);
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
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
