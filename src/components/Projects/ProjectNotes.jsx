// src/components/Projects/ProjectNotes.jsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/apiClient';
import { formatDate } from '@/lib/dateUtils';
import { dedupedFetch, clearCache } from '@/lib/requestCache';

export default function ProjectNotes({ projectId, disabled = false }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newNote, setNewNote] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const abortRef = useRef(null);

  const loadNotes = useCallback(async (pid) => {
    // Abort any in-flight request for a previous project
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const cacheKey = `notes-${pid}`;
      const response = await dedupedFetch(cacheKey, () =>
        apiClient.getNotes(pid)
      );

      // Guard against stale responses after project switch
      if (controller.signal.aborted) return;

      setNotes(response?.data || response || []);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError('Failed to load notes.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (projectId) {
      loadNotes(projectId);
    } else {
      setNotes([]);
      setLoading(false);
    }

    return () => abortRef.current?.abort();
  }, [projectId, loadNotes]);

  async function handleCreateNote(e) {
    if (e.key === 'Escape') {
      setNewNote('');
      return;
    }
    if (e.key !== 'Enter' || !newNote.trim() || isCreating || disabled) return;

    setIsCreating(true);
    try {
      const result = await apiClient.createNote({
        content: newNote.trim(),
        project_id: projectId,
      });
      const created = result?.data ?? result;
      setNotes((prev) => [created, ...prev]);
      setNewNote('');
      // Invalidate cache so next load gets fresh data
      clearCache(`notes-${projectId}`);
    } catch {
      // silently fail
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="flex flex-col">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">
        Notes ({notes.length})
      </h3>

      {/* Add note input */}
      <input
        type="text"
        value={newNote}
        onChange={(e) => setNewNote(e.target.value)}
        onKeyDown={handleCreateNote}
        placeholder="Add a note… (Enter to save)"
        disabled={isCreating || disabled}
        className="mb-3 w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm placeholder-gray-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50"
      />

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse rounded-lg border-l-[3px] border-amber-300 bg-amber-50/50 p-3">
              <div className="mb-2 h-3 w-20 rounded bg-amber-200/50" />
              <div className="h-3 w-full rounded bg-amber-200/30" />
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="py-4 text-center">
          <p className="text-sm text-red-600">{error}</p>
          <button
            type="button"
            onClick={() => loadNotes(projectId)}
            className="mt-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
          >
            Retry
          </button>
        </div>
      )}

      {/* Notes list */}
      {!loading && !error && (
        notes.length === 0 ? (
          <p className="py-4 text-center text-xs text-gray-400 italic">No notes yet. Add one above.</p>
        ) : (
          <div className="space-y-2 overflow-y-auto">
            {notes.map((note) => (
              <div
                key={note.id}
                className="rounded-lg border-l-[3px] border-amber-400 bg-amber-50 p-3"
              >
                <p className="text-[10px] font-semibold text-amber-700">
                  {formatDate(note.created_at, 'MMM d, yyyy')}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-gray-600">
                  {note.content}
                </p>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
