'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { format, parseISO } from 'date-fns';
import { apiClient } from '@/lib/apiClient';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useTargetProject } from '@/contexts/TargetProjectContext';
import { TaskScoreBadge } from '@/components/Tasks/TaskScoreBadge';
import { compareTasksByWorkPriority, DEFAULT_TASK_SCORING } from '@/lib/taskScoring';
import { compareTasksByDueDateAsc } from '@/lib/taskSort';

const ALL_JOBS = 'All Jobs';
const NO_JOB = 'No Job';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const normalizeJob = (value) => (typeof value === 'string' ? value.trim() : '');
const isUnassignedProjectName = (name) => typeof name === 'string' && name.trim().toLowerCase() === 'unassigned';

function effectiveJob(task) {
  const projectName = task?.project_name || task?.projects?.name;
  if (isUnassignedProjectName(projectName)) {
    return normalizeJob(task?.job);
  }
  return normalizeJob(task?.project_job || task?.projects?.job);
}

function TaskNote({ task, isDragging, isCompleting, onDragStart, onCompleteTask, overridePosition, onNavigateToProject }) {
  const importance = overridePosition?.importance ?? task?.importance_score;
  const urgency = overridePosition?.urgency ?? task?.urgency_score;

  const position = useMemo(() => {
    const x = typeof importance === 'number' ? clamp(importance, 0, 100) : 50;
    const y = typeof urgency === 'number' ? clamp(urgency, 0, 100) : 50;
    return {
      leftPercent: x,
      topPercent: 100 - y,
    };
  }, [importance, urgency]);

  const dueDateLabel = task?.due_date ? format(parseISO(task.due_date), 'MMM d') : 'No due date';
  const jobLabel = effectiveJob(task);

  return (
    <div
      className={[
        'absolute w-56 select-none touch-none rounded-xl border border-border bg-[hsl(54_100%_92%)] text-[hsl(35_60%_18%)] shadow-sm cursor-grab active:cursor-grabbing',
        'transition-shadow',
        isDragging ? 'z-50 shadow-lg ring-2 ring-primary/40' : 'z-10 hover:shadow-md',
      ].join(' ')}
      style={{
        left: `${position.leftPercent}%`,
        top: `${position.topPercent}%`,
        transform: 'translate(-50%, -50%)',
      }}
      data-task-id={task?.id}
      onPointerDown={(event) => {
        if (event.button === 2) return;
        const interactive = event.target?.closest?.('button, a, input, textarea, select');
        if (interactive) return;
        onDragStart?.(event, task);
      }}
      onContextMenu={(event) => {
        const interactive = event.target?.closest?.('button, a, input, textarea, select');
        if (interactive) return;
        event.preventDefault();
        task?.id && onCompleteTask?.(task.id);
      }}
      aria-label="Drag task"
    >
      <div
        className="flex items-center justify-between rounded-t-xl border-b border-[hsl(35_60%_18%/0.12)] bg-[hsl(54_100%_88%)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider"
      >
        <div className="flex min-w-0 items-center gap-2">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 cursor-pointer rounded border-[hsl(35_60%_18%/0.25)] bg-white/70 text-primary focus:ring-1 focus:ring-primary/40"
            checked={Boolean(task?.is_completed) || Boolean(isCompleting)}
            disabled={isCompleting}
            onChange={() => task?.id && onCompleteTask?.(task.id)}
            aria-label="Mark task complete"
            title="Mark complete"
          />
          <TaskScoreBadge
            task={task}
            className="max-w-[7rem] truncate border-[hsl(35_60%_18%/0.12)] bg-[hsl(54_100%_88%)] text-[hsl(35_60%_18%)]"
          />
        </div>
        <span className="opacity-70">{dueDateLabel}</span>
      </div>
      <div className="px-3 py-2">
        <p className="text-sm font-semibold leading-snug break-words">{task?.name || 'Untitled task'}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <button
            type="button"
            onClick={() => onNavigateToProject?.(task?.project_id)}
            className="text-[hsl(202_85%_32%)] hover:underline"
            title="Jump to project on dashboard"
          >
            {task?.project_name || 'Project'}
          </button>
          {jobLabel ? (
            <span className="rounded-full bg-[hsl(202_85%_32%/0.1)] px-2 py-0.5 text-[hsl(202_85%_28%)]">
              {jobLabel}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function PrioritisePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { setTargetProjectId } = useTargetProject();

  const boardRef = useRef(null);
  const dragStateRef = useRef(null);

  const [tasks, setTasks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedJob, setSelectedJob] = useState(ALL_JOBS);
  const [searchTerm, setSearchTerm] = useState('');

  const [placingTaskIds, setPlacingTaskIds] = useState(() => new Set());
  const [savingTaskIds, setSavingTaskIds] = useState(() => new Set());
  const [completingTaskIds, setCompletingTaskIds] = useState(() => new Set());
  const [dragState, setDragState] = useState(null);
  const [saveError, setSaveError] = useState(null);

  const fetchAllTasks = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setSaveError(null);
    try {
      const limit = 200;
      let offset = 0;
      const collected = [];
      while (true) {
        // Fetch all open tasks in pages (API max limit is 200).
        // Stop when the API returns fewer than `limit` results.
        const page = await apiClient.getTasks(null, false, { limit, offset });
        collected.push(...(page || []));
        if (!page || page.length < limit) break;
        offset += limit;
      }
      setTasks(collected);
    } catch (err) {
      setError(err?.message || 'Failed to load tasks.');
      setTasks([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  useEffect(() => {
    if (status === 'authenticated') fetchAllTasks();
  }, [status, fetchAllTasks]);

  const availableJobs = useMemo(() => {
    const values = new Set();
    tasks.forEach((task) => {
      const job = effectiveJob(task);
      if (job) values.add(job);
    });
    return Array.from(values).sort();
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return tasks.filter((task) => {
      const job = effectiveJob(task);
      const matchesJob = selectedJob === ALL_JOBS
        ? true
        : selectedJob === NO_JOB
          ? !job
          : job === selectedJob;
      if (!matchesJob) return false;

      if (!normalizedSearch) return true;
      const haystack = `${task?.name || ''} ${task?.project_name || ''} ${job || ''}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [tasks, selectedJob, searchTerm]);

  const scoredTasks = useMemo(
    () => filteredTasks.filter((task) => typeof task?.importance_score === 'number' && typeof task?.urgency_score === 'number'),
    [filteredTasks]
  );

  const unscoredTasks = useMemo(
    () => filteredTasks.filter((task) => !(typeof task?.importance_score === 'number' && typeof task?.urgency_score === 'number')),
    [filteredTasks]
  );

  const topPriorities = useMemo(() => {
    return [...filteredTasks]
      .sort((a, b) => compareTasksByWorkPriority(a, b, DEFAULT_TASK_SCORING))
      .slice(0, 12)
      .sort(compareTasksByDueDateAsc);
  }, [filteredTasks]);

  const handleNavigateToProject = useCallback((projectId) => {
    if (!projectId) return;
    setTargetProjectId(projectId);
    router.push('/dashboard');
  }, [router, setTargetProjectId]);

  const handlePlaceTask = useCallback(async (taskId) => {
    if (!taskId) return;
    setSaveError(null);
    setPlacingTaskIds((prev) => new Set(prev).add(taskId));
    try {
      setTasks((prev) => prev.map((task) => (
        task.id === taskId ? { ...task, importance_score: 50, urgency_score: 50 } : task
      )));
      const updated = await apiClient.updateTask(taskId, {
        importance_score: 50,
        urgency_score: 50,
      });
      setTasks((prev) => prev.map((task) => (task.id === taskId ? { ...task, ...updated } : task)));
    } catch (err) {
      setTasks((prev) => prev.map((task) => (
        task.id === taskId ? { ...task, importance_score: null, urgency_score: null } : task
      )));
      setSaveError(err?.message || 'Failed to place task.');
    } finally {
      setPlacingTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  }, []);

  const handleCompleteTask = useCallback(async (taskId) => {
    if (!taskId) return;
    if (completingTaskIds.has(taskId)) return;
    setSaveError(null);
    setCompletingTaskIds((prev) => new Set(prev).add(taskId));

    try {
      await apiClient.updateTask(taskId, {
        is_completed: true,
        updated_at: new Date().toISOString(),
      });
      setTasks((prev) => prev.filter((task) => task.id !== taskId));
    } catch (err) {
      setSaveError(err?.message || 'Failed to mark task complete.');
    } finally {
      setCompletingTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  }, [completingTaskIds]);

  const handleDragStart = useCallback((event, task) => {
    if (!task?.id || !boardRef.current) return;
    if (completingTaskIds.has(task.id)) return;
    event.preventDefault();
    event.stopPropagation();

    setSaveError(null);
    const pointerId = event.pointerId;

    const previousImportance = typeof task.importance_score === 'number' ? task.importance_score : null;
    const previousUrgency = typeof task.urgency_score === 'number' ? task.urgency_score : null;
    const startImportance = previousImportance ?? 50;
    const startUrgency = previousUrgency ?? 50;
    const wasUnscored = !(typeof task.importance_score === 'number' && typeof task.urgency_score === 'number');

    const rect = boardRef.current.getBoundingClientRect();
    const isOverBoard = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;

    setDragState({
      taskId: task.id,
      pointerId,
      importance: startImportance,
      urgency: startUrgency,
      clientX: event.clientX,
      clientY: event.clientY,
      startClientX: event.clientX,
      startClientY: event.clientY,
      hasMoved: false,
      isOverBoard,
      wasEverOverBoard: isOverBoard,
      previous: { importance: previousImportance, urgency: previousUrgency },
      wasUnscored,
    });
  }, [completingTaskIds]);

  const handleDragMove = useCallback((event) => {
    setDragState((prev) => {
      if (!prev?.taskId || prev.pointerId !== event.pointerId) return prev;

      const deltaX = event.clientX - (prev.startClientX ?? event.clientX);
      const deltaY = event.clientY - (prev.startClientY ?? event.clientY);
      const hasMoved = prev.hasMoved || Math.hypot(deltaX, deltaY) >= 8;

      const nextBase = {
        ...prev,
        clientX: event.clientX,
        clientY: event.clientY,
        hasMoved,
      };

      if (!boardRef.current) return nextBase;
      const rect = boardRef.current.getBoundingClientRect();
      if (!rect.width || !rect.height) return nextBase;

      const isOverBoard = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;

      const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
      const importance = Math.round(x * 100);
      const urgency = Math.round((1 - y) * 100);

      return {
        ...nextBase,
        importance,
        urgency,
        isOverBoard,
        wasEverOverBoard: prev.wasEverOverBoard || isOverBoard,
      };
    });
  }, []);

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  const persistDragPosition = useCallback(async (snapshot) => {
    if (!snapshot?.taskId) return;
    setDragState(null);

    setSavingTaskIds((prev) => new Set(prev).add(snapshot.taskId));
    setTasks((prev) => prev.map((task) => (
      task.id === snapshot.taskId
        ? { ...task, importance_score: snapshot.importance, urgency_score: snapshot.urgency }
        : task
    )));

    try {
      const updated = await apiClient.updateTask(snapshot.taskId, {
        importance_score: snapshot.importance,
        urgency_score: snapshot.urgency,
      });
      setTasks((prev) => prev.map((task) => (task.id === snapshot.taskId ? { ...task, ...updated } : task)));
    } catch (err) {
      setTasks((prev) => prev.map((task) => (
        task.id === snapshot.taskId
          ? { ...task, importance_score: snapshot.previous.importance, urgency_score: snapshot.previous.urgency }
          : task
      )));
      setSaveError(err?.message || 'Failed to save position.');
    } finally {
      setSavingTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(snapshot.taskId);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    if (!dragState?.taskId) return;

    const handleMove = (event) => {
      const current = dragStateRef.current;
      if (!current?.taskId || current.pointerId !== event.pointerId) return;
      handleDragMove(event);
    };

    const handleUp = (event) => {
      const current = dragStateRef.current;
      if (!current?.taskId || current.pointerId !== event.pointerId) return;
      if (!current.hasMoved) {
        setDragState(null);
        return;
      }
      if (current.wasUnscored && !current.wasEverOverBoard) {
        setDragState(null);
        return;
      }
      persistDragPosition(current);
    };

    window.addEventListener('pointermove', handleMove, { passive: true });
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [dragState?.taskId, handleDragMove, persistDragPosition]);

  const draggingTask = useMemo(() => {
    if (!dragState?.taskId) return null;
    return tasks.find((task) => task.id === dragState.taskId) || null;
  }, [dragState?.taskId, tasks]);

  const dragPreview = useMemo(() => {
    if (!dragState?.wasUnscored || !draggingTask) return null;
    if (!Number.isFinite(dragState.clientX) || !Number.isFinite(dragState.clientY)) return null;
    return {
      task: draggingTask,
      clientX: dragState.clientX,
      clientY: dragState.clientY,
    };
  }, [dragState?.clientX, dragState?.clientY, dragState?.wasUnscored, draggingTask]);

  if (status === 'loading' || (status === 'authenticated' && !session?.user)) {
    return <div className="p-8">Loading...</div>;
  }
  if (status === 'unauthenticated') return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Prioritise</h1>
          <p className="text-muted-foreground mt-1">
            Drag tasks onto the urgency/importance grid. Due dates influence the ranking list.
          </p>
        </div>
        <Button onClick={fetchAllTasks} variant="outline" isLoading={isLoading}>
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <Card className="p-4">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label htmlFor="job-filter" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Job
              </label>
              <select
                id="job-filter"
                value={selectedJob}
                onChange={(e) => setSelectedJob(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-56"
              >
                <option value={ALL_JOBS}>All jobs</option>
                <option value={NO_JOB}>No job</option>
                {availableJobs.map((job) => (
                  <option key={job} value={job}>{job}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label htmlFor="search" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Search
              </label>
              <input
                id="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-56"
                placeholder="Task, project, job…"
              />
            </div>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {saveError && (
            <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {saveError}
            </div>
          )}

          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading tasks…</div>
          ) : filteredTasks.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No tasks to show.</div>
          ) : (
            <div
              ref={boardRef}
              className={`relative h-[70vh] w-full overflow-hidden rounded-xl border border-border bg-background touch-none ${
                dragState?.taskId ? (dragState.isOverBoard ? 'ring-2 ring-primary/40' : 'ring-2 ring-primary/20') : ''
              }`}
            >
              {/* Grid lines */}
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute left-1/2 top-0 h-full w-px bg-border/60" />
                <div className="absolute top-1/2 left-0 h-px w-full bg-border/60" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,hsl(var(--border)_/_0.35)_1px,transparent_0)] [background-size:22px_22px]" />
              </div>

              {/* Axis labels */}
              <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between text-xs font-semibold text-muted-foreground">
                <span>Urgent ↑</span>
                <span>Important →</span>
              </div>
              <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-end justify-between text-[11px] text-muted-foreground">
                <span>Low urgency</span>
                <span>High urgency</span>
              </div>
              <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                Low importance
              </div>
              <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground text-right">
                High importance
              </div>

              {scoredTasks.map((task) => (
                <TaskNote
                  key={task.id}
                  task={task}
                  isDragging={dragState?.taskId === task.id || savingTaskIds.has(task.id)}
                  isCompleting={completingTaskIds.has(task.id)}
                  onDragStart={handleDragStart}
                  overridePosition={dragState?.taskId === task.id ? { importance: dragState.importance, urgency: dragState.urgency } : null}
                  onNavigateToProject={handleNavigateToProject}
                  onCompleteTask={handleCompleteTask}
                />
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Unplaced tasks</h2>
              <span className="text-xs text-muted-foreground">{unscoredTasks.length}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Drag a task onto the grid (or click Place) to set urgency/importance.
            </p>
            <div className="mt-3 max-h-[40vh] space-y-2 overflow-auto pr-1">
              {unscoredTasks.map((task) => {
                const placing = placingTaskIds.has(task.id);
                const completing = completingTaskIds.has(task.id);
                return (
                  <div
                    key={task.id}
                    className="rounded-lg border border-border bg-card p-3 cursor-grab active:cursor-grabbing"
                    onPointerDown={(event) => {
                      if (event.button === 2) return;
                      const interactive = event.target?.closest?.('button, a, input, textarea, select');
                      if (interactive) return;
                      handleDragStart(event, task);
                    }}
                    onContextMenu={(event) => {
                      const interactive = event.target?.closest?.('button, a, input, textarea, select');
                      if (interactive) return;
                      event.preventDefault();
                      task?.id && handleCompleteTask(task.id);
                    }}
                    aria-label="Drag task onto grid"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{task?.name || 'Untitled task'}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{task?.project_name || 'Project'}</p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={Boolean(task?.is_completed) || completing}
                            disabled={placing || completing}
                            onChange={() => task?.id && handleCompleteTask(task.id)}
                            aria-label="Mark task complete"
                            title="Mark complete"
                          />
                          Done
                        </label>
                        <span className="text-xs text-muted-foreground">Drag</span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="mt-3 w-full"
                      variant="outline"
                      isLoading={placing}
                      disabled={placing || completing}
                      onClick={() => handlePlaceTask(task.id)}
                    >
                      Set to Medium
                    </Button>
                  </div>
                );
              })}
              {unscoredTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">Everything is placed.</p>
              ) : null}
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-foreground">Top priorities</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Priority is shown as simple labels: High, Medium, or Low.
            </p>
            <div className="mt-3 max-h-[42vh] space-y-2 overflow-auto pr-1">
              {topPriorities.map((task) => {
                const dueLabel = task?.due_date ? format(parseISO(task.due_date), 'MMM d') : 'No due date';
                const completing = completingTaskIds.has(task.id);
                return (
                  <div key={task.id} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{task?.name || 'Untitled task'}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {task?.project_name || 'Project'} • {dueLabel}
                        </p>
                      </div>
                      <div className="flex items-start gap-3 text-right">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={Boolean(task?.is_completed) || completing}
                            disabled={completing}
                            onChange={() => task?.id && handleCompleteTask(task.id)}
                            aria-label="Mark task complete"
                            title="Mark complete"
                          />
                        </label>
                        <TaskScoreBadge task={task} />
                      </div>
                    </div>
                  </div>
                );
              })}
              {topPriorities.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tasks to rank.</p>
              ) : null}
            </div>
          </Card>
        </div>
      </div>

      {dragPreview ? (
        <div
          className="pointer-events-none fixed z-[80] w-56 select-none rounded-xl border border-border bg-[hsl(54_100%_92%)] text-[hsl(35_60%_18%)] shadow-lg ring-2 ring-primary/30"
          style={{
            left: dragPreview.clientX,
            top: dragPreview.clientY,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <div className="flex items-center justify-between rounded-t-xl border-b border-[hsl(35_60%_18%/0.12)] bg-[hsl(54_100%_88%)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider">
            <span className="truncate">Drop onto grid</span>
            <span className="opacity-70">
              {dragPreview.task?.due_date ? format(parseISO(dragPreview.task.due_date), 'MMM d') : 'No due'}
            </span>
          </div>
          <div className="px-3 py-2">
            <p className="text-sm font-semibold leading-snug break-words">{dragPreview.task?.name || 'Untitled task'}</p>
            <p className="mt-2 text-xs text-[hsl(35_60%_18%/0.7)]">
              {dragPreview.task?.project_name || 'Project'}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
