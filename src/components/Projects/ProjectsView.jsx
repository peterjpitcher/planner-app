'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Menu } from '@headlessui/react';
import {
  EllipsisVerticalIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon, PauseCircleIcon } from '@heroicons/react/20/solid';
import { format, parseISO } from 'date-fns';
import { apiClient } from '@/lib/apiClient';
import { getStatusClasses } from '@/lib/styleUtils';
import { STATE, PROJECT_STATUS } from '@/lib/constants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATE_LABELS = {
  [STATE.TODAY]: 'Today',
  [STATE.THIS_WEEK]: 'This Week',
  [STATE.BACKLOG]: 'Backlog',
  [STATE.WAITING]: 'Waiting',
};

// Ordered so active statuses sort before inactive ones
const STATUS_SORT_ORDER = [
  PROJECT_STATUS.IN_PROGRESS,
  PROJECT_STATUS.OPEN,
  PROJECT_STATUS.ON_HOLD,
  PROJECT_STATUS.COMPLETED,
  PROJECT_STATUS.CANCELLED,
];

function formatDueDate(dateStr) {
  if (!dateStr) return null;
  try {
    return format(parseISO(dateStr), 'MMM d, yyyy');
  } catch {
    return null;
  }
}

function groupTasksByState(tasks) {
  const groups = {
    [STATE.TODAY]: [],
    [STATE.THIS_WEEK]: [],
    [STATE.BACKLOG]: [],
    [STATE.WAITING]: [],
  };
  for (const task of tasks) {
    if (groups[task.state] !== undefined) {
      groups[task.state].push(task);
    }
  }
  return groups;
}

