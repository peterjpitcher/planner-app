'use client';

import { useCallback } from 'react';
import StandaloneTaskList from '@/components/Tasks/StandaloneTaskList';
import { TaskListSkeleton } from '@/components/ui/LoadingStates';
import QuickTaskForm from '@/components/Tasks/QuickTaskForm';
import { PlusIcon } from '@heroicons/react/24/outline';
import {
  FireIcon as SolidFireIcon,
  ExclamationTriangleIcon as SolidExclamationTriangleIcon,
  CheckCircleIcon as SolidCheckIcon,
} from '@heroicons/react/20/solid';
import { todayISO } from '@/components/Tasks/QuickTaskForm';

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
  onTaskDragStateChange,
}) {
  const handleQuickSubmit = useCallback(async ({ name, dueDate, priority }) => {
    if (!onQuickAdd) return;
    await onQuickAdd({ name, dueDate, priority });
  }, [onQuickAdd]);

  return (
    <div className="flex w-full flex-col gap-4 sm:max-w-[28rem] sm:self-center lg:max-w-none">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-[#036586]/85">Tasks</p>
        <h2 className="mt-2 text-xl font-semibold text-[#052a3b]">Flight board</h2>
      </div>
      <div className="card-surface mx-auto w-full overflow-hidden border border-[#0496c7]/20 bg-white/90 p-0 text-[#052a3b] shadow-[0_24px_50px_-32px_rgba(4,150,199,0.35)] backdrop-blur sm:max-w-[28rem] lg:mx-0 lg:max-w-none">
        <QuickTaskForm
          onSubmit={handleQuickSubmit}
          namePlaceholder="What needs doing?"
          buttonLabel="Add"
          buttonIcon={PlusIcon}
          priorityType="pills"
          priorityOptions={quickPriorities}
          defaultPriority="Medium"
          defaultDueDate={todayISO()}
          className="border-b border-[#0496c7]/15 bg-white px-4 py-4 text-[#052a3b]"
        />

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
            onTaskDragStateChange={onTaskDragStateChange}
          />
        )}
      </div>
    </div>
  );
}
