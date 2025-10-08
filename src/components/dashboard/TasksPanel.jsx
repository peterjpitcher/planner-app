'use client';

import { useState, useCallback } from 'react';
import StandaloneTaskList from '@/components/Tasks/StandaloneTaskList';
import { TaskListSkeleton } from '@/components/ui/LoadingStates';
import { PlusIcon } from '@heroicons/react/24/outline';
import {
  FireIcon as SolidFireIcon,
  ExclamationTriangleIcon as SolidExclamationTriangleIcon,
  CheckCircleIcon as SolidCheckIcon,
} from '@heroicons/react/20/solid';

const quickPriorities = [
  { value: 'High', icon: SolidFireIcon, tooltip: 'High priority' },
  { value: 'Medium', icon: SolidExclamationTriangleIcon, tooltip: 'Medium priority' },
  { value: 'Low', icon: SolidCheckIcon, tooltip: 'Low priority' },
];

export default function TasksPanel({
  isLoading,
  tasks,
  projects,
  onTaskUpdate,
  hideBillStakeholder,
  onQuickAdd,
}) {
  const [quickName, setQuickName] = useState('');
  const [quickDueDate, setQuickDueDate] = useState('');
  const [quickPriority, setQuickPriority] = useState('Medium');
  const [quickError, setQuickError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleQuickSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      const trimmedName = quickName.trim();
      if (!trimmedName) {
        setQuickError('Give the task a name to get started.');
        return;
      }
      if (!quickDueDate) {
        setQuickError('Pick a due date so it shows up in the schedule.');
        return;
      }
      if (!onQuickAdd) return;

      setQuickError(null);
      setIsSubmitting(true);
      try {
        await onQuickAdd({
          name: trimmedName,
          dueDate: quickDueDate,
          priority: quickPriority,
        });
        setQuickName('');
        setQuickDueDate('');
        setQuickPriority('Medium');
      } catch (error) {
        setQuickError(error.message || 'Could not add that task. Please try again.');
      } finally {
        setIsSubmitting(false);
      }
    },
    [quickName, quickDueDate, quickPriority, onQuickAdd]
  );

  return (
    <div className="flex w-full flex-col gap-4 sm:max-w-[28rem] sm:self-center lg:max-w-none">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-[#036586]/85">Tasks</p>
        <h2 className="mt-2 text-xl font-semibold text-[#052a3b]">Flight board</h2>
      </div>
      <div className="card-surface mx-auto w-full overflow-hidden border border-[#0496c7]/20 bg-white/90 p-0 text-[#052a3b] shadow-[0_24px_50px_-32px_rgba(4,150,199,0.35)] backdrop-blur sm:max-w-[28rem] lg:mx-0 lg:max-w-none">
        <form onSubmit={handleQuickSubmit} className="space-y-3 border-b border-[#0496c7]/15 bg-white px-4 py-4 text-[#052a3b]">
          <div>
            <label htmlFor="quick-task-name" className="sr-only">
              Task name
            </label>
            <input
              id="quick-task-name"
                type="text"
                placeholder="What needs doing?"
                value={quickName}
                onChange={(event) => setQuickName(event.target.value)}
                className="w-full rounded-xl border border-[#0496c7]/25 bg-white px-4 py-2 text-sm text-[#052a3b] shadow-inner shadow-[#0496c7]/10 placeholder:text-[#2f617a]/70 focus:border-[#0496c7] focus:outline-none focus:ring-2 focus:ring-[#0496c7]/30"
                disabled={isSubmitting}
              />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <div className="flex items-center gap-2">
              <label htmlFor="quick-task-date" className="sr-only">
                Due date
              </label>
              <input
                id="quick-task-date"
                type="date"
                value={quickDueDate}
                onChange={(event) => setQuickDueDate(event.target.value)}
                className="w-full rounded-xl border border-[#0496c7]/25 bg-white px-3 py-2 text-sm text-[#052a3b] shadow-inner shadow-[#0496c7]/10 focus:border-[#0496c7] focus:outline-none focus:ring-2 focus:ring-[#0496c7]/30 sm:w-40"
                disabled={isSubmitting}
                required
              />
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-xl bg-[#0496c7] px-4 py-2 text-sm font-semibold text-white shadow-md shadow-[#0496c7]/30 transition hover:bg-[#0382ac] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0496c7]/40 disabled:pointer-events-none disabled:opacity-60"
                disabled={isSubmitting}
              >
                <PlusIcon className="mr-1.5 h-4 w-4" />
                Add
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              {quickPriorities.map(({ value, icon: Icon, tooltip }) => {
                const isActive = quickPriority === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setQuickPriority(value)}
                    className={`inline-flex h-9 w-10 items-center justify-center rounded-xl border text-xs transition ${
                      isActive
                        ? 'border-[#0496c7] bg-[#0496c7]/15 text-[#036586] shadow-inner shadow-[#0496c7]/25'
                        : 'border-transparent bg-white text-[#2f617a]/70 hover:border-[#0496c7]/30 hover:bg-[#0496c7]/10 hover:text-[#036586]'
                    }`}
                    title={tooltip}
                    aria-pressed={isActive}
                    disabled={isSubmitting}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                );
              })}
            </div>
            {quickError && <p className="text-xs font-medium text-rose-500">{quickError}</p>}
          </div>
        </form>

        {isLoading ? (
          <div className="p-6">
            <TaskListSkeleton />
          </div>
        ) : (
          <StandaloneTaskList
            allUserTasks={tasks}
            projects={projects}
            onTaskUpdateNeeded={onTaskUpdate}
            hideBillStakeholder={hideBillStakeholder}
          />
        )}
      </div>
    </div>
  );
}
