'use client';

import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import TaskCard from '@/components/shared/TaskCard';

/**
 * One section of the Today Focus view (Must Do, Good to Do, Quick Wins).
 *
 * @param {{
 *   title: string,
 *   sectionKey: string,
 *   tasks: object[],
 *   softCap: number,
 *   onComplete: (taskId: string) => void,
 *   onMove: (taskId: string, targetState: string, targetSection?: string) => void,
 *   onUpdate: (taskId: string, updates: object) => void,
 *   onClick: (taskId: string) => void,
 *   onDelete: (taskId: string) => void,
 * }} props
 */
export default function TodaySection({
  title,
  sectionKey,
  tasks,
  softCap,
  onComplete,
  onMove,
  onUpdate,
  onClick,
  onDelete,
}) {
  const count = tasks.length;
  const overCap = count > softCap;

  return (
    <div className="flex flex-col gap-2">
      {/* Section header */}
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          {title}
        </h2>
        <span
          className={[
            'rounded-full px-2 py-0.5 text-xs font-medium',
            overCap
              ? 'bg-amber-100 text-amber-700'
              : 'bg-gray-100 text-gray-500',
          ].join(' ')}
          title={overCap ? `Over soft cap of ${softCap}` : `${count} task${count !== 1 ? 's' : ''}`}
        >
          {count}/{softCap}
        </span>
        {overCap && (
          <span className="text-xs text-amber-600 font-medium">
            Over limit
          </span>
        )}
      </div>

      {/* Task list */}
      <SortableContext
        id={sectionKey}
        items={tasks.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col gap-2 min-h-[2rem]">
          {tasks.length === 0 ? (
            <p className="py-3 text-center text-xs text-gray-400 select-none">
              No tasks
            </p>
          ) : (
            tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onComplete={onComplete}
                onMove={onMove}
                onUpdate={onUpdate}
                onClick={onClick}
                onDelete={onDelete}
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}
