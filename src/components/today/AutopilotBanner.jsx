'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SparklesIcon } from '@heroicons/react/24/outline';

import { apiClient } from '@/lib/apiClient';
import { createLatestGuard } from '@/lib/requestCache';
import { getLondonDateKey } from '@/lib/timezone';
import { WINDOW_TYPE } from '@/lib/constants';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

/**
 * Review / undo banner for the morning autopilot (A3 / F5-lite).
 *
 * Visibility: shows only once we have positively confirmed that today's daily
 * planning session was auto-built and the user has not yet acknowledged it —
 * i.e. `session.auto_planned === true && !session.reviewed_at`. Until the fetch
 * resolves (or when there is no auto-built day) it renders nothing, so there is
 * no flash of a wrong state. It refetches on the same signals TodayView uses
 * (tasks-changed / planning-complete / tab refocus) so acknowledging or clearing
 * the plan elsewhere keeps it in sync.
 *
 * Actions:
 *  - "Looks good"  → stamps reviewed_at and dismisses the banner.
 *  - "Re-plan"     → opens the planning surface. TodayView cannot reach the
 *                    manual-planning trigger (it lives in AppShell's
 *                    usePlanningPrompt), so this links to /plan, the sanctioned
 *                    fallback.
 *  - "Clear auto-plan" → undoes the auto-plan; the resulting tasks-changed event
 *                    refetches Today and this banner.
 */
export default function AutopilotBanner() {
  // Today's daily planning session, or null when there is none. null is also the
  // fail-closed state, so the banner simply stays hidden when we cannot confirm.
  const [session, setSession] = useState(null);
  const [pendingAction, setPendingAction] = useState(null); // 'review' | 'clear' | null
  const [actionError, setActionError] = useState(null);

  const loadGuardRef = useRef(createLatestGuard());
  const hasLoadedRef = useRef(false);
  const refetchTimerRef = useRef(null);

  // London day key. Computed at render so the acknowledgement targets exactly the
  // window the banner was fetched for (mirrors TodayView's use of getLondonDateKey).
  const today = getLondonDateKey();

  const loadSession = useCallback(async () => {
    const token = loadGuardRef.current.begin();
    try {
      const data = await apiClient.getPlanningSession(WINDOW_TYPE.DAILY, getLondonDateKey());
      // Ignore out-of-order responses superseded by a newer refetch.
      if (loadGuardRef.current.isStale(token)) return;
      setSession(data || null);
    } catch {
      // Fail closed: if we cannot confirm an auto-built day, show no banner rather
      // than an alarming error for a passive background trust check. A banner
      // already on screen is kept (not blanked) so a transient refetch failure
      // never flickers the acknowledgement UI. Action failures are surfaced inline
      // below; this passive check has no user-facing error surface by design.
      if (loadGuardRef.current.isStale(token)) return;
      if (!hasLoadedRef.current) setSession(null);
    } finally {
      hasLoadedRef.current = true;
    }
  }, []);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // Refetch quietly when tasks mutate, planning completes, or the tab regains
  // focus. Bursts are debounced into a single refetch (mirrors TodayView).
  useEffect(() => {
    const scheduleRefetch = () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      refetchTimerRef.current = setTimeout(() => {
        loadSession();
      }, 200);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') scheduleRefetch();
    };
    window.addEventListener('tasks-changed', scheduleRefetch);
    window.addEventListener('planning-complete', scheduleRefetch);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      window.removeEventListener('tasks-changed', scheduleRefetch);
      window.removeEventListener('planning-complete', scheduleRefetch);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadSession]);

  const handleLooksGood = useCallback(async () => {
    setPendingAction('review');
    setActionError(null);
    try {
      await apiClient.markPlanningSessionReviewed(today);
      setSession(null); // acknowledged — hide immediately
    } catch (err) {
      setActionError(err.message || 'Could not save that. Please try again.');
    } finally {
      setPendingAction(null);
    }
  }, [today]);

  const handleClear = useCallback(async () => {
    setPendingAction('clear');
    setActionError(null);
    try {
      // clearAutopilotPlan dispatches tasks-changed, so Today refetches its board
      // and this banner refetches its (now-deleted) session.
      await apiClient.clearAutopilotPlan();
      setSession(null); // plan cleared — hide immediately
    } catch (err) {
      setActionError(err.message || 'Could not clear the plan. Please try again.');
    } finally {
      setPendingAction(null);
    }
  }, []);

  // Only surface once we have positively confirmed an unreviewed, auto-built day.
  const shouldShow = !!session && session.auto_planned === true && !session.reviewed_at;
  if (!shouldShow) return null;

  const isBusy = pendingAction !== null;

  return (
    <Card className="border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <SparklesIcon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">Your day was built for you</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            I planned today from your priorities — have a look and adjust anything.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="default"
              onClick={handleLooksGood}
              isLoading={pendingAction === 'review'}
              disabled={isBusy}
            >
              Looks good
            </Button>
            <Button size="sm" variant="outline" href="/plan">
              Re-plan
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleClear}
              isLoading={pendingAction === 'clear'}
              disabled={isBusy}
            >
              Clear auto-plan
            </Button>
          </div>

          {actionError && (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {actionError}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
