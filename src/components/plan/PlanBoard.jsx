'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  closestCenter,
  pointerWithin,
  rectIntersection,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { format, addDays } from 'date-fns';
import { apiClient } from '@/lib/apiClient';
import { createLatestGuard } from '@/lib/requestCache';
import { STATE, TODAY_SECTION, SOFT_CAPS } from '@/lib/constants';
import { computeSortOrder, needsReindex, reindex } from '@/lib/sortOrder';
import { compareBacklogTasks } from '@/lib/taskSort';
import { getLondonDateKey } from '@/lib/timezone';
import { InboxArrowDownIcon } from '@heroicons/react/24/outline';
import BoardColumn from './BoardColumn';
import TaskCard from '@/components/shared/TaskCard';
import TaskDetailDrawer from '@/components/shared/TaskDetailDrawer';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLUMNS = [
  { key: STATE.TODAY, title: 'Today' },
  { key: STATE.THIS_WEEK, title: 'This Week' },
  { key: STATE.BACKLOG, title: 'Backlog' },
  { key: STATE.WAITING, title: 'Waiting' },
];

const BACKLOG_PAGE_SIZE = 20;

// Custom collision detection: try sortable items first (closestCenter for
// reorder within columns), then fall back to droppable containers
// (pointerWithin for cross-column moves). This ensures that columns with no
// visible sortable items (e.g. collapsed Today sub-sections) can still receive
// drops.
function boardCollisionDetection(args) {
  // First try pointer-within — detects which droppable container the pointer is over
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;

  // Fall back to rect intersection for keyboard / touch
  return rectIntersection(args);
}

// Quick pick options for the waiting follow-up popover
const QUICK_PICKS = [
  { label: '+3 days', days: 3 },
  { label: '+1 week', days: 7 },
  { label: '+2 weeks', days: 14 },
];

// ---------------------------------------------------------------------------
// Loading skeleton for a single column
// ---------------------------------------------------------------------------