function buildStateSummary(grouped) {
  const parts = [];
  if (grouped[STATE.TODAY].length > 0)
    parts.push(`${grouped[STATE.TODAY].length} today`);
  if (grouped[STATE.THIS_WEEK].length > 0)
    parts.push(`${grouped[STATE.THIS_WEEK].length} this week`);
  if (grouped[STATE.BACKLOG].length > 0)
    parts.push(`${grouped[STATE.BACKLOG].length} backlog`);
  if (grouped[STATE.WAITING].length > 0)
    parts.push(`${grouped[STATE.WAITING].length} waiting`);
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function ProjectCardSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="h-4 w-1/2 rounded bg-gray-200" />
        <div className="h-5 w-16 rounded-full bg-gray-100" />
      </div>
      <div className="mt-2 h-3 w-1/3 rounded bg-gray-100" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// State badge
// ---------------------------------------------------------------------------

function StateBadge({ state }) {
  const label = STATE_LABELS[state] ?? state;
  const colourMap = {
    [STATE.TODAY]: 'bg-red-50 text-red-700',
    [STATE.THIS_WEEK]: 'bg-blue-50 text-blue-700',
    [STATE.BACKLOG]: 'bg-gray-100 text-gray-600',
    [STATE.WAITING]: 'bg-amber-50 text-amber-700',
  };
  const cls = colourMap[state] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Task row inside expanded project card
// ---------------------------------------------------------------------------

function TaskRow({ task }) {
  const dueDateLabel = formatDueDate(task.due_date);
  return (
    <li className="flex items-center gap-2 py-1.5 text-sm text-gray-700">
      <span className="flex-1 truncate">{task.name}</span>
      <StateBadge state={task.state} />
      {dueDateLabel && (
        <span className="shrink-0 text-xs text-gray-400">{dueDateLabel}</span>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Project card
// ---------------------------------------------------------------------------

function ProjectCard({ project, tasks, onQuickAction }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isActioning, setIsActioning] = useState(false);

  const grouped = groupTasksByState(tasks);
  const totalActive = tasks.length;
  const stateSummary = buildStateSummary(grouped);
  const hasNoActiveTasks = totalActive === 0;

  const dueDateLabel = formatDueDate(project.due_date);
  const statusClasses = getStatusClasses(project.status);

  async function handleAction(actionType) {
    if (isActioning) return;
    setIsActioning(true);
    try {
      await onQuickAction(project.id, actionType);
    } finally {
      setIsActioning(false);
    }
  }

  const isCompleted =
    project.status === PROJECT_STATUS.COMPLETED ||
    project.status === PROJECT_STATUS.CANCELLED;

  return (
    <div
      className={`rounded-lg border bg-white shadow-sm transition-shadow hover:shadow-md ${
        isCompleted ? 'border-gray-200 opacity-75' : 'border-gray-200'
      }`}
    >
      {/* Card header */}
      <div className="flex items-start gap-3 p-4">
        {/* Expand toggle */}
        <button
          type="button"
          onClick={() => setIsExpanded((v) => !v)}
          className="mt-0.5 shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          aria-label={isExpanded ? 'Collapse project tasks' : 'Expand project tasks'}
        >
          {isExpanded ? (
            <ChevronDownIcon className="h-4 w-4" />
          ) : (
            <ChevronRightIcon className="h-4 w-4" />
          )}
        </button>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900 truncate">
              {project.name}
            </h3>
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusClasses}`}
            >
              {project.status}
            </span>
            {project.area && (
              <span className="inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
                {project.area}
              </span>
            )}
          </div>

          {/* Task count / state summary */}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            {hasNoActiveTasks ? (
              <span className="inline-flex items-center gap-1 font-medium text-amber-600">
                <ExclamationTriangleIcon className="h-3.5 w-3.5" />
                No active tasks
              </span>
            ) : (
              <span>
                {totalActive} active task{totalActive !== 1 ? 's' : ''}
                {stateSummary ? ` — ${stateSummary}` : ''}
              </span>
            )}
            {dueDateLabel && (
              <>
                <span className="text-gray-300">·</span>
                <span>Due {dueDateLabel}</span>
              </>
            )}
          </div>
        </div>

        {/* Three-dot menu */}
        <Menu as="div" className="relative shrink-0">
          <Menu.Button
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            aria-label="Project actions"
            disabled={isActioning}
          >
            <EllipsisVerticalIcon className="h-5 w-5" />
          </Menu.Button>

          <Menu.Items
            anchor="bottom end"
            className="absolute right-0 z-10 mt-1 w-48 origin-top-right rounded-md border border-gray-200 bg-white py-1 shadow-lg focus:outline-none"
          >
            {project.status !== PROJECT_STATUS.COMPLETED && (
              <Menu.Item>
                {({ active }) => (
                  <button
                    type="button"
                    onClick={() => handleAction('complete')}
                    className={`flex w-full items-center gap-2 px-4 py-2 text-sm ${
                      active ? 'bg-gray-50 text-gray-900' : 'text-gray-700'
                    }`}
                  >
                    <CheckCircleIcon className="h-4 w-4 text-green-500" />
                    Complete project
                  </button>
                )}
              </Menu.Item>
            )}
            {project.status !== PROJECT_STATUS.ON_HOLD && (
              <Menu.Item>
                {({ active }) => (
                  <button
                    type="button"
                    onClick={() => handleAction('hold')}
                    className={`flex w-full items-center gap-2 px-4 py-2 text-sm ${
                      active ? 'bg-gray-50 text-gray-900' : 'text-gray-700'
                    }`}
                  >
                    <PauseCircleIcon className="h-4 w-4 text-amber-500" />
                    Put on hold
                  </button>
                )}
              </Menu.Item>
            )}
            <Menu.Item>
              {({ active }) => (
                <a
                  href="/plan"
                  className={`flex w-full items-center gap-2 px-4 py-2 text-sm ${
                    active ? 'bg-gray-50 text-gray-900' : 'text-gray-700'
                  }`}
                >
                  <svg
                    className="h-4 w-4 text-indigo-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 4.5v15m6-15v15M3.75 9h16.5M3.75 15h16.5"
                    />
                  </svg>
                  View in Plan board
                </a>
              )}
            </Menu.Item>
          </Menu.Items>
        </Menu>
      </div>

      {/* Expanded task list */}
      {isExpanded && (
        <div className="border-t border-gray-100 px-4 pb-3 pt-2">
          {tasks.length === 0 ? (
            <p className="py-2 text-xs text-gray-400 italic">No active tasks for this project.</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {tasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProjectsView
// ---------------------------------------------------------------------------

export default function ProjectsView() {
  const [projects, setProjects] = useState([]);
  const [tasksByProject, setTasksByProject] = useState({});
  const [unassignedTasks, setUnassignedTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [isUnassignedExpanded, setIsUnassignedExpanded] = useState(false);

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [allProjects, activeTasks] = await Promise.all([
        apiClient.getProjects(true), // include completed so we can toggle them
        apiClient.getTasks(null, { states: 'today,this_week,backlog,waiting' }),
      ]);

      // Group tasks by project_id
      const byProject = {};
      const unassigned = [];

      for (const task of activeTasks) {
        if (task.project_id) {
          if (!byProject[task.project_id]) byProject[task.project_id] = [];
          byProject[task.project_id].push(task);
        } else {
          unassigned.push(task);
        }
      }

      setProjects(allProjects);
      setTasksByProject(byProject);
      setUnassignedTasks(unassigned);
    } catch (err) {
      setError(err.message || 'Failed to load projects.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // -------------------------------------------------------------------------
  // Quick actions
  // -------------------------------------------------------------------------

  const handleQuickAction = useCallback(async (projectId, actionType) => {
    const statusMap = {
      complete: PROJECT_STATUS.COMPLETED,
      hold: PROJECT_STATUS.ON_HOLD,
    };
    const newStatus = statusMap[actionType];
    if (!newStatus) return;

    try {
      await apiClient.updateProject(projectId, { status: newStatus });
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, status: newStatus } : p))
      );
    } catch (err) {
      setError(err.message || 'Failed to update project.');
    }
  }, []);

  // -------------------------------------------------------------------------
  // Derived / sorted list
  // -------------------------------------------------------------------------

  const visibleProjects = projects
    .filter((p) => {
      if (showCompleted) return true;
      return (
        p.status !== PROJECT_STATUS.COMPLETED &&
        p.status !== PROJECT_STATUS.CANCELLED
      );
    })
    .sort((a, b) => {
      const aOrder = STATUS_SORT_ORDER.indexOf(a.status);
      const bOrder = STATUS_SORT_ORDER.indexOf(b.status);
      if (aOrder !== bOrder) return aOrder - bOrder;
      // Secondary sort: due date ascending, nulls last
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return 0;
    });

  const completedCount = projects.filter(
    (p) =>
      p.status === PROJECT_STATUS.COMPLETED ||
      p.status === PROJECT_STATUS.CANCELLED
  ).length;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Projects</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Review project health and close out completed work.
          </p>
        </div>
        {completedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowCompleted((v) => !v)}
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {showCompleted
              ? 'Hide completed'
              : `Show completed (${completedCount})`}
          </button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <ProjectCardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && visibleProjects.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white py-12 text-center">
          <p className="text-sm font-medium text-gray-500">No projects yet</p>
          <p className="mt-1 text-xs text-gray-400">
            Create a project to start grouping your tasks.
          </p>
        </div>
      )}

      {/* Project list */}
      {!loading && visibleProjects.length > 0 && (
        <div className="space-y-3">
          {visibleProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              tasks={tasksByProject[project.id] ?? []}
              onQuickAction={handleQuickAction}
            />
          ))}
        </div>
      )}

      {/* Unassigned tasks section */}
      {!loading && unassignedTasks.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setIsUnassignedExpanded((v) => !v)}
            className="flex w-full items-center gap-3 p-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
          >
            {isUnassignedExpanded ? (
              <ChevronDownIcon className="h-4 w-4 shrink-0 text-gray-400" />
            ) : (
              <ChevronRightIcon className="h-4 w-4 shrink-0 text-gray-400" />
            )}
            <div className="flex-1 min-w-0">
              <span className="text-sm font-semibold text-gray-700">
                Unassigned tasks
              </span>
              <span className="ml-2 text-xs text-gray-400">
                {unassignedTasks.length} task{unassignedTasks.length !== 1 ? 's' : ''} with no project
              </span>
            </div>
          </button>
          {isUnassignedExpanded && (
            <div className="border-t border-gray-100 px-4 pb-3 pt-2">
              <ul className="divide-y divide-gray-50">
                {unassignedTasks.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
