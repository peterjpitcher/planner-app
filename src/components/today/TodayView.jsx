'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/20/solid';
import { ExclamationTriangleIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

import { apiClient } from '@/lib/apiClient';
import { TODAY_SECTION_ORDER, SOFT_CAPS } from '@/lib/constants';
import { getStartOfTodayLondon } from '@/lib/dateUtils';
import { computeSortOrder, needsReindex, reindex } from '@/lib/sortOrder';
import { TaskListSkeleton } from '@/components/ui/LoadingStates';
import TaskCard from '@/components/shared/TaskCard';
import TodaySection from './TodaySection';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SECTION_LABELS = {
  must_do: 'Must Do',
  good_to_do: 'Good to Do',
  quick_wins: 'Quick Wins',
};

const SECTION_SOFT_CAPS = {
  must_do: SOFT_CAPS.MUST_DO,
  good_to_do: SOFT_CAPS.GOOD_TO_DO,
  quick_wins: SOFT_CAPS.QUICK_WINS,
};

const FIRST_RUN_KEY = 'planner_first_run_triage_shown';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Group a flat task array into a map keyed by today_section.
 * Tasks with no / unknown section fall into must_do.
 */
function groupBySection(tasks) {
  const groups = { must_do: [], good_to_do: [], quick_wins: [] };
  for (const task of tasks) {
    const section = task.today_section && groups[task.today_section] !== undefined
      ? task.today_section
      : 'must_do';
    groups[section].push(task);
  }
  // Sort each section by sort_order ascending (nulls last)
  for (const key of TODAY_SECTION_ORDER) {
    groups[key].sort((a, b) => {
      if (a.sort_order == null && b.sort_order == null) return 0;
      if (a.sort_order == null) return 1;
      if (b.sort_order == null) return -1;
      return a.sort_order - b.sort_order;
    });
  }
  return groups;
}

/**
 * Find which section contains a task id.
 */
function findSection(sections, taskId) {
  for (const key of TODAY_SECTION_ORDER) {
    if (sections[key].some((t) => t.id === taskId)) return key;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TodayView() {
  // Sections state: { must_do: [], good_to_do: [], quick_wins: [] }
  const [sections, setSections] = useState({ must_do: [], good_to_do: [], quick_wins: [] });
  const [completedToday, setCompletedToday] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [overdueFollowUps, setOverdueFollowUps] = useState(0);
  const [firstRunInfo, setFirstRunInfo] = useState(null); // { overdue, dueThisWeek }

  // Track in-flight optimistic task ids to avoid double-firing
  const pendingRef = useRef(new Set());

  // ---------------------------------------------------------------------------
  // DnD sensors
  // ---------------------------------------------------------------------------

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [todayTasks, doneTasks] = await Promise.all([
        apiClient.getTasks(null, { state: 'today' }),
        apiClient.getTasks(null, {
          state: 'done',
          completedSince: getStartOfTodayLondon().toISOString(),
        }),
      ]);

      setSections(groupBySection(todayTasks));
      setCompletedToday(doneTasks);

      // Overdue follow-ups (waiting tasks with past follow_up_date)
      try {
        const waitingTasks = await apiClient.getTasks(null, { state: 'waiting' });
        const today = new Date();
        const overdue = waitingTasks.filter((t) => {
          if (!t.follow_up_date) return false;
          return new Date(t.follow_up_date) < today;
        });
        setOverdueFollowUps(overdue.length);
      } catch {
        // Non-critical — ignore
      }

      // First-run triage banner
      if (typeof window !== 'undefined' && !localStorage.getItem(FIRST_RUN_KEY)) {
        try {
          const backlog = await apiClient.getTasks(null, { state: 'backlog' });
          const now = new Date();
          const weekFromNow = new Date(now);
          weekFromNow.setDate(weekFromNow.getDate() + 7);
          const overdueBl = backlog.filter(
            (t) => t.due_date && new Date(t.due_date) < now
          ).length;
          const dueThisWeek = backlog.filter(
            (t) => t.due_date && new Date(t.due_date) >= now && new Date(t.due_date) <= weekFromNow
          ).length;
          if (overdueBl + dueThisWeek > 0) {
            setFirstRunInfo({ overdue: overdueBl, dueThisWeek });
          }
        } catch {
          // Non-critical — ignore
        }
      }
    } catch (err) {
      setError(err.message || 'Failed to load today\'s tasks.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleComplete = useCallback(async (taskId) => {
    if (pendingRef.current.has(taskId)) return;
    pendingRef.current.add(taskId);

    // Optimistically move task out of sections and into completedToday
    let movedTask = null;
    setSections((prev) => {
      const next = { must_do: [...prev.must_do], good_to_do: [...prev.good_to_do], quick_wins: [...prev.quick_wins] };
      for (const key of TODAY_SECTION_ORDER) {
        const idx = next[key].findIndex((t) => t.id === taskId);
        if (idx !== -1) {
          [movedTask] = next[key].splice(idx, 1);
          break;
        }
      }
      return next;
    });

    if (movedTask) {
      setCompletedToday((prev) => [{ ...movedTask, state: 'done' }, ...prev]);
    }

    try {
      await apiClient.updateTask(taskId, { state: 'done' });
    } catch (err) {
      // Revert on failure
      if (movedTask) {
        setCompletedToday((prev) => prev.filter((t) => t.id !== taskId));
        setSections((prev) => {
          const key = movedTask.today_section ?? 'must_do';
          return { ...prev, [key]: [...prev[key], movedTask] };
        });
        alert(`Failed to complete task: ${err.message}`);
      }
    } finally {
      pendingRef.current.delete(taskId);
    }
  }, []);

  const handleMove = useCallback(async (taskId, targetState, targetSection) => {
    // Find task across sections or completedToday
    let movedTask = null;
    let sourceSection = null;

    setSections((prev) => {
      const next = { must_do: [...prev.must_do], good_to_do: [...prev.good_to_do], quick_wins: [...prev.quick_wins] };
      for (const key of TODAY_SECTION_ORDER) {
        const idx = next[key].findIndex((t) => t.id === taskId);
        if (idx !== -1) {
          [movedTask] = next[key].splice(idx, 1);
          sourceSection = key;
          break;
        }
      }
      return next;
    });

    const updates = targetSection
      ? { state: targetState, today_section: targetSection }
      : { state: targetState };

    try {
      await apiClient.updateTask(taskId, updates);
      // If moving to a different today section, add back
      if (targetState === 'today' && targetSection && targetSection !== sourceSection) {
        setSections((prev) => ({
          ...prev,
          [targetSection]: [
            ...(prev[targetSection] || []),
            { ...movedTask, today_section: targetSection },
          ],
        }));
      }
    } catch (err) {
      // Revert: put task back where it came from
      if (movedTask && sourceSection) {
        setSections((prev) => ({
          ...prev,
          [sourceSection]: [...prev[sourceSection], movedTask],
        }));
      }
      alert(`Failed to move task: ${err.message}`);
    }
  }, []);

  const handleUpdate = useCallback(async (taskId, updates) => {
    try {
      await apiClient.updateTask(taskId, updates);
    } catch (err) {
      alert(`Failed to update task: ${err.message}`);
    }
  }, []);

  const handleTaskClick = useCallback((taskId) => {
    // Placeholder — detail drawer not in scope for this task
    // Future: open task detail panel
    void taskId;
  }, []);

  // ---------------------------------------------------------------------------
  // Drag and drop
  // ---------------------------------------------------------------------------

  const handleDragEnd = useCallback(async (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = active.id;
    const overId = over.id;

    // Determine source section
    const sourceSection = findSection(sections, activeId);
    if (!sourceSection) return;

    // Determine target section: over.id may be a task id or a section container id
    let targetSection = TODAY_SECTION_ORDER.includes(overId)
      ? overId
      : findSection(sections, overId);

    if (!targetSection) return;

    if (sourceSection === targetSection) {
      // Reorder within section
      const items = sections[sourceSection];
      const oldIndex = items.findIndex((t) => t.id === activeId);
      const newIndex = items.findIndex((t) => t.id === overId);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(items, oldIndex, newIndex);

      // Compute new sort_order for the moved item
      const above = reordered[newIndex - 1]?.sort_order ?? null;
      const below = reordered[newIndex + 1]?.sort_order ?? null;

      let updatedItems;
      if (needsReindex(above, below)) {
        updatedItems = reindex(reordered);
      } else {
        const newOrder = computeSortOrder(above, below);
        updatedItems = reordered.map((t, i) =>
          i === newIndex ? { ...t, sort_order: newOrder } : t
        );
      }

      // Optimistic update
      setSections((prev) => ({ ...prev, [sourceSection]: updatedItems }));

      try {
        await apiClient.updateSortOrder(
          updatedItems.map((t) => ({ id: t.id, sort_order: t.sort_order }))
        );
      } catch (err) {
        // Revert
        setSections((prev) => ({ ...prev, [sourceSection]: items }));
        alert(`Failed to save order: ${err.message}`);
      }
    } else {
      // Move between sections
      const sourceItems = [...sections[sourceSection]];
      const targetItems = [...sections[targetSection]];

      const movedIdx = sourceItems.findIndex((t) => t.id === activeId);
      if (movedIdx === -1) return;
      const [movedTask] = sourceItems.splice(movedIdx, 1);

      // Insert at position of target item, or append if dropping on container
      const targetIdx = targetItems.findIndex((t) => t.id === overId);
      const insertIdx = targetIdx === -1 ? targetItems.length : targetIdx;
      targetItems.splice(insertIdx, 0, { ...movedTask, today_section: targetSection });

      // Optimistic update
      setSections((prev) => ({
        ...prev,
        [sourceSection]: sourceItems,
        [targetSection]: targetItems,
      }));

      try {
        await apiClient.updateTask(activeId, {
          state: 'today',
          today_section: targetSection,
        });
      } catch (err) {
        // Revert
        setSections((prev) => ({
          ...prev,
          [sourceSection]: sections[sourceSection],
          [targetSection]: sections[targetSection],
        }));
        alert(`Failed to move task: ${err.message}`);
      }
    }
  }, [sections]);

  // ---------------------------------------------------------------------------
  // Dismiss first-run banner
  // ---------------------------------------------------------------------------

  const dismissFirstRun = useCallback(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(FIRST_RUN_KEY, '1');
    }
    setFirstRunInfo(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const totalTodayCount = TODAY_SECTION_ORDER.reduce(
    (sum, key) => sum + sections[key].length,
    0
  );
  const isTodayEmpty = !isLoading && totalTodayCount === 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6 max-w-2xl mx-auto">
        {TODAY_SECTION_ORDER.map((key) => (
          <div key={key} className="flex flex-col gap-2">
            <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
            <TaskListSkeleton count={2} />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto rounded-lg border border-red-200 bg-red-50 p-4 flex items-start gap-3">
        <ExclamationTriangleIcon className="h-5 w-5 shrink-0 text-red-500 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-red-700">{error}</p>
        </div>
        <button
          type="button"
          onClick={loadData}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          <ArrowPathIcon className="h-3.5 w-3.5" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">

      {/* First-run triage banner */}
      {firstRunInfo && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0 text-amber-500 mt-0.5" />
          <div className="flex-1 text-sm text-amber-800">
            You have{' '}
            {firstRunInfo.overdue > 0 && (
              <strong>{firstRunInfo.overdue} overdue</strong>
            )}
            {firstRunInfo.overdue > 0 && firstRunInfo.dueThisWeek > 0 && ' and '}
            {firstRunInfo.dueThisWeek > 0 && (
              <strong>{firstRunInfo.dueThisWeek} due this week</strong>
            )}{' '}
            in Backlog.{' '}
            <Link href="/plan" className="underline font-medium hover:text-amber-900">
              Review now?
            </Link>
          </div>
          <button
            type="button"
            onClick={dismissFirstRun}
            className="text-amber-500 hover:text-amber-700 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded px-1"
            aria-label="Dismiss triage banner"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Overdue follow-ups banner */}
      {overdueFollowUps > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-center gap-3">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0 text-red-400" />
          <p className="flex-1 text-sm text-red-700">
            <strong>{overdueFollowUps}</strong> overdue follow-up{overdueFollowUps !== 1 ? 's' : ''} in Waiting.{' '}
            <Link href="/plan" className="underline font-medium hover:text-red-900">
              Review
            </Link>
          </p>
        </div>
      )}

      {/* Empty state nudge */}
      {isTodayEmpty && (
        <div className="rounded-lg border border-dashed border-gray-300 px-6 py-10 text-center">
          <p className="text-sm text-gray-500">No tasks for today yet.</p>
          <p className="mt-1 text-sm text-gray-400">
            Pull from{' '}
            <Link href="/plan" className="text-indigo-600 underline hover:text-indigo-800">
              This Week
            </Link>
            ?
          </p>
        </div>
      )}

      {/* Three today sections wrapped in DndContext */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <div className="flex flex-col gap-8">
          {TODAY_SECTION_ORDER.map((key) => (
            <TodaySection
              key={key}
              title={SECTION_LABELS[key]}
              sectionKey={key}
              tasks={sections[key]}
              softCap={SECTION_SOFT_CAPS[key]}
              onComplete={handleComplete}
              onMove={handleMove}
              onUpdate={handleUpdate}
              onClick={handleTaskClick}
            />
          ))}
        </div>
      </DndContext>

      {/* Completed today — collapsible */}
      {completedToday.length > 0 && (
        <div className="border-t border-gray-200 pt-4">
          <button
            type="button"
            onClick={() => setCompletedOpen((o) => !o)}
            className="flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-sm font-medium text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            aria-expanded={completedOpen}
          >
            <span>
              Completed today{' '}
              <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                {completedToday.length}
              </span>
            </span>
            {completedOpen ? (
              <ChevronUpIcon className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronDownIcon className="h-4 w-4 shrink-0" />
            )}
          </button>

          {completedOpen && (
            <div className="mt-3 flex flex-col gap-2">
              {completedToday.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onComplete={handleComplete}
                  onMove={handleMove}
                  onUpdate={handleUpdate}
                  onClick={handleTaskClick}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
