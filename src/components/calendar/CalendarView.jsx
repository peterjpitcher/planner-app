'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
} from '@dnd-kit/core';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { addMonths, format, startOfMonth, isBefore, isAfter, isSameMonth, parseISO } from 'date-fns';

import { apiClient } from '@/lib/apiClient';
import { createLatestGuard } from '@/lib/requestCache';
import { getLondonDateKey } from '@/lib/timezone';
import { cn } from '@/lib/utils';

import CalendarGrid from './CalendarGrid';
import CalendarSidebar from './CalendarSidebar';
import CalendarTaskPill from './CalendarTaskPill';
import MonthStrip from './MonthStrip';
import EdgeNavigator from './EdgeNavigator';
import TaskDetailDrawer from '@/components/shared/TaskDetailDrawer';

export default function CalendarView() {
  // "Today" as a London date key, held in state so the today highlight, overdue
  // list and month bounds refresh when the tab is left open across London
  // midnight instead of freezing at mount (FF-037).
  const [todayStr, setTodayStr] = useState(() => getLondonDateKey());

  useEffect(() => {
    const refresh = () => setTodayStr(getLondonDateKey());
    const interval = setInterval(refresh, 60 * 1000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const now = useMemo(() => parseISO(todayStr), [todayStr]);
  const minMonth = useMemo(() => startOfMonth(now), [now]);
  const maxMonth = useMemo(() => startOfMonth(addMonths(now, 11)), [now]);

  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(parseISO(getLondonDateKey())));
  const [tasks, setTasks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeDragTask, setActiveDragTask] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);

  // Latest-wins guard + debounce timer for background refetches
  const loadGuardRef = useRef(createLatestGuard());
  const refetchTimerRef = useRef(null);
  // Gate silent refetches until the first load has completed, so a background
  // refetch can never supersede the in-flight initial load (R2).
  const hasLoadedRef = useRef(false);

  // DnD sensor
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Fetch tasks. Silent refetches revalidate in the background without swapping
  // the calendar for a spinner or blanking it on transient failure.
  const fetchTasks = useCallback(async ({ silent = false } = {}) => {
    const token = loadGuardRef.current.begin();
    if (!silent) {
      setIsLoading(true);
      setError(null);
    }
    try {
      const data = await apiClient.getAllTasks(null, {
        states: 'today,this_week,backlog,waiting',
      });
      // Ignore out-of-order responses — a newer refetch has superseded this one
      if (loadGuardRef.current.isStale(token)) return;
      setTasks(data);
      if (silent) setError(null);
    } catch (err) {
      if (loadGuardRef.current.isStale(token)) return;
      if (!silent) setError(err.message || 'Failed to load tasks');
    } finally {
      if (!silent) setIsLoading(false);
      hasLoadedRef.current = true;
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Refetch quietly when planning completes, any task mutates, or the tab regains
  // focus (cross-tab / multi-device). Bursts are debounced into a single refetch.
  useEffect(() => {
    const scheduleRefetch = () => {
      // Never let a silent background refetch supersede the very first load — a
      // superseded initial load skips its setState and can leave an empty view
      // with no spinner/error (R2).
      if (!hasLoadedRef.current) return;
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      refetchTimerRef.current = setTimeout(() => { fetchTasks({ silent: true }); }, 200);
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
  }, [fetchTasks]);

  // Month navigation
  const navigateMonth = useCallback((target) => {
    const month = startOfMonth(target);
    if (isBefore(month, minMonth)) return;
    if (isAfter(month, maxMonth)) return;
    setCurrentMonth(month);
  }, [minMonth, maxMonth]);

  const goToPrev = useCallback(() => {
    navigateMonth(addMonths(currentMonth, -1));
  }, [currentMonth, navigateMonth]);

  const goToNext = useCallback(() => {
    navigateMonth(addMonths(currentMonth, 1));
  }, [currentMonth, navigateMonth]);

  // DnD handlers
  const handleDragStart = useCallback((event) => {
    const task = event.active.data?.current?.task;
    if (task) setActiveDragTask(task);
  }, []);

  const handleDragEnd = useCallback(async (event) => {
    setActiveDragTask(null);
    const { active, over } = event;
    if (!over) return;

    const overId = over.id;
    if (typeof overId !== 'string' || !overId.startsWith('day-')) return;

    const newDueDate = overId.replace('day-', '');
    const taskId = active.id;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    // Same date - no-op
    const currentDue = task.due_date ? (typeof task.due_date === 'string' ? task.due_date.slice(0, 10) : format(task.due_date, 'yyyy-MM-dd')) : null;
    if (currentDue === newDueDate) return;

    // Optimistic update
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, due_date: newDueDate } : t))
    );

    try {
      await apiClient.updateTask(taskId, { due_date: newDueDate });
    } catch (err) {
      // Revert on error and tell the user the reschedule did not save (FF-046)
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, due_date: task.due_date } : t))
      );
      alert(`Failed to update task due date: ${err.message}`);
    }
  }, [tasks]);

  const handleDragCancel = useCallback(() => {
    setActiveDragTask(null);
  }, []);

  // Task click: open detail drawer
  const handleClick = useCallback((taskId) => {
    const found = tasks.find((t) => t.id === taskId);
    if (found) setSelectedTask(found);
  }, [tasks]);

  // Drawer: update task field(s)
  const handleDrawerUpdate = useCallback(async (taskId, updates) => {
    const previousTasks = tasks;
    // Optimistic update
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, ...updates } : t))
    );
    setSelectedTask((prev) =>
      prev && prev.id === taskId ? { ...prev, ...updates } : prev
    );

    try {
      await apiClient.updateTask(taskId, updates);
    } catch (err) {
      // Revert and surface the failure so the edit is not silently lost (FF-046)
      setTasks(previousTasks);
      setSelectedTask((prev) =>
        prev && prev.id === taskId
          ? previousTasks.find((t) => t.id === taskId) ?? prev
          : prev
      );
      alert(`Failed to update task: ${err.message}`);
    }
  }, [tasks]);

  // Drawer: delete task
  const handleDeleteTask = useCallback(async (taskId) => {
    const previousTasks = tasks;
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setSelectedTask(null);

    try {
      await apiClient.deleteTask(taskId);
    } catch (err) {
      // Revert and surface the failure so the delete is not silently lost (FF-046)
      setTasks(previousTasks);
      alert(`Failed to delete task: ${err.message}`);
    }
  }, [tasks]);

  // Context menu: move task to a different state
  const handleMoveTask = useCallback(async (taskId, targetState, targetSection) => {
    const updates = { state: targetState };
    if (targetSection) updates.today_section = targetSection;

    const previousTasks = tasks;
    // Calendar shows today/this_week/backlog/waiting — update in place for those,
    // only remove if moving to a state not shown (e.g. done)
    const calendarStates = new Set(['today', 'this_week', 'backlog', 'waiting']);
    if (calendarStates.has(targetState)) {
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, state: targetState, today_section: targetSection || null } : t))
      );
    } else {
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    }

    try {
      await apiClient.updateTask(taskId, updates);
    } catch (err) {
      // Revert and surface the failure so the move is not silently lost (FF-046)
      setTasks(previousTasks);
      alert(`Failed to move task: ${err.message}`);
    }
  }, [tasks]);

  // Context menu: mark task complete
  const handleCompleteTask = useCallback(async (taskId) => {
    // Optimistic: remove from calendar (done tasks aren't shown)
    const previousTasks = tasks;
    setTasks((prev) => prev.filter((t) => t.id !== taskId));

    try {
      await apiClient.updateTask(taskId, { state: 'done' });
    } catch (err) {
      // Revert and surface the failure so the completion is not silently lost (FF-046)
      setTasks(previousTasks);
      alert(`Failed to complete task: ${err.message}`);
    }
  }, [tasks]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-sm text-red-600">{error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-sm text-indigo-600 hover:text-indigo-800 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const canGoPrev = isAfter(startOfMonth(currentMonth), minMonth);
  const canGoNext = isBefore(startOfMonth(currentMonth), maxMonth);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex flex-col h-full">
        {/* Header: month name + prev/next arrows */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <button
            type="button"
            onClick={goToPrev}
            disabled={!canGoPrev}
            className={cn(
              'rounded-md p-1.5 transition-colors',
              canGoPrev
                ? 'text-gray-600 hover:bg-gray-100'
                : 'text-gray-300 cursor-not-allowed'
            )}
            aria-label="Previous month"
          >
            <ChevronLeftIcon className="h-5 w-5" />
          </button>

          <h2 className="text-lg font-semibold text-gray-800">
            {format(currentMonth, 'MMMM yyyy')}
          </h2>

          <button
            type="button"
            onClick={goToNext}
            disabled={!canGoNext}
            className={cn(
              'rounded-md p-1.5 transition-colors',
              canGoNext
                ? 'text-gray-600 hover:bg-gray-100'
                : 'text-gray-300 cursor-not-allowed'
            )}
            aria-label="Next month"
          >
            <ChevronRightIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Month strip */}
        <MonthStrip
          currentMonth={currentMonth}
          onNavigate={navigateMonth}
          onDragHover={navigateMonth}
        />

        {/* Main area: grid + sidebar */}
        <div className="relative flex flex-1 overflow-hidden">
          {/* Edge navigators (visible only during drag) */}
          <EdgeNavigator
            currentMonth={currentMonth}
            minMonth={minMonth}
            maxMonth={maxMonth}
            onNavigate={navigateMonth}
          />

          {/* Calendar grid */}
          <div className="flex-1 overflow-auto">
            <CalendarGrid currentMonth={currentMonth} tasks={tasks} todayStr={todayStr} onMoveTask={handleMoveTask} onCompleteTask={handleCompleteTask} onTaskClick={handleClick} />
          </div>

          {/* Desktop sidebar */}
          <div className="hidden lg:block w-72 border-l border-gray-200 overflow-y-auto p-3">
            <CalendarSidebar tasks={tasks} today={todayStr} onMoveTask={handleMoveTask} onCompleteTask={handleCompleteTask} onTaskClick={handleClick} />
          </div>
        </div>

        {/* Mobile sidebar (below calendar) */}
        <div className="lg:hidden border-t border-gray-200 p-3 max-h-48 overflow-y-auto">
          <CalendarSidebar tasks={tasks} today={todayStr} onMoveTask={handleMoveTask} onCompleteTask={handleCompleteTask} onTaskClick={handleClick} />
        </div>
      </div>

      {/* Drag overlay */}
      <DragOverlay dropAnimation={null}>
        {activeDragTask ? (
          <CalendarTaskPill task={activeDragTask} isDragOverlay />
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
