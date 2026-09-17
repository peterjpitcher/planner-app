// src/components/shared/NotesPanel.jsx
'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import {
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  PencilIcon,
  TrashIcon,
} from '@heroicons/react/20/solid';

import { apiClient } from '@/lib/apiClient';
import { formatDate } from '@/lib/dateUtils';
import {
  insertStampedLine,
  noteLineStamp,
  stampFirstLine,
  withoutTrailingEmptyStamps,
} from '@/lib/noteStamps';
import { getLondonDateKey } from '@/lib/timezone';
import { VALIDATION } from '@/lib/constants';
import { cn } from '@/lib/styleUtils';

/**
 * The note list, shared by the project workspace and the customer workspace.
 *
 * Three things changed in Phase 2 and they are the reason this replaced the
 * project-only version:
 *
 * 1. The input was a single-line <input> capped at 1000 characters, so a pasted
 *    email could not go in a note at all. It is a textarea at 20000 now.
 * 2. Notes were write-once. There was no way to fix a typo or correct a date.
 * 3. A note carries when it actually happened, separate from when it was typed,
 *    and where it came from. The list sorts by the former.
 */

const SOURCES = [
  { value: 'note', label: 'Note' },
  { value: 'email', label: 'Email' },
  { value: 'call', label: 'Call' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'message', label: 'Message' },
  { value: 'document', label: 'Document' },
  { value: 'other', label: 'Other' },
];

const SOURCE_LABEL = Object.fromEntries(SOURCES.map((s) => [s.value, s.label]));

function NoteRow({ note, onEdit, onDelete, disabled }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);
  const [saving, setSaving] = useState(false);

  async function save() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === note.content) {
      setEditing(false);
      setDraft(note.content);
      return;
    }
    setSaving(true);
    try {
      await onEdit(note.id, { content: trimmed });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="rounded-lg border-l-[3px] border-amber-400 bg-amber-50 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold text-amber-700">
          {note.pinned && (
            <span className="rounded bg-amber-200 px-1.5 py-0.5 text-amber-900">Pinned</span>
          )}
          <span>{formatDate(note.occurred_at || note.created_at, 'MMM d, yyyy')}</span>
          {note.source && note.source !== 'note' && (
            <span className="rounded bg-white px-1.5 py-0.5 text-amber-800">
              {SOURCE_LABEL[note.source] || note.source}
            </span>
          )}
          {/* Where the note actually lives, when that is not here. Closing a
              project hands its notes to the customer, so without this badge the
              timeline would present them all as customer-level. */}
          {note.source_project && (
            <span className="rounded bg-white px-1.5 py-0.5 font-normal text-gray-600">
              {note.source_project.name}
            </span>
          )}
          {note.context_label && (
            <span className="rounded bg-white px-1.5 py-0.5 font-normal text-gray-500">
              {note.context_label}
            </span>
          )}
        </p>

        {!disabled && (
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => {
                setDraft(note.content);
                setEditing((open) => !open);
              }}
              aria-label="Edit note"
              className="rounded p-1 text-amber-700 hover:bg-amber-100"
            >
              <PencilIcon className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(note.id)}
              aria-label="Delete note"
              className="rounded p-1 text-red-600 hover:bg-red-50"
            >
              <TrashIcon className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="mt-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={4}
            maxLength={VALIDATION.NOTE_MAX}
            aria-label="Edit note content"
            className="w-full resize-y rounded-md border border-amber-300 bg-white px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <div className="mt-1.5 flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(note.content);
              }}
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
          {note.content}
        </p>
      )}
    </li>
  );
}

