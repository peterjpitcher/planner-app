'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  ExclamationTriangleIcon,
  ChevronRightIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { apiClient } from '@/lib/apiClient';
import { createLatestGuard } from '@/lib/requestCache';
import { getLondonDateKey, LONDON_TIME_ZONE } from '@/lib/timezone';
import { cn } from '@/lib/styleUtils';

// Wave 5 project-altitude radar. A "Needs a next action" nudge at the top of the
// Projects view: it surfaces Open projects that have nothing scheduled (every
// task undated in Backlog, or no tasks at all) so a whole project can no longer
// silently stall. Backend does the classification (GET /api/projects/radar);
// this component only renders the already-sorted `stalled` rows. It renders
// NOTHING when nothing is stalled — the healthy state is silence.

const DEFAULT_ERROR = 'Could not load the project radar.';

// Whole-day difference between two London date keys (YYYY-MM-DD), computed on
// the calendar dates so it is unaffected by clock time or DST offsets.
function diffLondonDays(fromKey, toKey) {
  const [fy, fm, fd] = fromKey.split('-').map(Number);
  const [ty, tm, td] = toKey.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

// "last touched" phrasing anchored to the Europe/London calendar, so it agrees
// with the rest of the app's Today/Overdue logic and the morning digest. Recent
// activity reads relatively (today / yesterday / N days ago); older activity
// falls back to a plain London date so the nudge never becomes vague. Null or
// unparseable timestamps read "not yet".
function formatLastTouched(lastActivityAt) {
  if (!lastActivityAt) return 'not yet';
  const date = new Date(lastActivityAt);
  if (Number.isNaN(date.getTime())) return 'not yet';
  let activityKey;
  let nowKey;
  try {
    activityKey = getLondonDateKey(date);
    nowKey = getLondonDateKey();
  } catch {
    return 'not yet';
  }
  const diff = diffLondonDays(activityKey, nowKey);
  if (diff <= 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff < 7) return `${diff} days ago`;
  // Date-only key parses to local midnight; formatting it prints the same
  // calendar date with no timezone shift.
  return `on ${format(parseISO(activityKey), 'd MMM yyyy')}`;
}

// Precise Europe/London timestamp for the hover tooltip, so the relative
// "last touched …" text always has an exact time behind it.
function londonTimestamp(lastActivityAt) {
  if (!lastActivityAt) return undefined;
  const date = new Date(lastActivityAt);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function RadarSkeleton() {
  return (
    <section
      className="mb-4 rounded-lg border border-gray-200 bg-white p-3"
      aria-hidden="true"
    >
      <div className="mb-3 h-4 w-44 animate-pulse rounded bg-gray-200" />
      <div className="flex flex-col gap-2">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-3 px-2.5 py-2">
            <div className="h-2 w-2 shrink-0 rounded-full bg-gray-200" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-1/2 animate-pulse rounded bg-gray-200" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-gray-200" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StalledRow({ row, onSelectProject }) {
  const name = row.name || '(Untitled project)';
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelectProject(row.projectId)}
        className="group flex w-full items-center gap-3 rounded-lg border-l-[3px] border-transparent px-2.5 py-2 text-left transition-colors hover:border-amber-400 hover:bg-amber-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
        aria-label={`Open ${name} to give it a next action`}
      >
        <span
          className="mt-1.5 h-2 w-2 shrink-0 self-start rounded-full bg-amber-500"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="min-w-0 truncate text-sm font-medium text-gray-900">
              {name}
            </span>
            {row.area && (
              <span className="shrink-0 truncate text-xs text-gray-500">
                ({row.area})
              </span>
            )}
          </span>
          <span
            className="mt-0.5 block text-xs text-gray-500"
            title={londonTimestamp(row.lastActivityAt)}
          >
            Last touched {formatLastTouched(row.lastActivityAt)}
          </span>
        </span>
        <ChevronRightIcon
          className="h-4 w-4 shrink-0 text-gray-400 transition-colors group-hover:text-gray-600"
          aria-hidden="true"
        />
      </button>
    </li>
  );
}

export default function ProjectRadar({ onSelectProject }) {
  // phase: 'loading' (first load only) | 'error' (first load failed) | 'ready'
  const [phase, setPhase] = useState('loading');
  const [stalled, setStalled] = useState([]);
  const [error, setError] = useState(null);

  // Latest-wins guard + debounce timer for background refetches — mirrors
  // ProjectsView so overlapping 'tasks-changed' bursts collapse into one fetch
  // and only the last-started response is applied.
  const loadGuardRef = useRef(createLatestGuard());
  const refetchTimerRef = useRef(null);
  // Gate silent refetches until the first load has completed, so a background
  // refetch can never supersede the in-flight initial load.
  const hasLoadedRef = useRef(false);
  const mountedRef = useRef(true);

  const load = useCallback(async ({ silent = false } = {}) => {
    const token = loadGuardRef.current.begin();
    if (!silent) {
      setPhase('loading');
      setError(null);
    }
    try {
      const response = await apiClient.getProjectRadar();
      // Ignore out-of-order / post-unmount responses.
      if (loadGuardRef.current.isStale(token) || !mountedRef.current) return;
      const rows = Array.isArray(response?.projects) ? response.projects : [];
      // Backend already sorts stalled-first, most-neglected first — keep order.
      setStalled(rows.filter((r) => r && r.stalled === true));
      setError(null);
      setPhase('ready');
    } catch (err) {
      if (loadGuardRef.current.isStale(token) || !mountedRef.current) return;
      // Only surface an error on the first load; a transient refresh failure
      // keeps the last-known list rather than blanking or flashing the section.
      if (!silent || !hasLoadedRef.current) {
        setError(err?.message || DEFAULT_ERROR);
        setPhase('error');
      }
    } finally {
      hasLoadedRef.current = true;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load({ silent: false });

    // Silent revalidation on task mutations, plan completion, and tab refocus —
    // acting on a stalled project (adding a scheduled task) drops it on the next
    // refresh. Bursts are debounced into a single refetch.
    const scheduleRefetch = () => {
      if (!hasLoadedRef.current) return;
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      refetchTimerRef.current = setTimeout(() => { load({ silent: true }); }, 200);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') scheduleRefetch();
    };
    window.addEventListener('tasks-changed', scheduleRefetch);
    window.addEventListener('planning-complete', scheduleRefetch);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      mountedRef.current = false;
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      window.removeEventListener('tasks-changed', scheduleRefetch);
      window.removeEventListener('planning-complete', scheduleRefetch);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [load]);

  if (phase === 'loading') return <RadarSkeleton />;

  if (phase === 'error') {
    return (
      <section
        className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2"
        role="status"
      >
        <span className="text-xs text-gray-500">{error}</span>
        <button
          type="button"
          onClick={() => load({ silent: false })}
          className="inline-flex shrink-0 items-center gap-1 rounded text-xs font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <ArrowPathIcon className="h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </button>
      </section>
    );
  }

  // Healthy state — no stalled projects, so show nothing intrusive.
  if (stalled.length === 0) return null;

  return (
    <section
      aria-labelledby="project-radar-heading"
      className="mb-4 rounded-lg border border-amber-200 bg-amber-50/50 p-3"
    >
      <div className="mb-1 flex items-center gap-2">
        <ExclamationTriangleIcon
          className="h-4 w-4 shrink-0 text-amber-500"
          aria-hidden="true"
        />
        <h2 id="project-radar-heading" className="text-sm font-semibold text-gray-900">
          Needs a next action
        </h2>
        <span
          className={cn(
            'inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5',
            'text-xs font-medium text-amber-800'
          )}
        >
          {stalled.length}
        </span>
      </div>
      <p className="mb-2 text-xs text-gray-500">
        Open projects with nothing scheduled. Open one to give it a next action.
      </p>
      <ul role="list" className="flex flex-col gap-0.5">
        {stalled.map((row) => (
          <StalledRow key={row.projectId} row={row} onSelectProject={onSelectProject} />
        ))}
      </ul>
    </section>
  );
}
