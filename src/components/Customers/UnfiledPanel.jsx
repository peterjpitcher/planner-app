// src/components/Customers/UnfiledPanel.jsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/apiClient';
import { formatDate } from '@/lib/dateUtils';

/**
 * Notes with no parent at all.
 *
 * They arise when a project with no customer is deleted: the notes are kept
 * rather than destroyed, which is the point, but they have nowhere to live.
 * check_note_parent permits zero parents precisely so this is legal.
 *
 * The risk with "kept but unattached" is that it becomes a silent junk drawer,
 * which would be its own kind of loss. So they get a panel of their own, a
 * one-click re-file, and a count on the Customers nav item.
 */
export default function UnfiledPanel({ customers = [], onChanged }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setNotes(await apiClient.getUnfiledNotes());
      setError(null);
    } catch (err) {
      setError(err.message || 'Could not load unfiled notes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function refile(noteId, customerId) {
    if (!customerId) return;
    setBusyId(noteId);
    try {
      await apiClient.refileNote(noteId, customerId);
      setNotes((prev) => prev.filter((note) => note.id !== noteId));
      onChanged?.();
    } catch (err) {
      setError(err.message || 'Could not file that note.');
    } finally {
      setBusyId(null);
    }
  }

  if (loading || (notes.length === 0 && !error)) return null;

  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold text-gray-700">Unfiled ({notes.length})</h2>
      <p className="mt-0.5 text-xs text-gray-500">
        Kept when a project was deleted, but not attached to a customer yet.
      </p>

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}

      <ul className="mt-2 space-y-2">
        {notes.map((note) => (
          <li key={note.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-[10px] font-semibold text-amber-700">
              {formatDate(note.occurred_at || note.created_at, 'MMM d, yyyy')}
              {note.context_label && (
                <span className="ml-1.5 rounded bg-white px-1.5 py-0.5 font-normal text-gray-500">
                  {note.context_label}
                </span>
              )}
            </p>
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-gray-700">
              {note.content}
            </p>

            <div className="mt-2">
              <label className="sr-only" htmlFor={`refile-${note.id}`}>
                File this note to a customer
              </label>
              <select
                id={`refile-${note.id}`}
                defaultValue=""
                disabled={busyId === note.id}
                onChange={(event) => refile(note.id, event.target.value)}
                className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              >
                <option value="">File to…</option>
                {customers
                  .filter((customer) => !customer.archived_at)
                  .map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
              </select>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