export default function NotesPanel({
  projectId = null,
  taskId = null,
  customerId = null,
  timeline = false,
  title = 'Notes',
  disabled = false,
  onChanged,
}) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [draft, setDraft] = useState('');
  const [source, setSource] = useState('note');
  const [occurredOn, setOccurredOn] = useState(getLondonDateKey());
  const [showDetail, setShowDetail] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [fullScreen, setFullScreen] = useState(false);

  const abortRef = useRef(null);
  // One ref per textarea. A shared ref broke focus on leaving full screen: the
  // dialog's textarea unmounts a render after the page one mounts, and nulls it.
  const pageTextareaRef = useRef(null);
  const dialogTextareaRef = useRef(null);
  // Where the cursor goes once React has written a programmatic edit; setting
  // the value from code otherwise drops it at the end of the text.
  const pendingCaretRef = useRef(null);
  // Set only by opening or closing full screen, so nothing grabs focus on load.
  const focusRequestRef = useRef(false);

  useLayoutEffect(() => {
    const caret = pendingCaretRef.current;
    const el = (fullScreen ? dialogTextareaRef : pageTextareaRef).current;
    if (caret === null || !el) return;
    pendingCaretRef.current = null;
    el.setSelectionRange(caret, caret);
    if (caret === el.value.length) el.scrollTop = el.scrollHeight;
  }, [draft, fullScreen]);

  // The composer textarea swaps between the page and the full-screen dialog,
  // so the one that has just mounted takes focus with the cursor at the end.
  useEffect(() => {
    if (!focusRequestRef.current) return undefined;
    focusRequestRef.current = false;
    const frame = requestAnimationFrame(() => {
      const el = (fullScreen ? dialogTextareaRef : pageTextareaRef).current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [fullScreen]);

  function toggleFullScreen(open) {
    focusRequestRef.current = true;
    setFullScreen(open);
  }

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const data = timeline && customerId
        ? await apiClient.getCustomerTimeline(customerId)
        : (await apiClient.getNotes(projectId, taskId, customerId))?.data || [];

      if (controller.signal.aborted) return;
      setNotes(Array.isArray(data) ? data : []);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError('Failed to load notes.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [projectId, taskId, customerId, timeline]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  async function create() {
    const content = withoutTrailingEmptyStamps(draft).trim();
    if (!content || creating || disabled) return;

    setCreating(true);
    setCreateError(null);
    try {
      // Midday London, so a backdated note cannot land on the previous day
      // through a timezone offset.
      const occurredAt = `${occurredOn}T12:00:00Z`;

      await apiClient.createNote({
        content,
        project_id: projectId || undefined,
        task_id: taskId || undefined,
        customer_id: customerId || undefined,
        source,
        occurred_at: occurredAt,
      });

      setDraft('');
      setSource('note');
      setOccurredOn(getLondonDateKey());
      setShowDetail(false);
      // Back to the page, where the saved note now shows in the list.
      if (fullScreen) toggleFullScreen(false);
      await load();
      onChanged?.();
    } catch (err) {
      // Keep the typed text so it can be retried rather than retyped.
      setCreateError(err.message || 'Failed to add note.');
    } finally {
      setCreating(false);
    }
  }

  async function edit(noteId, updates) {
    await apiClient.updateNote(noteId, updates);
    await load();
    onChanged?.();
  }

  async function remove(noteId) {
    await apiClient.deleteNote(noteId);
    setNotes((prev) => prev.filter((note) => note.id !== noteId));
    onChanged?.();
  }

  function handleKeyDown(event) {
    if (event.key !== 'Enter') return;

    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      create();
      return;
    }

    // Enter starts a new line with a date and time stamp, for long sessions
    // where the note's own date says nothing about when each point was made.
    // Shift plus Enter is a plain line break. Leave Enter alone mid-composition
    // (an input method choosing characters), or the choice is lost.
    if (event.shiftKey || event.altKey || event.nativeEvent.isComposing) return;

    event.preventDefault();
    const el = event.currentTarget;
    const result = insertStampedLine(
      el.value,
      el.selectionStart,
      el.selectionEnd,
      noteLineStamp(),
      VALIDATION.NOTE_MAX
    );
    if (!result) return;
    pendingCaretRef.current = result.caret;
    setDraft(result.value);
  }

  const canCreate = withoutTrailingEmptyStamps(draft).trim() !== '';

  function renderComposer(inDialog) {
    return (
      <div className={inDialog ? 'flex min-h-0 flex-1 flex-col' : 'mb-3'}>
        <textarea
          ref={inDialog ? dialogTextareaRef : pageTextareaRef}
          value={draft}
          onChange={(event) => {
            // The first line is stamped as soon as it gets any text, typed or pasted.
            setDraft(stampFirstLine(draft, event.target.value, noteLineStamp()));
            if (createError) setCreateError(null);
          }}
          onKeyDown={handleKeyDown}
          rows={inDialog ? undefined : 3}
          maxLength={VALIDATION.NOTE_MAX}
          placeholder="Add a note. Each new line gets a date and time. Shift plus Enter for a line without one. Cmd or Ctrl plus Enter to save."
          aria-label="New note"
          disabled={creating}
          data-autofocus={inDialog ? true : undefined}
          className={cn(
            'w-full rounded-md border border-gray-200 px-3 py-2 placeholder-gray-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50',
            inDialog
              ? 'min-h-0 flex-1 resize-none bg-white text-base leading-relaxed'
              : 'resize-y bg-gray-50 text-sm'
          )}
        />

        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowDetail((open) => !open)}
            aria-expanded={showDetail}
            className="text-xs text-gray-500 underline hover:text-gray-700"
          >
            {showDetail ? 'Hide details' : 'Date and source'}
          </button>

          {showDetail && (
            <>
              <label className="sr-only" htmlFor="note-occurred-on">
                When it happened
              </label>
              <input
                id="note-occurred-on"
                type="date"
                value={occurredOn}
                onChange={(event) => setOccurredOn(event.target.value)}
                className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700"
              />
              <label className="sr-only" htmlFor="note-source">
                How it arrived
              </label>
              <select
                id="note-source"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700"
              >
                {SOURCES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </>
          )}

          <button
            type="button"
            onClick={create}
            disabled={!canCreate || creating}
            className={cn(
              'ml-auto rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {creating ? 'Adding…' : 'Add note'}
          </button>
        </div>

        {createError && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {createError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-700">
          {title} ({notes.length})
        </h3>
        {!disabled && (
          <button
            type="button"
            onClick={() => toggleFullScreen(true)}
            aria-label="Write full screen"
            title="Write full screen"
            className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            <ArrowsPointingOutIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* One draft, two places to write it. While full screen is open the
          page copy is not rendered, so there is only ever one textarea. */}
      {!disabled && !fullScreen && renderComposer(false)}

      <Dialog
        open={!disabled && fullScreen}
        onClose={() => toggleFullScreen(false)}
        className="relative z-50"
      >
        <DialogPanel className="fixed inset-0 flex flex-col bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 sm:px-8">
            <DialogTitle className="text-sm font-semibold text-gray-700">New note</DialogTitle>
            <button
              type="button"
              onClick={() => toggleFullScreen(false)}
              aria-label="Exit full screen"
              title="Exit full screen (Esc)"
              className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            >
              <ArrowsPointingInIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col px-4 py-4 sm:px-8">
            {renderComposer(true)}
          </div>
        </DialogPanel>
      </Dialog>

      {loading && <p className="py-4 text-center text-xs text-gray-400">Loading…</p>}

      {!loading && error && (
        <div className="py-4 text-center">
          <p className="text-sm text-red-600">{error}</p>
          <button
            type="button"
            onClick={load}
            className="mt-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && (
        notes.length === 0 ? (
          <p className="py-4 text-center text-xs italic text-gray-400">
            No notes yet.
          </p>
        ) : (
          <ul className="space-y-2 overflow-y-auto">
            {notes.map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                onEdit={edit}
                onDelete={remove}
                disabled={disabled}
              />
            ))}
          </ul>
        )
      )}
    </div>
  );
}
