'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { addDays, format, parseISO } from 'date-fns';
import { ChatBubbleLeftEllipsisIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { apiClient } from '@/lib/apiClient';
import { useSupabase } from '@/contexts/SupabaseContext';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useTargetProject } from '@/contexts/TargetProjectContext';
import { compareTasksByDueDateAsc } from '@/lib/taskSort';
import { TaskScoreBadge } from '@/components/Tasks/TaskScoreBadge';
import { toDateInputValue } from '@/lib/dateUtils';
import AddNoteForm from '@/components/Notes/AddNoteForm';
import NoteList from '@/components/Notes/NoteList';
import ChaseTaskModal from '@/components/Tasks/ChaseTaskModal';

const ALL_JOBS = 'All Jobs';
const NO_JOB = 'No Job';

const normalizeJob = (value) => (typeof value === 'string' ? value.trim() : '');
const isUnassignedProjectName = (name) => typeof name === 'string' && name.trim().toLowerCase() === 'unassigned';

const sortTasks = (a, b) => compareTasksByDueDateAsc(a, b);

function effectiveJob(task) {
  const projectName = task?.project_name || task?.projects?.name;
  if (isUnassignedProjectName(projectName)) {
    return normalizeJob(task?.job);
  }
  return normalizeJob(task?.project_job || task?.projects?.job);
}

