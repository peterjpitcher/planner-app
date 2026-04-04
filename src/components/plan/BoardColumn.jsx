'use client';

import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ChevronDownIcon, ChevronRightIcon, MagnifyingGlassIcon, FunnelIcon } from '@heroicons/react/20/solid';
import { Menu } from '@headlessui/react';
import TaskCard from '@/components/shared/TaskCard';
import { STATE, TODAY_SECTION, TODAY_SECTION_ORDER, SOFT_CAPS, TASK_TYPE } from '@/lib/constants';

// ---------------------------------------------------------------------------
// Today sub-section component
// ---------------------------------------------------------------------------

const SECTION_LABELS = {
  [TODAY_SECTION.MUST_DO]: 'Must Do',
  [TODAY_SECTION.GOOD_TO_DO]: 'Good to Do',
  [TODAY_SECTION.QUICK_WINS]: 'Quick Wins',
};

const SECTION_SOFT_CAP = {
  [TODAY_SECTION.MUST_DO]: SOFT_CAPS.MUST_DO,
  [TODAY_SECTION.GOOD_TO_DO]: SOFT_CAPS.GOOD_TO_DO,
  [TODAY_SECTION.QUICK_WINS]: SOFT_CAPS.QUICK_WINS,
};

function TodaySubSection({ sectionKey, tasks, onComplete, onMove, onUpdate, onClick, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const label = SECTION_LABELS[sectionKey] ?? sectionKey;
  const cap = SECTION_SOFT_CAP[sectionKey];
  const overCap = cap != null && tasks.length > cap;
  const taskIds = tasks.map((t) => t.id);

  return (
    <div className="mb-2">
      {/* Sub-section header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between rounded px-1 py-1 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-1.5">
          {expanded ? (
            <ChevronDownIcon className="h-3.5 w-3.5" />
          ) : (
            <ChevronRightIcon className="h-3.5 w-3.5" />
          )}
          {label}
          <span
            className={`ml-1 rounded-full px-1.5 py-0.5 text-xs font-medium ${
              overCap ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {tasks.length}
          </span>
          {overCap && (
            <span className="text-xs text-amber-500" title={`Over soft cap of ${cap}`}>
              ⚠
            </span>
          )}
        </span>
      </button>

      {/* Tasks */}
      {expanded && (
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          <div className="mt-1 space-y-1.5 pl-1">
            {tasks.length === 0 ? (
              <p className="py-2 text-center text-xs text-gray-400">No tasks</p>
            ) : (
              tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  isDragging={false}
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
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Waiting task card — shows follow-up date and stale flags prominently
// ---------------------------------------------------------------------------

function WaitingTaskRow({ task, onComplete, onMove, onUpdate, onClick, onDelete }) {
  const followUpDate = task.follow_up_date
    ? new Date(task.follow_up_date).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null;

  const isOverdue =
    task.follow_up_date && new Date(task.follow_up_date) < new Date();
  const isStale =
    !task.follow_up_date &&
    task.entered_state_at &&
    (new Date() - new Date(task.entered_state_at)) / (1000 * 60 * 60 * 24) > 7;

  return (
    <div className="relative">
      {(followUpDate || isStale) && (
        <div className="mb-0.5 flex items-center gap-1.5 px-1">
          {followUpDate && (
            <span
              className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                isOverdue
                  ? 'bg-red-50 text-red-600'
                  : 'bg-blue-50 text-blue-600'
              }`}
            >
              {isOverdue ? 'Overdue: ' : 'Follow-up: '}
              {followUpDate}
            </span>
          )}
          {isStale && !followUpDate && (
            <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600">
              Stale — no follow-up date
            </span>
          )}
        </div>
      )}
      <TaskCard
        task={task}
        isDragging={false}
        onComplete={onComplete}
        onMove={onMove}
        onUpdate={onUpdate}
        onClick={onClick}
        onDelete={onDelete}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// TASK_TYPE label map for filter dropdown
// ---------------------------------------------------------------------------

const TASK_TYPE_LABELS = {
  [TASK_TYPE.ADMIN]: 'Admin',
  [TASK_TYPE.REPLY_CHASE]: 'Reply / Chase',
  [TASK_TYPE.FIX]: 'Fix',
  [TASK_TYPE.PLANNING]: 'Planning',
  [TASK_TYPE.CONTENT]: 'Content',
  [TASK_TYPE.DEEP_WORK]: 'Deep Work',
  [TASK_TYPE.PERSONAL]: 'Personal',
};

// ---------------------------------------------------------------------------
// BoardColumn
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

/**
 * BoardColumn — a single kanban column used in the Plan Board.
 *
 * @param {{
 *   title: string,
 *   stateKey: string,
 *   tasks: Array<object>,
 *   count: number,
 *   warning: boolean,
 *   onComplete: (taskId: string) => void,
 *   onMove: (taskId: string, targetState: string, targetSection?: string) => void,
 *   onUpdate: (taskId: string, updates: object) => void,
 *   onClick: (taskId: string) => void,
 *   onDelete: (taskId: string) => void,
 *   children?: React.ReactNode,
 *   areas?: string[],
 *   onLoadMore?: () => void,
 *   hasMore?: boolean,
 * }} props
 */
export default function BoardColumn({
  title,
  stateKey,
  tasks,
  count,
  warning,
  onComplete,
  onMove,
  onUpdate,
  onClick,
  onDelete,
  children,
  areas = [],
  onLoadMore,
  hasMore = false,
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stateKey });

  // Backlog-specific state
  const [search, setSearch] = useState('');
  const [filterArea, setFilterArea] = useState('');
  const [filterType, setFilterType] = useState('');

  // Today — split tasks by sub-section
  const isTodayColumn = stateKey === STATE.TODAY;
  const isWaitingColumn = stateKey === STATE.WAITING;
  const isBacklogColumn = stateKey === STATE.BACKLOG;

  // Filter backlog tasks
  const filteredTasks = isBacklogColumn
    ? tasks.filter((t) => {
        const matchesSearch =
          !search || t.name?.toLowerCase().includes(search.toLowerCase());
        const matchesArea = !filterArea || t.area === filterArea;
        const matchesType = !filterType || t.task_type === filterType;
        return matchesSearch && matchesArea && matchesType;
      })
    : tasks;

  // Today sub-sections
  const todaySections = isTodayColumn
    ? TODAY_SECTION_ORDER.map((sk) => ({
        key: sk,
        tasks: tasks.filter((t) => t.today_section === sk),
      }))
    : null;

  const taskIds = filteredTasks.map((t) => t.id);

  return (
    <div
      ref={setNodeRef}
      className={[
        'flex flex-col rounded-xl border bg-gray-50 transition-colors duration-150',
        isOver ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200',
      ].join(' ')}
    >
      {/* Column header */}
      <div className="flex items-center justify-between rounded-t-xl border-b border-gray-200 bg-white px-3 py-2.5">
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            warning
              ? 'bg-amber-100 text-amber-700'
              : 'bg-gray-100 text-gray-600'
          }`}
        >
          {count}
          {warning && (
            <span className="ml-1" title="Over recommended limit">
              ⚠
            </span>
          )}
        </span>
      </div>

      {/* Column body */}
      <div className="flex-1 overflow-y-auto p-3">
        {/* Backlog: search + filters */}
        {isBacklogColumn && (
          <div className="mb-3 space-y-2">
            {/* Search */}
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search backlog…"
                className="w-full rounded-md border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>

            {/* Filter row */}
            <div className="flex gap-2">
              {/* Area filter */}
              <Menu as="div" className="relative flex-1">
                <Menu.Button className="flex w-full items-center justify-between gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-600 hover:border-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                  <span className="flex items-center gap-1">
                    <FunnelIcon className="h-3.5 w-3.5" />
                    {filterArea || 'Area'}
                  </span>
                  <ChevronDownIcon className="h-3.5 w-3.5 shrink-0" />
                </Menu.Button>
                <Menu.Items className="absolute left-0 z-10 mt-1 w-44 origin-top-left rounded-md border border-gray-200 bg-white py-1 shadow-lg focus:outline-none">
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        type="button"
                        onClick={() => setFilterArea('')}
                        className={`w-full px-3 py-1.5 text-left text-xs ${
                          active ? 'bg-gray-50' : ''
                        } ${!filterArea ? 'font-semibold text-indigo-600' : 'text-gray-700'}`}
                      >
                        All areas
                      </button>
                    )}
                  </Menu.Item>
                  {areas.map((area) => (
                    <Menu.Item key={area}>
                      {({ active }) => (
                        <button
                          type="button"
                          onClick={() => setFilterArea(area)}
                          className={`w-full px-3 py-1.5 text-left text-xs ${
                            active ? 'bg-gray-50' : ''
                          } ${filterArea === area ? 'font-semibold text-indigo-600' : 'text-gray-700'}`}
                        >
                          {area}
                        </button>
                      )}
                    </Menu.Item>
                  ))}
                </Menu.Items>
              </Menu>

              {/* Task type filter */}
              <Menu as="div" className="relative flex-1">
                <Menu.Button className="flex w-full items-center justify-between gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-600 hover:border-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                  <span className="flex items-center gap-1">
                    <FunnelIcon className="h-3.5 w-3.5" />
                    {filterType ? (TASK_TYPE_LABELS[filterType] ?? filterType) : 'Type'}
                  </span>
                  <ChevronDownIcon className="h-3.5 w-3.5 shrink-0" />
                </Menu.Button>
                <Menu.Items className="absolute left-0 z-10 mt-1 w-44 origin-top-left rounded-md border border-gray-200 bg-white py-1 shadow-lg focus:outline-none">
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        type="button"
                        onClick={() => setFilterType('')}
                        className={`w-full px-3 py-1.5 text-left text-xs ${
                          active ? 'bg-gray-50' : ''
                        } ${!filterType ? 'font-semibold text-indigo-600' : 'text-gray-700'}`}
                      >
                        All types
                      </button>
                    )}
                  </Menu.Item>
                  {Object.entries(TASK_TYPE_LABELS).map(([value, label]) => (
                    <Menu.Item key={value}>
                      {({ active }) => (
                        <button
                          type="button"
                          onClick={() => setFilterType(value)}
                          className={`w-full px-3 py-1.5 text-left text-xs ${
                            active ? 'bg-gray-50' : ''
                          } ${filterType === value ? 'font-semibold text-indigo-600' : 'text-gray-700'}`}
                        >
                          {label}
                        </button>
                      )}
                    </Menu.Item>
                  ))}
                </Menu.Items>
              </Menu>
            </div>
          </div>
        )}

        {/* Today: sub-sections */}
        {isTodayColumn && todaySections && (
          <div>
            {todaySections.map(({ key, tasks: sectionTasks }) => (
              <TodaySubSection
                key={key}
                sectionKey={key}
                tasks={sectionTasks}
                onComplete={onComplete}
                onMove={onMove}
                onUpdate={onUpdate}
                onClick={onClick}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}

        {/* Waiting: tasks with follow-up info */}
        {isWaitingColumn && (
          <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {filteredTasks.length === 0 ? (
                <p className="py-4 text-center text-sm text-gray-400">Nothing waiting</p>
              ) : (
                filteredTasks.map((task) => (
                  <WaitingTaskRow
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
        )}

        {/* Backlog: filtered list with load more */}
        {isBacklogColumn && (
          <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {filteredTasks.length === 0 ? (
                <p className="py-4 text-center text-sm text-gray-400">No tasks match</p>
              ) : (
                filteredTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    isDragging={false}
                    onComplete={onComplete}
                    onMove={onMove}
                    onUpdate={onUpdate}
                    onClick={onClick}
                    onDelete={onDelete}
                  />
                ))
              )}
            </div>
            {hasMore && !search && !filterArea && !filterType && (
              <button
                type="button"
                onClick={onLoadMore}
                className="mt-3 w-full rounded-md border border-gray-200 bg-white py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                Load more
              </button>
            )}
          </SortableContext>
        )}

        {/* This Week: plain sortable list */}
        {!isTodayColumn && !isWaitingColumn && !isBacklogColumn && (
          <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {filteredTasks.length === 0 ? (
                <p className="py-4 text-center text-sm text-gray-400">No tasks</p>
              ) : (
                filteredTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    isDragging={false}
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
        )}

        {/* Extra children (e.g. quick-add form) */}
        {children}
      </div>
    </div>
  );
}