function ColumnSkeleton({ title }) {
  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-gray-50">
      <div className="flex items-center justify-between rounded-t-xl border-b border-gray-200 bg-white px-3 py-2.5">
        <div className="h-4 w-20 animate-pulse rounded bg-gray-200" />
        <div className="h-5 w-6 animate-pulse rounded-full bg-gray-200" />
      </div>
      <div className="flex-1 space-y-2 p-3">
        {[1, 2, 3].map((n) => (
          <div key={n} className="h-12 animate-pulse rounded-lg bg-gray-200" />
        ))}
      </div>
      <span className="sr-only">Loading {title} tasks…</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Waiting popover — inline form to set reason + follow-up date
// ---------------------------------------------------------------------------

function WaitingPopover({ taskId, onSave, onDismiss }) {
  const [reason, setReason] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const containerRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        onDismiss();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onDismiss]);

  function applyQuickPick(days) {
    const date = format(addDays(new Date(), days), 'yyyy-MM-dd');
    setFollowUpDate(date);
  }

  function handleSave() {
    onSave(taskId, reason.trim() || null, followUpDate || null);
  }

  return (
    <div
      ref={containerRef}
      className="mt-1 rounded-lg border border-indigo-200 bg-white p-3 shadow-md"
      role="dialog"
      aria-label="Set waiting details"
    >
      <p className="mb-2 text-xs font-semibold text-gray-700">Set waiting details (optional)</p>

      <label className="mb-1 block text-xs text-gray-500" htmlFor={`waiting-reason-${taskId}`}>
        Reason
      </label>
      <input
        id={`waiting-reason-${taskId}`}
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. Waiting for client reply"
        className="mb-2 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
      />

      <label className="mb-1 block text-xs text-gray-500" htmlFor={`waiting-followup-${taskId}`}>
        Follow-up date
      </label>
      <input
        id={`waiting-followup-${taskId}`}
        type="date"
        value={followUpDate}
        onChange={(e) => setFollowUpDate(e.target.value)}
        className="mb-2 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
      />

      {/* Quick picks */}
      <div className="mb-3 flex gap-1.5">
        {QUICK_PICKS.map(({ label, days }) => (
          <button
            key={label}
            type="button"
            onClick={() => applyQuickPick(days)}
            className="flex-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 focus:outline-none"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          Save
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PlanBoard
// ---------------------------------------------------------------------------

export default function PlanBoard() {
  // Per-column task state
  const [columns, setColumns] = useState({
    [STATE.TODAY]: [],
    [STATE.THIS_WEEK]: [],
    [STATE.BACKLOG]: [],
    [STATE.WAITING]: [],
  });

  // Loading and error state per column
  const [loadingStates, setLoadingStates] = useState({
    [STATE.TODAY]: true,
    [STATE.THIS_WEEK]: true,
    [STATE.BACKLOG]: true,
    [STATE.WAITING]: true,
  });
  const [errors, setErrors] = useState({});

  // Backlog pagination
  const [backlogOffset, setBacklogOffset] = useState(0);
  const [backlogHasMore, setBacklogHasMore] = useState(false);
  // Mirror of backlogOffset so background refetches can preserve loaded depth
  // without re-creating loadAllColumns on every page load
  const backlogOffsetRef = useRef(backlogOffset);
  backlogOffsetRef.current = backlogOffset;

  // Latest-wins guard + debounce timer for background refetches
  const loadGuardRef = useRef(createLatestGuard());
  const refetchTimerRef = useRef(null);
  // Gate silent refetches until the first load has completed, so a background
  // refetch can never supersede the in-flight initial load (R2).
  const hasLoadedRef = useRef(false);

  // Areas (derived from backlog tasks for filter)
  const [areas, setAreas] = useState([]);

  // Active drag
  const [activeDragTask, setActiveDragTask] = useState(null);

  // Waiting popover: { taskId, columnKey } or null
  const [waitingPopover, setWaitingPopover] = useState(null);

  // Task detail drawer state
  const [selectedTask, setSelectedTask] = useState(null);

  // Debounce timer for sort-order writes
  const sortDebounceRef = useRef(null);

  // Mobile tab state
  const [activeTab, setActiveTab] = useState(STATE.TODAY);

  // First-class snooze (F2): snoozed tasks stay on the board by default (visibility
  // invariant — snooze is a scheduled return, not a hiding place). This toggle lets
  // the user optionally collapse them out of the columns; they keep a badge either way.
  const [showSnoozed, setShowSnoozed] = useState(true);

  // Capture inbox (F3): count of freshly captured, not-yet-triaged tasks. Drives
  // the "N to triage" badge so untriaged captures get daytime attention.
  const [inboxCount, setInboxCount] = useState(0);

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const loadColumn = useCallback(async (stateKey, opts = {}, { silent = false } = {}) => {
    if (!silent) {
      setLoadingStates((prev) => ({ ...prev, [stateKey]: true }));
      setErrors((prev) => {
        const next = { ...prev };
        delete next[stateKey];
        return next;
      });
    }

    try {
      const tasks = await apiClient.getTasks(null, { state: stateKey, ...opts });
      // A silent refetch that succeeds should clear any stale error banner left
      // by an earlier failed load (mirrors CalendarView).
      if (silent) {
        setErrors((prev) => {
          if (!prev[stateKey]) return prev;
          const next = { ...prev };
          delete next[stateKey];
          return next;
        });
      }
      return tasks;
    } catch (err) {
      // Silent background refetch failures must not paint per-column error
      // banners over good existing data — only genuine (non-silent) loads do
      // (R6, mirrors CalendarView's !silent guard).
      if (!silent) setErrors((prev) => ({ ...prev, [stateKey]: err.message ?? 'Failed to load' }));
      return null;
    } finally {
      if (!silent) setLoadingStates((prev) => ({ ...prev, [stateKey]: false }));
    }
  }, []);

  const loadAllColumns = useCallback(async ({ silent = false } = {}) => {
    const token = loadGuardRef.current.begin();
    // Preserve the backlog pagination depth the user has scrolled to, so a refetch
    // after any mutation does not collapse the column back to the first page (FF-033).
    const backlogLimit = backlogOffsetRef.current > 0 ? backlogOffsetRef.current : BACKLOG_PAGE_SIZE;

    const [today, thisWeek, backlog, waiting] = await Promise.all([
      loadColumn(STATE.TODAY, {}, { silent }),
      loadColumn(STATE.THIS_WEEK, {}, { silent }),
      loadColumn(STATE.BACKLOG, { limit: backlogLimit, offset: 0 }, { silent }),
      loadColumn(STATE.WAITING, {}, { silent }),
    ]);

    // Ignore out-of-order responses — a newer refetch has superseded this one
    if (loadGuardRef.current.isStale(token)) return;

    setColumns({
      [STATE.TODAY]: today ?? [],
      [STATE.THIS_WEEK]: thisWeek ?? [],
      [STATE.BACKLOG]: backlog ? [...backlog].sort(compareBacklogTasks) : [],
      [STATE.WAITING]: waiting ?? [],
    });

    if (backlog) {
      setBacklogHasMore(backlog.length >= backlogLimit);
      const uniqueAreas = [
        ...new Set(backlog.filter((t) => t.area).map((t) => t.area)),
      ].sort();
      setAreas(uniqueAreas);
    }
    setBacklogOffset(backlogLimit);
  }, [loadColumn]);

  // Capture inbox (F3): derive the untriaged-capture count from the daily planning
  // inbox bucket (all inbox=true, snooze-aware). Counting the paginated backlog
  // column here would undercount once the backlog runs past the first page.
  const refreshInboxCount = useCallback(async () => {
    try {
      const candidates = await apiClient.getPlanningCandidates('daily', getLondonDateKey());
      setInboxCount(Array.isArray(candidates?.inbox) ? candidates.inbox.length : 0);
    } catch {
      // Non-critical — leave the previous count in place rather than flashing 0.
    }
  }, []);

  useEffect(() => {
    loadAllColumns().finally(() => {
      // First load done — silent background refetches may now supersede it (R2).
      hasLoadedRef.current = true;
    });
    refreshInboxCount();
  }, [loadAllColumns, refreshInboxCount]);

  // Refetch quietly when planning completes, any task mutates, or the tab regains
  // focus (cross-tab / multi-device). Bursts are debounced into a single refetch.
  useEffect(() => {
    const scheduleRefetch = () => {
      // Never let a silent background refetch supersede the very first load — a
      // superseded initial load skips its setState and can leave an empty board
      // with no spinner/error (R2).
      if (!hasLoadedRef.current) return;
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      refetchTimerRef.current = setTimeout(() => {
        loadAllColumns({ silent: true });
        // Keep the "N to triage" badge in step with captures and triage actions.
        refreshInboxCount();
      }, 200);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') scheduleRefetch();
    };
    window.addEventListener('planning-complete', scheduleRefetch);
    window.addEventListener('tasks-changed', scheduleRefetch);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      window.removeEventListener('planning-complete', scheduleRefetch);
      window.removeEventListener('tasks-changed', scheduleRefetch);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadAllColumns, refreshInboxCount]);

  // ---------------------------------------------------------------------------
  // Load more backlog
  // ---------------------------------------------------------------------------

  const handleLoadMoreBacklog = useCallback(async () => {
    setLoadingStates((prev) => ({ ...prev, [STATE.BACKLOG]: true }));
    try {
      const more = await apiClient.getTasks(null, {
        state: STATE.BACKLOG,
        limit: BACKLOG_PAGE_SIZE,
        offset: backlogOffset,
      });
      if (more) {
        setColumns((prev) => ({
          ...prev,
          [STATE.BACKLOG]: [...prev[STATE.BACKLOG], ...more].sort(compareBacklogTasks),
        }));
        setBacklogHasMore(more.length >= BACKLOG_PAGE_SIZE);
        setBacklogOffset((o) => o + BACKLOG_PAGE_SIZE);
      }
    } catch {
      // Non-critical — silently ignore
    } finally {
      setLoadingStates((prev) => ({ ...prev, [STATE.BACKLOG]: false }));
    }
  }, [backlogOffset]);

  // ---------------------------------------------------------------------------
  // Task mutations
  // ---------------------------------------------------------------------------

  const handleComplete = useCallback(async (taskId) => {
    // Find task across all columns
    let taskColumn = null;
    let task = null;
    for (const [col, tasks] of Object.entries(columns)) {
      const found = tasks.find((t) => t.id === taskId);
      if (found) {
        taskColumn = col;
        task = found;
        break;
      }
    }
    if (!task) return;

    // Completion derives from state (is_completed was dropped by the migration).
    // Completing sends state:done; un-completing restores to Today / Good to Do (FF-005).
    const wasCompleted = task.state === STATE.DONE || !!task.completed_at;
    const updates = wasCompleted
      ? { state: STATE.TODAY, today_section: TODAY_SECTION.GOOD_TO_DO }
      : { state: STATE.DONE };

    // Optimistic: remove from current column if completing
    if (!wasCompleted) {
      setColumns((prev) => ({
        ...prev,
        [taskColumn]: prev[taskColumn].filter((t) => t.id !== taskId),
      }));
    }

    try {
      await apiClient.updateTask(taskId, updates);
    } catch {
      // Revert on failure
      setColumns((prev) => ({
        ...prev,
        [taskColumn]: [...prev[taskColumn], task],
      }));
    }
  }, [columns]);

  const handleMove = useCallback(async (taskId, targetState, targetSection) => {
    // Find and remove from source column
    let sourceColumn = null;
    let task = null;
    for (const [col, tasks] of Object.entries(columns)) {
      const found = tasks.find((t) => t.id === taskId);
      if (found) {
        sourceColumn = col;
        task = found;
        break;
      }
    }
    if (!task || sourceColumn === targetState) return;

    const updates = { state: targetState };
    if (targetSection) updates.today_section = targetSection;
    if (targetState === STATE.TODAY && !targetSection) {
      updates.today_section = TODAY_SECTION.GOOD_TO_DO;
    }

    const updatedTask = { ...task, state: targetState, ...updates };

    // Optimistic update
    setColumns((prev) => ({
      ...prev,
      [sourceColumn]: prev[sourceColumn].filter((t) => t.id !== taskId),
      [targetState]: [updatedTask, ...prev[targetState]],
    }));

    if (targetState === STATE.WAITING) {
      setWaitingPopover({ taskId, columnKey: STATE.WAITING });
    }

    try {
      await apiClient.updateTask(taskId, updates);
    } catch {
      // Revert
      setColumns((prev) => ({
        ...prev,
        [sourceColumn]: [task, ...prev[sourceColumn]],
        [targetState]: prev[targetState].filter((t) => t.id !== taskId),
      }));
    }
  }, [columns]);

  const handleUpdate = useCallback(async (taskId, updates) => {
    // Optimistic update in place
    setColumns((prev) => {
      const next = { ...prev };
      for (const col of Object.keys(next)) {
        next[col] = next[col].map((t) => (t.id === taskId ? { ...t, ...updates } : t));
      }
      return next;
    });
    // Keep selected task in sync
    setSelectedTask((prev) => (prev && prev.id === taskId ? { ...prev, ...updates } : prev));
    try {
      await apiClient.updateTask(taskId, updates);
    } catch {
      // On failure, refetch to restore server truth (quietly, no skeleton flash)
      loadAllColumns({ silent: true });
    }
  }, [loadAllColumns]);

  const handleSnooze = useCallback(async (taskId, until) => {
    // Snooze is orthogonal to state (F2): the task keeps its column and just gains
    // a "Snoozed until" badge, while dropping out of planning candidates until the
    // date. Optimistically stamp snoozed_until in place; snooze_count is
    // server-managed and refreshed by the tasks-changed refetch snoozeTask fires.
    setColumns((prev) => {
      const next = { ...prev };
      for (const col of Object.keys(next)) {
        next[col] = next[col].map((t) => (t.id === taskId ? { ...t, snoozed_until: until } : t));
      }
      return next;
    });
    setSelectedTask((prev) => (prev && prev.id === taskId ? { ...prev, snoozed_until: until } : prev));
    try {
      await apiClient.snoozeTask(taskId, until);
    } catch {
      // On failure, refetch to restore server truth (quietly, no skeleton flash)
      loadAllColumns({ silent: true });
    }
  }, [loadAllColumns]);

  const handleDeleteTask = useCallback(async (taskId) => {
    // Remove from all columns
    setColumns((prev) => {
      const next = { ...prev };
      for (const col of Object.keys(next)) {
        next[col] = next[col].filter((t) => t.id !== taskId);
      }
      return next;
    });
    setSelectedTask((prev) => (prev && prev.id === taskId ? null : prev));
    try {
      await apiClient.deleteTask(taskId);
    } catch {
      loadAllColumns({ silent: true });
    }
  }, [loadAllColumns]);

  const handleDrawerUpdate = useCallback(async (taskId, updates) => {
    await handleUpdate(taskId, updates);
  }, [handleUpdate]);

  const handleClick = useCallback((taskId) => {
    // Find task across all columns
    for (const [, tasks] of Object.entries(columns)) {
      const found = tasks.find((t) => t.id === taskId);
      if (found) { setSelectedTask(found); return; }
    }
  }, [columns]);

  // ---------------------------------------------------------------------------
  // Waiting popover callbacks
  // ---------------------------------------------------------------------------

  const handleWaitingSave = useCallback(async (taskId, reason, followUpDate) => {
    setWaitingPopover(null);
    const updates = {};
    if (reason) updates.waiting_reason = reason;
    if (followUpDate) updates.follow_up_date = followUpDate;
    if (Object.keys(updates).length > 0) {
      await handleUpdate(taskId, updates);
    }
  }, [handleUpdate]);

  const handleWaitingDismiss = useCallback(() => {
    setWaitingPopover(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Drag and drop
  // ---------------------------------------------------------------------------

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function findColumnForTask(taskId) {
    for (const [col, tasks] of Object.entries(columns)) {
      if (tasks.some((t) => t.id === taskId)) return col;
    }
    return null;
  }

  function handleDragStart(event) {
    const { active } = event;
    const taskId = active.id;
    const col = findColumnForTask(taskId);
    if (!col) return;
    const task = columns[col].find((t) => t.id === taskId);
    setActiveDragTask(task ?? null);
  }

  function handleDragEnd(event) {
    const { active, over } = event;
    setActiveDragTask(null);

    if (!over) return;

    const taskId = active.id;
    const sourceColumn = findColumnForTask(taskId);
    if (!sourceColumn) return;

    // Determine target column: over.id may be a column key or a task id
    let targetColumn = COLUMNS.find((c) => c.key === over.id)?.key ?? null;
    if (!targetColumn) {
      // over.id is a task — find which column contains it
      targetColumn = findColumnForTask(over.id);
    }

    if (!targetColumn || targetColumn === sourceColumn) {
      // Same column reorder — debounced sort-order write
      if (targetColumn === sourceColumn) {
        const task = columns[sourceColumn].find((t) => t.id === taskId);
        const targetTask = columns[sourceColumn].find((t) => t.id === over.id);
        if (!task || !targetTask || task.id === targetTask.id) return;

        const currentTasks = columns[sourceColumn];
        const oldIndex = currentTasks.findIndex((t) => t.id === taskId);
        const newIndex = currentTasks.findIndex((t) => t.id === over.id);
        if (oldIndex === -1 || newIndex === -1) return;

        const reordered = [...currentTasks];
        reordered.splice(oldIndex, 1);
        reordered.splice(newIndex, 0, task);

        // Compute a new sort_order for the MOVED task only, from its new
        // neighbours, and fall back to a full reindex when the gap is too small
        // to fit a midpoint. Rewriting every row from stale neighbour values
        // corrupted the persisted order (FF-003) — this mirrors the proven
        // TodayView pattern.
        const above = reordered[newIndex - 1]?.sort_order ?? null;
        const below = reordered[newIndex + 1]?.sort_order ?? null;

        let updatedItems;
        let sortPayload;
        if (needsReindex(above, below)) {
          updatedItems = reindex(reordered);
          // Every row got a fresh value, so all of them must be persisted.
          sortPayload = updatedItems.map((t) => ({ id: t.id, sort_order: t.sort_order }));
        } else {
          const newOrder = computeSortOrder(above, below);
          updatedItems = reordered.map((t, i) =>
            i === newIndex ? { ...t, sort_order: newOrder } : t
          );
          // Only the moved task changed; its neighbours keep their values, so
          // send just the one row. Sending the whole (possibly 60+ item) column
          // tripped updateSortOrder's 50-item cap and reverted every reorder (R4).
          sortPayload = [{ id: task.id, sort_order: newOrder }];
        }

        // Optimistic update with the corrected sort_order values
        setColumns((prev) => ({ ...prev, [sourceColumn]: updatedItems }));

        // Debounced write, chunked to stay within updateSortOrder's 50-item cap
        // (the reindex path can exceed it once the column is large).
        if (sortDebounceRef.current) clearTimeout(sortDebounceRef.current);
        sortDebounceRef.current = setTimeout(() => {
          const SORT_BATCH_SIZE = 50;
          const batches = [];
          for (let i = 0; i < sortPayload.length; i += SORT_BATCH_SIZE) {
            batches.push(sortPayload.slice(i, i + SORT_BATCH_SIZE));
          }
          Promise.all(batches.map((batch) => apiClient.updateSortOrder(batch)))
            .catch((err) => {
              // Reconcile with server truth so a failed write does not leave the
              // board showing an order that was never persisted, and tell the
              // user the reorder did not save (FF-003).
              loadAllColumns({ silent: true });
              alert(`Failed to save order: ${err.message}`);
            });
        }, 300);
      }
      return;
    }

    // Cross-column move
    handleMove(taskId, targetColumn,
      targetColumn === STATE.TODAY ? TODAY_SECTION.GOOD_TO_DO : undefined
    );
  }

  // ---------------------------------------------------------------------------
  // Error retry
  // ---------------------------------------------------------------------------

  const hasAnyError = Object.keys(errors).length > 0;

  // Snooze visibility (F2): a task is actively snoozed while its snoozed_until is
  // still in the future (London calendar). Snoozed tasks stay on the board by
  // default; the toolbar toggle can collapse them, and the count drives the toggle.
  const todayKey = getLondonDateKey();
  const isTaskSnoozed = (t) => !!t.snoozed_until && t.snoozed_until > todayKey;
  const snoozedCount = Object.values(columns).reduce(
    (n, list) => n + list.filter(isTaskSnoozed).length,
    0
  );

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function renderColumn(colKey) {
    const col = COLUMNS.find((c) => c.key === colKey);
    const tasks = showSnoozed
      ? columns[colKey]
      : columns[colKey].filter((t) => !isTaskSnoozed(t));
    const isLoading = loadingStates[colKey];
    const error = errors[colKey];
    const count = tasks.length;

    const warning =
      colKey === STATE.THIS_WEEK ? count > SOFT_CAPS.THIS_WEEK : false;

    if (isLoading && tasks.length === 0) {
      return <ColumnSkeleton key={colKey} title={col.title} />;
    }

    return (
      <div key={colKey} className="flex flex-col">
        {error && (
          <div className="mb-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">
            {error}{' '}
            <button
              type="button"
              onClick={() => loadAllColumns()}
              className="ml-1 underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        )}
        <BoardColumn
          title={col.title}
          stateKey={colKey}
          tasks={tasks}
          count={count}
          warning={warning}
          onComplete={handleComplete}
          onMove={handleMove}
          onUpdate={handleUpdate}
          onClick={handleClick}
          onDelete={handleDeleteTask}
          onSnooze={handleSnooze}
          areas={colKey === STATE.BACKLOG ? areas : []}
          onLoadMore={colKey === STATE.BACKLOG ? handleLoadMoreBacklog : undefined}
          hasMore={colKey === STATE.BACKLOG ? backlogHasMore : false}
        />

        {/* Waiting popover */}
        {colKey === STATE.WAITING && waitingPopover && (
          <WaitingPopover
            taskId={waitingPopover.taskId}
            onSave={handleWaitingSave}
            onDismiss={handleWaitingDismiss}
          />
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={boardCollisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {/* Error banner */}
      {hasAnyError && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          <span>Some columns failed to load.</span>
          <button
            type="button"
            onClick={() => loadAllColumns()}
            className="ml-4 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            Retry all
          </button>
        </div>
      )}

      {/* Capture inbox (F3): daytime triage nudge — only shown when captures await */}
      {inboxCount > 0 && (
        <div className="mb-3 flex items-center">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
            <InboxArrowDownIcon className="h-4 w-4" aria-hidden="true" />
            {inboxCount} to triage
          </span>
        </div>
      )}

      {/* Snooze visibility toggle (F2): only shown when something is snoozed */}
      {snoozedCount > 0 && (
        <div className="mb-3 flex items-center justify-end">
          <button
            type="button"
            onClick={() => setShowSnoozed((v) => !v)}
            aria-pressed={showSnoozed}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {showSnoozed ? 'Hide' : 'Show'} snoozed ({snoozedCount})
          </button>
        </div>
      )}

      {/* Desktop: 4-column grid */}
      <div className="hidden md:grid md:grid-cols-4 md:gap-4" style={{ minHeight: 'calc(100vh - 8rem)' }}>
        {COLUMNS.map((col) => renderColumn(col.key))}
      </div>

      {/* Mobile: tab switcher */}
      <div className="md:hidden">
        {/* Tab headers */}
        <div className="mb-3 flex overflow-x-auto border-b border-gray-200">
          {COLUMNS.map((col) => {
            const count = (showSnoozed
              ? columns[col.key]
              : columns[col.key].filter((t) => !isTaskSnoozed(t))).length;
            const isActive = activeTab === col.key;
            return (
              <button
                key={col.key}
                type="button"
                onClick={() => setActiveTab(col.key)}
                className={[
                  'shrink-0 px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors',
                  isActive
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700',
                ].join(' ')}
                aria-selected={isActive}
                role="tab"
              >
                {col.title}
                <span
                  className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs ${
                    isActive ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Active tab content */}
        <div>{renderColumn(activeTab)}</div>
      </div>

      {/* DragOverlay: ghost card while dragging */}
      <DragOverlay>
        {activeDragTask ? (
          <TaskCard
            task={activeDragTask}
            isDragging
            onComplete={() => {}}
            onMove={() => {}}
            onUpdate={() => {}}
            onClick={() => {}}
          />
        ) : null}
      </DragOverlay>

      {/* Task detail drawer */}
      <TaskDetailDrawer
        task={selectedTask}
        isOpen={!!selectedTask}
        onClose={() => setSelectedTask(null)}
        onUpdate={handleDrawerUpdate}
        onDelete={handleDeleteTask}
      />
    </DndContext>
  );
}