function TaskRow({ task, datalistId, onUpdated, onNavigateToProject }) {
  const isUnassigned = isUnassignedProjectName(task?.project_name || task?.projects?.name);
  const [jobDraft, setJobDraft] = useState(isUnassigned ? (task?.job || '') : '');
  const [isSavingJob, setIsSavingJob] = useState(false);
  const [isSavingComplete, setIsSavingComplete] = useState(false);
  const [dueDateDraft, setDueDateDraft] = useState(toDateInputValue(task?.due_date));
  const [isEditingDueDate, setIsEditingDueDate] = useState(false);
  const [isSavingDueDate, setIsSavingDueDate] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState([]);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);
  const [isChaseModalOpen, setIsChaseModalOpen] = useState(false);
  const noteInputRef = useRef(null);

  useEffect(() => {
    if (!isUnassigned) return;
    setJobDraft(task?.job || '');
  }, [isUnassigned, task?.job]);

  useEffect(() => {
    if (isEditingDueDate) return;
    setDueDateDraft(toDateInputValue(task?.due_date));
  }, [isEditingDueDate, task?.due_date]);

  const fetchNotes = useCallback(async () => {
    if (!task?.id) return;
    setIsLoadingNotes(true);
    try {
      const data = await apiClient.getNotes(null, task.id);
      const sortedNotes = (data || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setNotes(sortedNotes);
    } catch {
      setNotes([]);
    } finally {
      setIsLoadingNotes(false);
    }
  }, [task?.id]);

  useEffect(() => {
    if (!showNotes) return;
    fetchNotes();
    const timeoutId = setTimeout(() => {
      noteInputRef.current?.focus?.();
    }, 100);
    return () => clearTimeout(timeoutId);
  }, [showNotes, fetchNotes]);

  const handleToggleComplete = useCallback(async () => {
    setIsSavingComplete(true);
    try {
      const updated = await apiClient.updateTask(task.id, {
        is_completed: !task.is_completed,
        completed_at: !task.is_completed ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      });
      onUpdated?.(updated);
    } finally {
      setIsSavingComplete(false);
    }
  }, [task, onUpdated]);

  const handleNoteAdded = useCallback((newNote) => {
    if (!newNote) return;
    setNotes((prev) => [newNote, ...(prev || [])]);
    setShowNotes(false);
  }, []);

  const handleChaseConfirm = useCallback(async (daysToPush) => {
    setIsChaseModalOpen(false);
    if (!task?.id) return;

    try {
      const noteContent = `Chased task. Pushed due date by ${daysToPush} day${daysToPush !== 1 ? 's' : ''}.`;
      const chasedNote = await apiClient.createNote({
        task_id: task.id,
        content: noteContent,
      });
      if (chasedNote) {
        setNotes((prev) => [chasedNote, ...(prev || [])]);
      }

      const baseDate = new Date();
      const newDueDate = addDays(baseDate, daysToPush);
      const formattedNewDate = format(newDueDate, 'yyyy-MM-dd');

      const updated = await apiClient.updateTask(task.id, {
        due_date: formattedNewDate,
        updated_at: new Date().toISOString(),
      });

      onUpdated?.(updated);

      if (showNotes) {
        fetchNotes();
      }
    } catch {
      // Errors surface via global handlers elsewhere; keep UX quiet here.
    }
  }, [fetchNotes, onUpdated, showNotes, task?.id]);

  const handleJobSave = useCallback(async () => {
    if (!isUnassigned) return;
    const normalized = normalizeJob(jobDraft) || null;
    const original = normalizeJob(task?.job) || null;
    if (normalized === original) return;

    setIsSavingJob(true);
    try {
      const updated = await apiClient.updateTask(task.id, {
        job: normalized,
        updated_at: new Date().toISOString(),
      });
      onUpdated?.(updated);
    } finally {
      setIsSavingJob(false);
    }
  }, [isUnassigned, jobDraft, task?.id, task?.job, onUpdated]);

  const handleDueDateSave = useCallback(async () => {
    const nextDueDate = dueDateDraft || null;
    const currentDueDate = toDateInputValue(task?.due_date) || null;
    if (nextDueDate === currentDueDate) {
      setIsEditingDueDate(false);
      return;
    }

    setIsSavingDueDate(true);
    try {
      const updated = await apiClient.updateTask(task.id, {
        due_date: nextDueDate,
        updated_at: new Date().toISOString(),
      });
      onUpdated?.(updated);
    } finally {
      setIsSavingDueDate(false);
      setIsEditingDueDate(false);
    }
  }, [dueDateDraft, onUpdated, task?.due_date, task?.id]);

  const handleDueDateCancel = useCallback(() => {
    setDueDateDraft(toDateInputValue(task?.due_date));
    setIsEditingDueDate(false);
  }, [task?.due_date]);

  const dueDateLabel = task?.due_date ? format(parseISO(task.due_date), 'MMM d, yyyy') : 'No due date';
  const jobLabel = effectiveJob(task) || NO_JOB;

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <input
            type="checkbox"
            checked={Boolean(task?.is_completed)}
            onChange={handleToggleComplete}
            disabled={isSavingComplete}
            className="mt-1 h-4 w-4"
            aria-label={task?.is_completed ? 'Mark task incomplete' : 'Mark task complete'}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-sm font-semibold text-foreground truncate">{task?.name || 'Untitled task'}</p>
              <span className="text-xs text-muted-foreground">•</span>
              {isEditingDueDate ? (
                <input
                  type="date"
                  value={dueDateDraft}
                  onChange={(e) => setDueDateDraft(e.target.value)}
                  onBlur={handleDueDateSave}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleDueDateSave();
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      handleDueDateCancel();
                    }
                  }}
                  className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                  aria-label="Task due date"
                  disabled={isSavingDueDate}
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditingDueDate(true)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                  title="Edit due date"
                >
                  {dueDateLabel}
                </button>
              )}
              <span className="text-xs text-muted-foreground">•</span>
              <TaskScoreBadge task={task} />

              {!task?.is_completed && (
                <button
                  type="button"
                  onClick={() => setIsChaseModalOpen(true)}
                  className="ml-1 inline-flex items-center rounded-md border border-border bg-background px-2 py-0.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
                  title="Chase task (add note & push due date)"
                >
                  <PaperAirplaneIcon className="h-3.5 w-3.5 -rotate-45" />
                  Chase
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowNotes((prev) => !prev)}
                disabled={isLoadingNotes}
                className="inline-flex items-center rounded-md border border-border bg-background px-2 py-0.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-60"
                aria-expanded={showNotes}
                aria-controls={`task-notes-${task?.id}`}
                title="Notes"
              >
                <ChatBubbleLeftEllipsisIcon className="h-3.5 w-3.5" />
                Notes{notes.length > 0 ? ` (${notes.length})` : ''}
              </button>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <button
                type="button"
                onClick={() => onNavigateToProject?.(task?.project_id)}
                className="text-primary hover:underline"
                title="Jump to project on dashboard"
              >
                {task?.project_name || 'Project'}
              </button>
              <span className="text-muted-foreground">•</span>
              <span className="text-muted-foreground">Job:</span>
              <span className="font-medium text-foreground/80">{jobLabel}</span>
            </div>
          </div>
        </div>

        {isUnassigned && (
          <div className="flex items-center gap-2 sm:justify-end">
            <label htmlFor={`job-${task.id}`} className="text-xs text-muted-foreground">
              Job
            </label>
            <input
              id={`job-${task.id}`}
              list={datalistId}
              value={jobDraft}
              onChange={(e) => setJobDraft(e.target.value)}
              onBlur={handleJobSave}
              onKeyDown={(e) => (e.key === 'Enter' && handleJobSave())}
              className="h-8 w-44 rounded-md border border-input bg-background px-2 text-xs"
              placeholder="Set job…"
              disabled={isSavingJob}
            />
          </div>
        )}
      </div>

      {showNotes && (
        <div id={`task-notes-${task?.id}`} className="mt-3 border-t border-border/60 pt-3">
          <AddNoteForm ref={noteInputRef} parentId={task.id} parentType="task" onNoteAdded={handleNoteAdded} />
          {isLoadingNotes ? (
            <p className="text-xs text-muted-foreground">Loading notes…</p>
          ) : (
            <NoteList notes={notes} />
          )}
        </div>
      )}

      <ChaseTaskModal
        isOpen={isChaseModalOpen}
        onClose={() => setIsChaseModalOpen(false)}
        onConfirm={handleChaseConfirm}
        taskName={task?.name || 'Task'}
      />
    </div>
  );
}

