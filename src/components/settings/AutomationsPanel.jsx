'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDistanceToNow, parseISO, isValid } from 'date-fns';
import {
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  MinusCircleIcon,
  ClockIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { apiClient } from '@/lib/apiClient';
import { LONDON_TIME_ZONE } from '@/lib/timezone';
import { cn } from '@/lib/utils';

// Heartbeat / health list for Wave 4. Read-only view of every background
// automation (autopilot, the two tidy crons, the digest email and Outlook
// sync) so the owner can tell at a glance whether each one is actually
// running — the point is to surface silent cron failures.

const DEFAULT_ERROR = 'Could not load automation status. Please try again.';

// status → { label, icon, styling }. Status is never colour-only: every pill
// pairs the word with a distinct Heroicon shape, so it reads without colour.
// Off/never use the semantic muted tokens (dark-mode safe); the working /
// problem / failed states reuse the same Tailwind palette the settings form
// already uses for its save feedback, for visual consistency.
const STATUS_PILL = {
  ok: {
    label: 'Working',
    Icon: CheckCircleIcon,
    className: 'bg-green-50 text-green-700 border-green-200',
  },
  partial: {
    label: 'Ran with problems',
    Icon: ExclamationTriangleIcon,
    className: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  failed: {
    label: 'Failed',
    Icon: XCircleIcon,
    className: 'bg-red-50 text-red-700 border-red-200',
  },
  off: {
    label: 'Off',
    Icon: MinusCircleIcon,
    className: 'bg-muted text-muted-foreground border-border',
  },
  never: {
    label: 'Not run yet',
    Icon: ClockIcon,
    className: 'bg-muted text-muted-foreground border-border',
  },
};

function parseRunDate(lastRunAt) {
  if (!lastRunAt) return null;
  const parsed = parseISO(lastRunAt);
  return isValid(parsed) ? parsed : null;
}

function formatLastRun(lastRunAt) {
  const date = parseRunDate(lastRunAt);
  if (!date) return 'Not run yet';
  return `Last ran ${formatDistanceToNow(date, { addSuffix: true })}`;
}

// Precise Europe/London timestamp for the hover tooltip, so the relative
// "last ran …" text always has an exact time behind it.
function formatLondonTimestamp(lastRunAt) {
  const date = parseRunDate(lastRunAt);
  if (!date) return undefined;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function HealthRow({ row }) {
  const { label, description, lastRunAt, status, detail, stale } = row;
  const pill = STATUS_PILL[status] ?? STATUS_PILL.never;
  const PillIcon = pill.Icon;

  return (
    <li className="flex flex-col gap-2 px-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
        {detail && (
          <p className="mt-1 break-words text-xs text-muted-foreground">{detail}</p>
        )}
        {stale && (
          <p className="mt-1 flex items-center gap-1 text-xs text-amber-700">
            <ClockIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Hasn&apos;t run recently
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
            pill.className
          )}
          aria-label={`Status: ${pill.label}`}
        >
          <PillIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span aria-hidden="true">{pill.label}</span>
        </span>
        <span
          className="text-xs text-muted-foreground"
          title={formatLondonTimestamp(lastRunAt)}
        >
          {formatLastRun(lastRunAt)}
        </span>
      </div>
    </li>
  );
}

function SkeletonRows({ count = 5 }) {
  return (
    <ul className="divide-y divide-border" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} className="flex items-start justify-between gap-4 px-1 py-3">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-40 animate-pulse rounded bg-muted" />
            <div className="h-3 w-56 max-w-full animate-pulse rounded bg-muted" />
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
            <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function AutomationsPanel() {
  const [health, setHealth] = useState(null);
  const [phase, setPhase] = useState('loading'); // 'loading' | 'error' | 'ready'
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  const hasDataRef = useRef(false);

  // load() drives both the initial/Retry fetch (showSkeleton) and the silent
  // focus refresh. A silent refresh that fails is swallowed so a transient
  // network blip on tab-focus never wipes a working list; a first-load failure
  // always surfaces the inline error + Retry.
  const load = useCallback(async ({ showSkeleton = false } = {}) => {
    if (showSkeleton) {
      setPhase('loading');
      setError(null);
    }
    try {
      const response = await apiClient.getAutomations();
      if (!mountedRef.current) return;
      setHealth(Array.isArray(response?.health) ? response.health : []);
      hasDataRef.current = true;
      setError(null);
      setPhase('ready');
    } catch (err) {
      if (!mountedRef.current) return;
      if (showSkeleton || !hasDataRef.current) {
        setError(err?.message || DEFAULT_ERROR);
        setPhase('error');
      }
      // else: keep the last-known-good list on a silent refresh failure.
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load({ showSkeleton: true });

    const refresh = () => {
      if (document.visibilityState === 'visible') {
        load({ showSkeleton: false });
      }
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);

    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [load]);

  return (
    <section aria-labelledby="automations-health-heading" className="mt-8">
      <h2 id="automations-health-heading" className="mb-1 text-sm font-medium text-foreground">
        Automation status
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Whether each background job is running. Refreshes when you return to this tab.
      </p>

      <div className="rounded-lg border border-border bg-card p-2 sm:p-3">
        {phase === 'loading' && <SkeletonRows />}

        {phase === 'error' && (
          <div
            className="flex flex-col items-start gap-3 rounded-md bg-red-50 px-3 py-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between"
            role="alert"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => load({ showSkeleton: true })}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            >
              <ArrowPathIcon className="h-4 w-4" aria-hidden="true" />
              Retry
            </button>
          </div>
        )}

        {phase === 'ready' && health.length === 0 && (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">
            No automations to show yet.
          </p>
        )}

        {phase === 'ready' && health.length > 0 && (
          <ul role="list" className="divide-y divide-border">
            {health.map((row) => (
              <HealthRow key={row.key} row={row} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
