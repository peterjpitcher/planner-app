'use client';

import { useCallback } from 'react';
import StandaloneTaskList from '@/components/Tasks/StandaloneTaskList';
import { TaskListSkeleton } from '@/components/ui/LoadingStates';
import QuickTaskForm from '@/components/Tasks/QuickTaskForm';
import { Card, CardContent } from '@/components/ui/Card'; // Use standard Card
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
  onQuickAdd,
  onTaskDragStateChange,
}) {
  const handleQuickSubmit = useCallback(async ({ name, dueDate, priority }) => {
    if (!onQuickAdd) return;
    await onQuickAdd({ name, dueDate, priority });
  }, [onQuickAdd]);

  return (
    <div id="tasks-panel" className="flex w-full flex-col gap-4">
      {/* Standardized Header */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Tasks</p>
        <h2 className="text-lg font-semibold text-foreground">Flight board</h2>
      </div>

      <Card className="border-border shadow-sm bg-card overflow-hidden">
        {/* Quick Add Section - No internal padding on Card, so we pad the children */}
        <div className="border-b border-border bg-muted/30 p-4">
          <QuickTaskForm
            onSubmit={handleQuickSubmit}
            namePlaceholder="What needs doing?"
            buttonLabel="Add"
            buttonIcon={PlusIcon}
            priorityType="pills"
            priorityOptions={quickPriorities}
            defaultPriority="Medium"
            defaultDueDate={todayISO()}
            // Override internal class to fit new container
            className="bg-transparent"
          />
        </div>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4">
              <TaskListSkeleton />
            </div>
          ) : (
            // StandaloneTaskList might have its own padding, check or wrap
            // Assuming it renders a list, let's give it padding container
            <div className="bg-background/50">
              <StandaloneTaskList
                allUserTasks={tasks}
                projects={projects}
                onTaskUpdateNeeded={onTaskUpdate}
                onTaskDragStateChange={onTaskDragStateChange}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