export default function TasksPage() {
  const { data: session, status } = useSession();
  const supabase = useSupabase();
  const router = useRouter();
  const { setTargetProjectId } = useTargetProject();

  const [tasks, setTasks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedJob, setSelectedJob] = useState(ALL_JOBS);
  const [groupByJob, setGroupByJob] = useState(false);

  // force: boolean - bypass cache/debounce
  // options: { silent: boolean } - if true, don't show loading spinner
  const fetchTasks = useCallback(async (force = false, { silent = false } = {}) => {
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const data = await apiClient.getTasks(null, false, { limit: 200, forceSync: force });
      setTasks((data || []).slice().sort(sortTasks));
    } catch (err) {
      if (!silent) setError(err?.message || 'Failed to load tasks.');
      // If silent refresh fails, we might not want to clear tasks, effectively keeping stale data is better than empty
      if (!silent) setTasks([]);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  useEffect(() => {
    if (status === 'authenticated') fetchTasks();
  }, [status, fetchTasks]);

  // Realtime subscription
  useEffect(() => {
    if (!supabase || status !== 'authenticated') return;

    const channel = supabase
      .channel('tasks-page-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tasks',
          // RLS ensures we only receive our own tasks, but we can filter by user_id if needed
          // filter: `user_id=eq.${session?.user?.id}`, 
        },
        (payload) => {
          // console.log('Realtime task update:', payload);
          // Trigger a silent refresh to get the full data (including joins) and resort
          fetchTasks(false, { silent: true });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, status, fetchTasks]);

  const availableJobs = useMemo(() => {
    const values = new Set();
    tasks.forEach((task) => {
      const job = effectiveJob(task);
      if (job) values.add(job);
    });
    return Array.from(values).sort();
  }, [tasks]);

  const jobDatalistId = 'job-options';

  const filteredTasks = useMemo(() => {
    if (selectedJob === ALL_JOBS) return tasks;
    if (selectedJob === NO_JOB) {
      return tasks.filter((task) => !effectiveJob(task));
    }
    return tasks.filter((task) => effectiveJob(task) === selectedJob);
  }, [tasks, selectedJob]);

  const groupedTasks = useMemo(() => {
    if (!groupByJob) {
      return new Map([[ALL_JOBS, filteredTasks]]);
    }

    const groups = new Map();
    filteredTasks.forEach((task) => {
      const job = effectiveJob(task) || NO_JOB;
      const existing = groups.get(job) || [];
      existing.push(task);
      groups.set(job, existing);
    });

    Array.from(groups.values()).forEach((group) => group.sort(sortTasks));

    const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
      const aTasks = groups.get(a) || [];
      const bTasks = groups.get(b) || [];
      const aHead = aTasks[0];
      const bHead = bTasks[0];
      if (aHead && bHead) {
        const diff = sortTasks(aHead, bHead);
        if (diff !== 0) return diff;
      } else if (aHead) {
        return -1;
      } else if (bHead) {
        return 1;
      }
      return a.localeCompare(b);
    });

    return new Map(sortedKeys.map((key) => [key, groups.get(key)]));
  }, [filteredTasks, groupByJob]);

  const handleTaskUpdated = useCallback((updatedTask) => {
    if (!updatedTask?.id) return;
    setTasks((prev) => {
      const existing = prev.find((t) => t.id === updatedTask.id);
      const merged = existing ? { ...existing, ...updatedTask } : { ...updatedTask };
      const without = prev.filter((t) => t.id !== updatedTask.id);
      if (!merged.is_completed) {
        without.push(merged);
      }
      return without.slice().sort(sortTasks);
    });
  }, []);

  const handleNavigateToProject = useCallback((projectId) => {
    if (!projectId) return;
    setTargetProjectId(projectId);
    router.push('/dashboard');
  }, [router, setTargetProjectId]);

  if (status === 'loading' || (status === 'authenticated' && !session?.user)) {
    return <div className="p-8">Loading...</div>;
  }
  if (status === 'unauthenticated') return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Tasks</h1>
          <p className="text-muted-foreground mt-1">
            Day-to-day list sorted by due date and your simple High/Medium/Low priority labels.
          </p>
        </div>
        <Button onClick={() => fetchTasks(true)} variant="outline" isLoading={isLoading}>
          Refresh
        </Button>
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={groupByJob}
              onChange={(e) => setGroupByJob(e.target.checked)}
              className="h-4 w-4"
            />
            Split by job
          </label>
        </div>
      </Card>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading tasks…</div>
      ) : filteredTasks.length === 0 ? (
        <div className="p-6 text-sm text-muted-foreground">No tasks to show.</div>
      ) : (
        <div className="space-y-6">
          {Array.from(groupedTasks.entries()).map(([groupName, groupTasks]) => (
            <div key={groupName} className="space-y-3">
              {groupByJob && (
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    {groupName}
                  </h2>
                  <span className="text-xs text-muted-foreground">{groupTasks.length}</span>
                </div>
              )}
              <div className="space-y-2">
                {groupTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    datalistId={jobDatalistId}
                    onUpdated={handleTaskUpdated}
                    onNavigateToProject={handleNavigateToProject}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <datalist id={jobDatalistId}>
        {availableJobs.map((job) => (
          <option key={job} value={job} />
        ))}
      </datalist>
    </div>
  );
}
