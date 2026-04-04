'use client';

import React, { useMemo } from 'react';
import { Menu, Portal } from '@headlessui/react';
import { EllipsisVerticalIcon, Bars2Icon } from '@heroicons/react/20/solid';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { getDueDateStatus } from '@/lib/dateUtils';
import { STATE, TODAY_SECTION, TODAY_SECTION_ORDER } from '@/lib/constants';
import ChipBadge from './ChipBadge';

// ---------------------------------------------------------------------------
// Staleness helpers
// ---------------------------------------------------------------------------

/**
 * Derive whether a task is stale based on its state and entered_state_at.
 * Returns { isStale: boolean, isOverdue: boolean }.
 */
function getStaleness(task) {
  if (!task?.entered_state_at) return { isStale: false, isOverdue: false };

  const entered = parseISO(task.entered_state_at);
  const daysInState = differenceInCalendarDays(new Date(), entered);

  if (task.state === STATE.THIS_WEEK && daysInState > 14) {
    return { isStale: true, isOverdue: false };
  }

  if (task.state === STATE.WAITING) {
    if (task.follow_up_date) {
      const followUp = parseISO(task.follow_up_date);
      const isOverdue = differenceInCalendarDays(new Date(), followUp) > 0;
      return { isStale: isOverdue, isOverdue };
    }
    // Waiting with no follow-up date
    if (daysInState > 7) return { isStale: true, isOverdue: false };
  }

  return { isStale: false, isOverdue: false };
}

// ---------------------------------------------------------------------------
// Move destinations for the quick action menu
// ---------------------------------------------------------------------------

const MOVE_TARGETS = [
  {
    label: 'Today — Must Do',
    state: STATE.TODAY,
    section: TODAY_SECTION.MUST_DO,
  },
  {
    label: 'Today — Good to Do',
    state: STATE.TODAY,
    section: TODAY_SECTION.GOOD_TO_DO,
  },
  {
    label: 'Today — Quick Wins',
    state: STATE.TODAY,
    section: TODAY_SECTION.QUICK_WINS,
  },
  { label: 'This Week', state: STATE.THIS_WEEK, section: undefined },
  { label: 'Backlog', state: STATE.BACKLOG, section: undefined },
  { label: 'Waiting', state: STATE.WAITING, section: undefined },
];

// ---------------------------------------------------------------------------
// Due date badge
// ---------------------------------------------------------------------------

