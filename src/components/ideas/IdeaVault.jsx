'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/apiClient';
import { createLatestGuard } from '@/lib/requestCache';
import { IDEA_STATE, IDEA_STATE_ORDER } from '@/lib/constants';
import IdeaCard from './IdeaCard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Human-readable label for each idea state section header */
const STATE_LABELS = {
  [IDEA_STATE.CAPTURED]: 'Captured',
  [IDEA_STATE.EXPLORING]: 'Exploring',
  [IDEA_STATE.READY_LATER]: 'Ready Later',
};

/** Skeleton card for loading state */
function IdeaCardSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-gray-200 bg-white px-3 py-3 shadow-sm">
      <div className="h-4 w-3/4 rounded bg-gray-200" />
      <div className="mt-2 h-3 w-1/3 rounded bg-gray-100" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// IdeaVault
// ---------------------------------------------------------------------------

export default function IdeaVault() {
  const [ideas, setIdeas] = useState([]);
  // F4: "Ready Later" ideas whose review_date has arrived, from the server
  // (uses the London date key). Surfaced at the top of the vault for a decision.
  const [dueForReview, setDueForReview] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [captureInput, setCaptureInput] = useState('');
  const [isCapturing, setIsCapturing] = useState(false);
  const captureRef = useRef(null);
  const loadGuardRef = useRef(createLatestGuard());

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  // F4: refresh only the due-for-review list. Called after a mutation so a
  // rescheduled or cleared idea leaves the top section without a full reload.
  const refreshDueForReview = useCallback(async () => {
    try {
      const due = await apiClient.getIdeas({ due_for_review: 1 });
      setDueForReview(due);
    } catch {
      // Non-fatal — keep the prior due list rather than surfacing an error.
    }
  }, []);

  const loadIdeas = useCallback(async () => {
    // Latest-wins guard so overlapping refetches (mount + ideas-changed) can't let
    // a stale response land last. Refetches revalidate quietly (loading stays off).
    const token = loadGuardRef.current.begin();
    try {
      setError(null);
      const [data, due] = await Promise.all([
        apiClient.getIdeas(),
        apiClient.getIdeas({ due_for_review: 1 }),
      ]);
      if (loadGuardRef.current.isStale(token)) return;
      setIdeas(data);
      setDueForReview(due);
    } catch (err) {
      if (loadGuardRef.current.isStale(token)) return;
      setError(err.message || 'Failed to load ideas.');
    } finally {
      if (!loadGuardRef.current.isStale(token)) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadIdeas();
  }, [loadIdeas]);

  // Refresh when an idea is created elsewhere (e.g. QuickCapture on /ideas) — FF-008
  useEffect(() => {
    const handle = () => { loadIdeas(); };
    window.addEventListener('ideas-changed', handle);
    return () => window.removeEventListener('ideas-changed', handle);
  }, [loadIdeas]);

  // -------------------------------------------------------------------------
  // Inline capture
  // -------------------------------------------------------------------------

  async function handleCaptureSubmit(e) {
    e.preventDefault();
    const title = captureInput.trim();
    if (!title || isCapturing) return;

    setIsCapturing(true);
    try {
      const created = await apiClient.createIdea({ title });
      // Prepend to ideas list (newest first in Captured section)
      setIdeas((prev) => [created, ...prev]);
      setCaptureInput('');
    } catch (err) {
      setError(err.message || 'Failed to capture idea.');
    } finally {
      setIsCapturing(false);
    }
  }

  function handleCaptureKeyDown(e) {
    if (e.key === 'Enter') {
      handleCaptureSubmit(e);
    }
  }

  // -------------------------------------------------------------------------
  // Card action handlers
  // -------------------------------------------------------------------------

  const handleUpdate = useCallback(async (id, updates) => {
    try {
      const updated = await apiClient.updateIdea(id, updates);
      setIdeas((prev) =>
        prev.map((idea) => (idea.id === id ? { ...idea, ...updated } : idea))
      );
      // F4: a change to review_date or idea_state can add or remove the idea
      // from the due-for-review section — resync it from the server.
      refreshDueForReview();
    } catch (err) {
      setError(err.message || 'Failed to update idea.');
    }
  }, [refreshDueForReview]);

  const handlePromote = useCallback(async (id) => {
    try {
      await apiClient.promoteIdea(id);
      // Remove from list — it's now a task
      setIdeas((prev) => prev.filter((idea) => idea.id !== id));
      setDueForReview((prev) => prev.filter((idea) => idea.id !== id));
      // Show toast if available via window.__toast
      if (typeof window !== 'undefined' && window.__toast) {
        window.__toast.success('Idea promoted to task in Backlog');
      }
    } catch (err) {
      setError(err.message || 'Failed to promote idea.');
    }
  }, []);

  const handleDelete = useCallback(async (id) => {
    try {
      await apiClient.deleteIdea(id);
      setIdeas((prev) => prev.filter((idea) => idea.id !== id));
      setDueForReview((prev) => prev.filter((idea) => idea.id !== id));
    } catch (err) {
      setError(err.message || 'Failed to delete idea.');
    }
  }, []);

  // -------------------------------------------------------------------------
  // Group ideas by state, respecting IDEA_STATE_ORDER
  // -------------------------------------------------------------------------

  // F4: ideas already shown in the "Due for review" section are excluded from
  // the Ready Later column so a due idea is not rendered twice.
  const dueIds = new Set(dueForReview.map((idea) => idea.id));

  const grouped = IDEA_STATE_ORDER.reduce((acc, state) => {
    acc[state] = ideas.filter(
      (idea) => idea.idea_state === state && !dueIds.has(idea.id)
    );
    return acc;
  }, {});

  const totalIdeas = ideas.length;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      {/* Page heading */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Idea Vault</h1>
        <p className="mt-1 text-sm text-gray-500">
          Capture every spark. Explore what matters. Promote when ready.
        </p>
      </div>

      {/* Inline capture input */}
      <form onSubmit={handleCaptureSubmit} className="mb-8">
        <div className="flex gap-2">
          <input
            ref={captureRef}
            type="text"
            value={captureInput}
            onChange={(e) => setCaptureInput(e.target.value)}
            onKeyDown={handleCaptureKeyDown}
            placeholder="Got an idea? Capture it here…"
            disabled={isCapturing}
            className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder-gray-400 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!captureInput.trim() || isCapturing}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isCapturing ? 'Saving…' : 'Capture'}
          </button>
        </div>
      </form>

      {/* Error banner */}
      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-2 underline hover:no-underline focus:outline-none"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Loading skeletons */}
      {loading && (
        <div className="space-y-6">
          {IDEA_STATE_ORDER.map((state) => (
            <section key={state}>
              <div className="mb-2 h-4 w-32 animate-pulse rounded bg-gray-200" />
              <div className="space-y-2">
                {[1, 2].map((n) => (
                  <IdeaCardSkeleton key={n} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && totalIdeas === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 px-6 py-12 text-center">
          <p className="text-base font-medium text-gray-500">Got an idea? Capture it here.</p>
          <p className="mt-1 text-sm text-gray-400">
            Use the input above to save your first idea.
          </p>
          <button
            type="button"
            onClick={() => captureRef.current?.focus()}
            className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            Add your first idea
          </button>
        </div>
      )}

      {/* F4: Due for review — Ready Later ideas whose review_date has arrived */}
      {!loading && dueForReview.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-amber-600">
            Due for review
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              {dueForReview.length}
            </span>
          </h2>
          <p className="mb-3 text-xs text-gray-400">
            These Ready Later ideas have reached their review date. Decide, reschedule, or clear the date.
          </p>
          <div className="space-y-2">
            {dueForReview.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                onUpdate={handleUpdate}
                onPromote={handlePromote}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </section>
      )}

      {/* Grouped sections */}
      {!loading && totalIdeas > 0 && (
        <div className="space-y-8">
          {IDEA_STATE_ORDER.map((state) => {
            const sectionIdeas = grouped[state] ?? [];
            // Skip empty sections when there are ideas in other sections
            if (sectionIdeas.length === 0) return null;

            return (
              <section key={state}>
                {/* Section header */}
                <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-gray-400">
                  {STATE_LABELS[state] ?? state}
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                    {sectionIdeas.length}
                  </span>
                </h2>

                {/* Cards */}
                <div className="space-y-2">
                  {sectionIdeas.map((idea) => (
                    <IdeaCard
                      key={idea.id}
                      idea={idea}
                      onUpdate={handleUpdate}
                      onPromote={handlePromote}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
