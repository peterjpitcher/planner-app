'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { format } from 'date-fns';
import { apiClient } from '@/lib/apiClient';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

const NO_JOB = 'No Job';

const CATEGORIES = [
  {
    id: 'finance',
    title: 'Finance & Billing',
    prompts: ['Invoices, expenses, tax, subscriptions', 'Anything money-related you’ve postponed'],
  },
  {
    id: 'admin',
    title: 'Admin & Paperwork',
    prompts: ['Accounts, contracts, compliance, passwords', 'Forms, logins, “I should probably…”'],
  },
  {
    id: 'followups',
    title: 'Follow-ups',
    prompts: ['Emails to reply to, people to chase', 'Waiting-on items that need nudging'],
  },
  {
    id: 'scheduling',
    title: 'Scheduling',
    prompts: ['Meetings to book, renewals, deadlines', 'Calendar blocks you should protect'],
  },
  {
    id: 'next-actions',
    title: 'Delivery Next Actions',
    prompts: ['What is the next physical step per project?', 'Define “done” and the immediate move'],
  },
  {
    id: 'quality-risk',
    title: 'Quality & Risk',
    prompts: ['Reviews, QA, checklists, edge cases', 'What could break / what feels fragile?'],
  },
  {
    id: 'bugs',
    title: 'Bugs & Maintenance',
    prompts: ['Fixes, upgrades, tech debt, cleanup', 'Slow stuff down / annoyances'],
  },
  {
    id: 'enhancements',
    title: 'Enhancements',
    prompts: ['Improvements, automation, UX polish', 'Things that would compound over time'],
  },
  {
    id: 'sales',
    title: 'Sales Pipeline',
    prompts: ['Leads, proposals, negotiation, referrals', 'Follow-ups that unlock revenue'],
  },
  {
    id: 'marketing',
    title: 'Marketing & Visibility',
    prompts: ['Content, outreach, portfolio, testimonials', 'Anything that increases inbound'],
  },
  {
    id: 'delegation',
    title: 'People & Delegation',
    prompts: ['Delegate, hire, contractor management', 'Feedback, unblock others'],
  },
  {
    id: 'personal',
    title: 'Personal / Life Admin',
    prompts: ['Errands, health, home, appointments', 'Anything draining mental bandwidth'],
  },
];

function normalizeJob(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

async function fetchAllProjectJobs() {
  const limit = 200;
  let offset = 0;
  const jobs = new Set();

  while (true) {
    const response = await fetch(`/api/projects?includeCompleted=true&limit=${limit}&offset=${offset}`);
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || `Request failed: ${response.status}`);
    }
    const payload = await response.json();
    const data = payload?.data || [];

    data.forEach((project) => {
      const job = normalizeJob(project?.job);
      if (job) jobs.add(job);
    });

    if (!data.length || data.length < limit) break;
    offset += limit;
  }

  return Array.from(jobs).sort((a, b) => a.localeCompare(b));
}