function DueDateBadge({ dueDate }) {
  const status = useMemo(() => getDueDateStatus(dueDate), [dueDate]);
  if (!status) return null;

  return (
    <span
      className={`shrink-0 text-xs font-medium px-1.5 py-0.5 rounded ${status.styles.bg} ${status.styles.text}`}
    >
      {status.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// TaskCard
// ---------------------------------------------------------------------------

/**
 * Compact task card used in Today and Plan Board views.
 *
 * @param {{
 *   task: object,
 *   isDragging: boolean,
 *   onComplete: (taskId: string) => void,
 *   onMove: (taskId: string, targetState: string, targetSection?: string) => void,
 *   onUpdate: (taskId: string, updates: object) => void,
 *   onClick: (taskId: string) => void,
 * }} props
 */
export default function TaskCard({ task, isDragging, onComplete, onMove, onUpdate, onClick }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isCompleted = task.is_completed || task.status === 'completed';
  const chips = Array.isArray(task.chips) ? task.chips : [];
  const { isStale, isOverdue: isFollowUpOverdue } = useMemo(() => getStaleness(task), [task]);

  // Card container classes
  const containerClasses = [
    'group relative flex items-start gap-2 rounded-lg border bg-white px-2.5 py-2 text-sm shadow-sm',
    'transition-shadow duration-150',
    isDragging ? 'opacity-50 shadow-lg ring-2 ring-indigo-300' : 'hover:shadow-md',
    isCompleted ? 'opacity-60' : '',
    isStale && !isCompleted
      ? isFollowUpOverdue
        ? 'border-red-300'
        : 'border-amber-300'
      : 'border-gray-200',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={setNodeRef} style={style} className={containerClasses}>
      {/* Drag handle */}
      <button
        type="button"
        className="mt-0.5 shrink-0 cursor-grab touch-none text-gray-300 hover:text-gray-500 active:cursor-grabbing focus:outline-none"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <Bars2Icon className="h-4 w-4" />
      </button>

      {/* Checkbox */}
      <input
        type="checkbox"
        checked={isCompleted}
        onChange={() => onComplete?.(task.id)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
        aria-label={`Mark "${task.name}" complete`}
      />

      {/* Content */}
      <div className="min-w-0 flex-1">
        {/* Task name */}
        <button
          type="button"
          onClick={() => onClick?.(task.id)}
          className={[
            'w-full text-left text-sm font-medium leading-snug',
            'focus:outline-none focus-visible:underline',
            isCompleted ? 'text-gray-400 line-through' : 'text-gray-800 hover:text-indigo-700',
          ].join(' ')}
        >
          {task.name || 'Untitled task'}
        </button>

        {/* Chips row */}
        {chips.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {chips.map((chip) => (
              <ChipBadge key={chip} chip={chip} />
            ))}
          </div>
        )}

        {/* Area label */}
        {task.area && (
          <p className="mt-0.5 text-xs text-gray-400">{task.area}</p>
        )}

        {/* Stale badge (shown below area to avoid clutter) */}
        {isStale && !isCompleted && (
          <span
            className={`mt-1 inline-block text-xs font-medium px-1.5 py-0.5 rounded-full ${
              isFollowUpOverdue
                ? 'bg-red-50 text-red-600'
                : 'bg-amber-50 text-amber-600'
            }`}
          >
            {isFollowUpOverdue ? 'Follow-up overdue' : 'Stale'}
          </span>
        )}
      </div>

      {/* Right side: due date + menu */}
      <div className="flex shrink-0 items-center gap-1.5">
        {task.due_date && <DueDateBadge dueDate={task.due_date} />}

        {/* Three-dot quick action menu */}
        <Menu as="div" className="relative">
          <Menu.Button
            type="button"
            className="rounded p-0.5 text-gray-300 opacity-0 transition-opacity group-hover:opacity-100 hover:text-gray-600 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            aria-label="Task actions"
          >
            <EllipsisVerticalIcon className="h-4 w-4" />
          </Menu.Button>

          <Menu.Items anchor="bottom end" className="z-50 w-48 rounded-md border border-gray-200 bg-white py-1 shadow-lg focus:outline-none">
            {/* Complete / Un-complete */}
            <Menu.Item>
              {({ active }) => (
                <button
                  type="button"
                  onClick={() => onComplete?.(task.id)}
                  className={`w-full px-3 py-1.5 text-left text-sm ${
                    active ? 'bg-gray-50 text-gray-900' : 'text-gray-700'
                  }`}
                >
                  {isCompleted ? 'Un-complete' : 'Complete'}
                </button>
              )}
            </Menu.Item>

            {/* Divider */}
            <div className="my-1 border-t border-gray-100" role="separator" />

            {/* Move to... sub-options */}
            <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Move to
            </p>
            {MOVE_TARGETS.map((target) => (
              <Menu.Item key={`${target.state}-${target.section ?? ''}`}>
                {({ active }) => (
                  <button
                    type="button"
                    onClick={() => onMove?.(task.id, target.state, target.section)}
                    className={`w-full px-3 py-1.5 text-left text-sm ${
                      active ? 'bg-gray-50 text-gray-900' : 'text-gray-700'
                    }`}
                  >
                    {target.label}
                  </button>
                )}
              </Menu.Item>
            ))}
          </Menu.Items>
        </Menu>
      </div>
    </div>
  );
}
