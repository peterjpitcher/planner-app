'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
} from '@dnd-kit/core';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { addMonths, format, startOfMonth, isBefore, isAfter, isSameMonth } from 'date-fns';

import { apiClient } from '@/lib/apiClient';
import { cn } from '@/lib/utils';

import CalendarGrid from './CalendarGrid';
import CalendarSidebar from './CalendarSidebar';
import CalendarTaskPill from './CalendarTaskPill';
import MonthStrip from './MonthStrip';
import EdgeNavigator from './EdgeNavigator';

export default function CalendarView() {
  const now = useMemo(() => new Date(), []);
  const minMonth = useMemo(() => startOfMonth(now), [now]);
  const maxMonth = useMemo(() => startOfMonth(addMonths(now, 11)), [now]);
  const todayStr = useMemo(() => format(now, 'yyyy-MM-dd'), [now]);

  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(now));
  const [tasks, setTasks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeDragTask, setActiveDragTask] = useState(null);

  // DnD sensor
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Fetch tasks
  useEffect(() => {
    let cancelled = false;
    async function fetchTasks() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await apiClient.getAllTasks(null, {
          states: 'today,this_week,backlog,waiting',
        });
        if (!cancelled) setTasks(data);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load tasks');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    fetchTasks();
    return () => { cancelled = true; };
  }, []);

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
      // Revert on error
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, due_date: task.due_date } : t))
      );
      console.error('Failed to update task due date:', err);
    }
  }, [tasks]);

  const handleDragCancel = useCallback(() => {
    setActiveDragTask(null);
  }, []);

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
      console.error('Failed to move task:', err);
      setTasks(previousTasks);
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
      console.error('Failed to complete task:', err);
      setTasks(previousTasks);
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
            <CalendarGrid currentMonth={currentMonth} tasks={tasks} onMoveTask={handleMoveTask} onCompleteTask={handleCompleteTask} />
          </div>

          {/* Desktop sidebar */}
          <div className="hidden lg:block w-72 border-l border-gray-200 overflow-y-auto p-3">
            <CalendarSidebar tasks={tasks} today={todayStr} onMoveTask={handleMoveTask} onCompleteTask={handleCompleteTask} />
          </div>
        </div>

        {/* Mobile sidebar (below calendar) */}
        <div className="lg:hidden border-t border-gray-200 p-3 max-h-48 overflow-y-auto">
          <CalendarSidebar tasks={tasks} today={todayStr} onMoveTask={handleMoveTask} onCompleteTask={handleCompleteTask} />
        </div>
      </div>

      {/* Drag overlay */}
      <DragOverlay dropAnimation={null}>
        {activeDragTask ? (
          <CalendarTaskPill task={activeDragTask} isDragOverlay />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