function CategoryCard({ category, selectedJob, onCaptured, capturedCount = 0, recentTasks = [] }) {
  const [draft, setDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const handleSubmit = useCallback(async () => {
    if (isSaving) return;
    const trimmed = draft.trim();
    if (!trimmed) {
      setError('Add a short task name.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const created = await apiClient.createTask({
        name: trimmed,
        description: `Capture: ${category.title}`,
        due_date: format(new Date(), 'yyyy-MM-dd'),
        priority: 'Medium',
        job: selectedJob === NO_JOB ? null : normalizeJob(selectedJob) || null,
      });
      setDraft('');
      onCaptured?.(category.id, created);
    } catch (err) {
      setError(err?.message || 'Failed to add task.');
    } finally {
      setIsSaving(false);
      setTimeout(() => inputRef.current?.focus?.(), 0);
    }
  }, [category.id, category.title, draft, isSaving, onCaptured, selectedJob]);

  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{category.title}</h3>
          <div className="mt-1 space-y-1 text-xs text-muted-foreground">
            {category.prompts.map((prompt) => (
              <p key={prompt}>{prompt}</p>
            ))}
          </div>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-xs text-muted-foreground">Captured</span>
          <span className="text-sm font-semibold text-foreground">{capturedCount}</span>
        </div>
      </div>

      <div className="mt-auto space-y-2">
        <label htmlFor={`capture-${category.id}`} className="sr-only">
          Add a task for {category.title}
        </label>
        <input
          id={`capture-${category.id}`}
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            handleSubmit();
          }}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          placeholder="Add a todo…"
          disabled={isSaving}
        />
        <Button onClick={handleSubmit} isLoading={isSaving} className="w-full" size="sm">
          Add
        </Button>
        {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
        {recentTasks.length > 0 ? (
          <div className="pt-2 border-t border-border">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recent</p>
            <ul className="mt-2 space-y-1">
              {recentTasks.map((task) => (
                <li key={task.id} className="text-xs text-foreground truncate">
                  {task?.name || 'Untitled task'}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export default function CapturePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [jobs, setJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState(NO_JOB);
  const [isLoadingJobs, setIsLoadingJobs] = useState(true);
  const [error, setError] = useState(null);

  const [captureStatsByCategory, setCaptureStatsByCategory] = useState(() => ({}));

  const loadJobs = useCallback(async () => {
    setIsLoadingJobs(true);
    setError(null);
    try {
      const foundJobs = await fetchAllProjectJobs();
      setJobs(foundJobs);
      setSelectedJob((prev) => {
        const normalized = normalizeJob(prev);
        if (normalized === NO_JOB) return NO_JOB;
        if (foundJobs.includes(normalized)) return normalized;
        return foundJobs[0] || NO_JOB;
      });
    } catch (err) {
      setError(err?.message || 'Failed to load jobs.');
      setJobs([]);
      setSelectedJob(NO_JOB);
    } finally {
      setIsLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  useEffect(() => {
    if (status === 'authenticated') loadJobs();
  }, [status, loadJobs]);

  const handleCaptured = useCallback((categoryId, task) => {
    if (!categoryId || !task?.id) return;
    setCaptureStatsByCategory((prev) => {
      const existing = prev[categoryId] || { count: 0, recent: [] };
      const nextRecent = [task, ...existing.recent].slice(0, 3);
      return {
        ...prev,
        [categoryId]: {
          count: existing.count + 1,
          recent: nextRecent,
        },
      };
    });
  }, []);

  const totalCaptured = useMemo(() => {
    return Object.values(captureStatsByCategory).reduce((sum, entry) => sum + (entry?.count || 0), 0);
  }, [captureStatsByCategory]);

  if (status === 'loading' || (status === 'authenticated' && !session?.user)) {
    return <div className="p-8">Loading...</div>;
  }
  if (status === 'unauthenticated') return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Mind Sweep</h1>
          <p className="text-muted-foreground mt-1">
            Pick a job, then use the prompts to get todos out of your head.
          </p>
        </div>
        <Button onClick={loadJobs} variant="outline" isLoading={isLoadingJobs}>
          Refresh jobs
        </Button>
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label htmlFor="job" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Brainstorm job
            </label>
            <select
              id="job"
              value={selectedJob}
              onChange={(e) => setSelectedJob(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-72"
              disabled={isLoadingJobs}
            >
              <option value={NO_JOB}>No job</option>
              {jobs.map((job) => (
                <option key={job} value={job}>{job}</option>
              ))}
            </select>
          </div>
          <div className="text-sm text-muted-foreground">
            Captured this session: <span className="font-semibold text-foreground">{totalCaptured}</span>
          </div>
        </div>
        {error ? (
          <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {CATEGORIES.map((category) => {
          const stats = captureStatsByCategory[category.id] || { count: 0, recent: [] };
          return (
            <CategoryCard
              key={category.id}
              category={category}
              selectedJob={selectedJob}
              onCaptured={handleCaptured}
              capturedCount={stats.count}
              recentTasks={stats.recent}
            />
          );
        })}
      </div>
    </div>
  );
}
