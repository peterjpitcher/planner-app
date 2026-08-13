'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/outline';

/**
 * Non-blocking failure notice for optimistic mutations.
 *
 * The projects page applied every edit optimistically and, on failure, silently
 * refetched. The edit just snapped back with no message, which is
 * indistinguishable from the app ignoring the click. This makes the failure
 * visible without a blocking window.alert (the pattern used on Today and
 * Calendar, which interrupts the user and cannot show two failures at once).
 *
 * Deliberately small and dependency-free: the app has no toast library, and
 * pulling one in to solve this would have been a much larger change.
 */

const DEFAULT_DURATION = 6000;

/**
 * @returns {{error: string|null, reportError: (msg: string) => void, dismiss: () => void}}
 */
export function useErrorToast(duration = DEFAULT_DURATION) {
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    setError(null);
  }, [clearTimer]);

  const reportError = useCallback((message) => {
    clearTimer();
    setError(message || 'Something went wrong. Your change was not saved.');
    timerRef.current = setTimeout(() => setError(null), duration);
  }, [clearTimer, duration]);

  // Clear the pending timer if the owning page unmounts mid-countdown.
  useEffect(() => clearTimer, [clearTimer]);

  return { error, reportError, dismiss };
}

export default function ErrorToast({ message, onDismiss }) {
  if (!message) return null;

  return (
    <div
      // aria-live so the failure is announced: the visual revert alone gives a
      // screen reader user no signal at all.
      role="alert"
      aria-live="assertive"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4"
    >
      <div className="pointer-events-auto flex max-w-md items-start gap-3 rounded-lg bg-red-600 px-4 py-3 text-sm text-white shadow-lg">
        <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1 break-words">{message}</p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="-mr-1 shrink-0 rounded p-0.5 text-white/80 hover:bg-white/15 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <XMarkIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
