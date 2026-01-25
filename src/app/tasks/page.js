'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { format, parseISO } from 'date-fns';
import { apiClient } from '@/lib/apiClient';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useTargetProject } from '@/contexts/TargetProjectContext';
import { compareTasksByWorkPriority } from '@/lib/taskScoring';
import { TaskScoreBadge } from '@/components/Tasks/TaskScoreBadge';

const ALL_JOBS = 'All Jobs';
const NO_JOB = 'No Job';

const normalizeJob = (value) => (typeof value === 'string' ? value.trim() : '');
const isUnassignedProjectName = (name) => typeof name === 'string' && name.trim().toLowerCase() === 'unassigned';

const sortTasks = (a, b) => compareTasksByWorkPriority(a, b);

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

  useEffect(() => {
    if (!isUnassigned) return;
    setJobDraft(task?.job || '');
  }, [isUnassigned, task?.job]);

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

  const dueDateLabel = task?.due_date ? format(parseISO(task.due_date), 'MMM d, yyyy') : 'No due date';
  const jobLabel = effectiveJob(task) || NO_JOB;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
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
            <span className="text-xs text-muted-foreground">{dueDateLabel}</span>
            <span className="text-xs text-muted-foreground">•</span>
            <span className="text-xs font-medium text-foreground/80">{task?.priority || 'No priority'}</span>
            <TaskScoreBadge task={task} className="ml-1" />
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
  );
}

export default function TasksPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { setTargetProjectId } = useTargetProject();

  const [tasks, setTasks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedJob, setSelectedJob] = useState(ALL_JOBS);
  const [groupByJob, setGroupByJob] = useState(false);

  const fetchTasks = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiClient.getTasks(null, false, { limit: 200 });
      setTasks((data || []).slice().sort(sortTasks));
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
    if (status === 'authenticated') fetchTasks();
  }, [status, fetchTasks]);

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
            Day-to-day list sorted by your urgency/importance scores blended with due dates.
          </p>
        </div>
        <Button onClick={fetchTasks} variant="outline" isLoading={isLoading}>
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
