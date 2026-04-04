'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { XMarkIcon, TrashIcon } from '@heroicons/react/24/outline';
import { format, parseISO } from 'date-fns';
import { PROJECT_STATUS, STATE } from '@/lib/constants';
import { getStatusClasses } from '@/lib/styleUtils';
import { quickPickOptions, toDateInputValue } from '@/lib/dateUtils';
import { useApiClient } from '@/hooks/useApiClient';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = [
  PROJECT_STATUS.OPEN,
  PROJECT_STATUS.IN_PROGRESS,
  PROJECT_STATUS.ON_HOLD,
  PROJECT_STATUS.COMPLETED,
  PROJECT_STATUS.CANCELLED,
];

/** Human-readable label for each task STATE value used in the summary. */
const STATE_LABELS = {
  [STATE.TODAY]: 'today',
  [STATE.THIS_WEEK]: 'this week',
  [STATE.BACKLOG]: 'backlog',
  [STATE.WAITING]: 'waiting',
};

function buildTaskSummary(tasks) {
  if (!tasks || tasks.length === 0) return 'No active tasks';
  const counts = {
    [STATE.TODAY]: 0,
    [STATE.THIS_WEEK]: 0,
    [STATE.BACKLOG]: 0,
    [STATE.WAITING]: 0,
  };
  for (const task of tasks) {
    if (counts[task.state] !== undefined) counts[task.state]++;
  }
  const parts = [];
  if (counts[STATE.TODAY] > 0) parts.push(`${counts[STATE.TODAY]} ${STATE_LABELS[STATE.TODAY]}`);
  if (counts[STATE.THIS_WEEK] > 0) parts.push(`${counts[STATE.THIS_WEEK]} ${STATE_LABELS[STATE.THIS_WEEK]}`);
  if (counts[STATE.BACKLOG] > 0) parts.push(`${counts[STATE.BACKLOG]} ${STATE_LABELS[STATE.BACKLOG]}`);
  if (counts[STATE.WAITING] > 0) parts.push(`${counts[STATE.WAITING]} ${STATE_LABELS[STATE.WAITING]}`);
  return parts.length > 0 ? parts.join(', ') : 'No active tasks';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * A labelled field row — matches the pattern in TaskDetailDrawer.
 */
function FieldRow({ label, htmlFor, children }) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-xs font-medium uppercase tracking-wide text-gray-400 mb-1"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProjectDetailDrawer
// ---------------------------------------------------------------------------

/**
 * Slide-in side panel for viewing and editing a project's details.
 *
 * Each field saves independently on blur by calling:
 *   onUpdate(projectId, { fieldName: newValue })
 *
 * Status saves immediately on change (no blur required).
 *
 * @param {{
 *   project: object | null,
 *   isOpen: boolean,
 *   onClose: () => void,
 *   onUpdate: (projectId: string, updates: object) => void,
 *   onDelete: (projectId: string) => void,
 *   tasks: object[],
 * }} props
 */
export default function ProjectDetailDrawer({ project, isOpen, onClose, onUpdate, onDelete, tasks = [] }) {
  const api = useApiClient();

  // Local field state — initialised from project prop when drawer opens
  const [name, setName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [area, setArea] = useState('');
  const [stakeholders, setStakeholders] = useState('');

  // Notes state
  const [notes, setNotes] = useState([]);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [noteError, setNoteError] = useState(null);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);

  // Delete confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const nameInputRef = useRef(null);
  const prevProjectIdRef = useRef(null);

  // Sync local state whenever the project prop changes
  useEffect(() => {
    if (!project) return;

    setName(project.name ?? '');
    setIsEditingName(false);
    setDescription(project.description ?? '');
    setStatus(project.status ?? PROJECT_STATUS.OPEN);
    setDueDate(toDateInputValue(project.due_date));
    setArea(project.area ?? '');
    // Stakeholders can be an array or a comma-separated string
    const rawStakeholders = project.stakeholders;
    if (Array.isArray(rawStakeholders)) {
      setStakeholders(rawStakeholders.join(', '));
    } else {
      setStakeholders(rawStakeholders ?? '');
    }

    setNotes([]);
    setNewNoteContent('');
    setNoteError(null);
    setShowDeleteConfirm(false);

    // Only fetch notes when the project changes
    if (project.id !== prevProjectIdRef.current) {
      prevProjectIdRef.current = project.id;
      fetchNotes(project.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  const fetchNotes = useCallback(async (projectId) => {
    setIsLoadingNotes(true);
    const { data, error } = await api.notes.list({ projectId });
    setIsLoadingNotes(false);
    if (!error && data) {
      setNotes(data);
    }
  }, [api.notes]);

  // ---------------------------------------------------------------------------
  // Save helpers — each field calls onUpdate on blur
  // ---------------------------------------------------------------------------

  const saveField = useCallback(
    (field, value) => {
      if (!project) return;
      onUpdate(project.id, { [field]: value });
    },
    [project, onUpdate]
  );

  const handleNameBlur = useCallback(() => {
    setIsEditingName(false);
    const trimmed = name.trim();
    if (trimmed && trimmed !== project?.name) {
      saveField('name', trimmed);
    } else {
      setName(project?.name ?? '');
    }
  }, [name, project, saveField]);

  const handleDescriptionBlur = useCallback(() => {
    if (description !== (project?.description ?? '')) {
      saveField('description', description);
    }
  }, [description, project, saveField]);

  const handleStatusChange = useCallback(
    (e) => {
      const value = e.target.value;
      setStatus(value);
      saveField('status', value);
    },
    [saveField]
  );

  const handleDueDateBlur = useCallback(() => {
    if (dueDate !== toDateInputValue(project?.due_date)) {
      saveField('due_date', dueDate || null);
    }
  }, [dueDate, project, saveField]);

  const handleAreaBlur = useCallback(() => {
    if (area !== (project?.area ?? '')) {
      saveField('area', area);
    }
  }, [area, project, saveField]);

  const handleStakeholdersBlur = useCallback(() => {
    // Normalise: split by comma, trim each, filter empty
    const parsed = stakeholders
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const originalArray = Array.isArray(project?.stakeholders)
      ? project.stakeholders
      : (project?.stakeholders ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const hasChanged = JSON.stringify(parsed) !== JSON.stringify(originalArray);
    if (hasChanged) {
      saveField('stakeholders', parsed);
    }
  }, [stakeholders, project, saveField]);

  // ---------------------------------------------------------------------------
  // Notes
  // ---------------------------------------------------------------------------

  const handleAddNote = useCallback(async () => {
    const content = newNoteContent.trim();
    if (!content || !project) return;

    setIsSavingNote(true);
    setNoteError(null);

    const { data, error } = await api.notes.create({
      content,
      project_id: project.id,
      task_id: null,
    });

    setIsSavingNote(false);

    if (error) {
      setNoteError(error);
    } else if (data) {
      setNotes((prev) => [...prev, data]);
      setNewNoteContent('');
    }
  }, [newNoteContent, project, api.notes]);

  const handleNoteKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddNote();
      }
      if (e.key === 'Escape') {
        setNewNoteContent('');
        setNoteError(null);
      }
    },
    [handleAddNote]
  );

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  const handleDeleteConfirm = useCallback(async () => {
    if (!project) return;
    setIsDeleting(true);
    try {
      await onDelete(project.id);
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  }, [project, onDelete]);

  // ---------------------------------------------------------------------------
  // Render guards
  // ---------------------------------------------------------------------------

  if (!project) return null;

  const statusClasses = getStatusClasses(status);
  const taskSummary = buildTaskSummary(tasks);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-50">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20" aria-hidden="true" />

      {/* Drawer panel */}
      <div className="fixed inset-y-0 right-0 flex w-full justify-end sm:max-w-md">
        <DialogPanel className="flex h-full w-full flex-col bg-white shadow-2xl ring-1 ring-gray-900/5 overflow-hidden">

          {/* ----------------------------------------------------------------
              Header
          ---------------------------------------------------------------- */}
          <div className="flex items-start gap-3 border-b border-gray-100 px-4 py-4 flex-shrink-0">
            <div className="min-w-0 flex-1">
              {isEditingName ? (
                <input
                  ref={nameInputRef}
                  id="drawer-project-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={handleNameBlur}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') nameInputRef.current?.blur();
                    if (e.key === 'Escape') {
                      setName(project.name ?? '');
                      setIsEditingName(false);
                    }
                  }}
                  className="w-full rounded border border-indigo-300 px-2 py-1 text-base font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  aria-label="Project name"
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditingName(true)}
                  className="w-full text-left text-base font-semibold text-gray-900 hover:text-indigo-700 focus:outline-none focus-visible:underline leading-snug"
                  aria-label="Edit project name"
                >
                  <DialogTitle as="span">{name || 'Untitled project'}</DialogTitle>
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="mt-0.5 shrink-0 rounded-md p-1 text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              aria-label="Close drawer"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          {/* ----------------------------------------------------------------
              Status badge
          ---------------------------------------------------------------- */}
          <div className="flex items-center gap-2 px-4 pt-3 pb-1 flex-shrink-0">
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusClasses}`}
            >
              {status}
            </span>
          </div>

          {/* ----------------------------------------------------------------
              Scrollable body
          ---------------------------------------------------------------- */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

            {/* Description */}
            <FieldRow label="Description" htmlFor="drawer-project-description">
              <textarea
                id="drawer-project-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={handleDescriptionBlur}
                rows={3}
                placeholder="Add a description…"
                className="w-full resize-y rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                aria-label="Project description"
              />
            </FieldRow>

            {/* Status */}
            <FieldRow label="Status" htmlFor="drawer-project-status">
              <select
                id="drawer-project-status"
                value={status}
                onChange={handleStatusChange}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
                aria-label="Project status"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </FieldRow>

            {/* Due date */}
            <FieldRow label="Due date" htmlFor="drawer-project-due-date">
              <input
                id="drawer-project-due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                onBlur={handleDueDateBlur}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                aria-label="Project due date"
              />
              {/* Quick picks */}
              <div className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Quick date picks">
                {quickPickOptions.map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => {
                      const val = opt.getValue();
                      setDueDate(val);
                      saveField('due_date', val);
                    }}
                    className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 transition-colors"
                  >
                    {opt.label}
                  </button>
                ))}
                {dueDate && (
                  <button
                    type="button"
                    onClick={() => {
                      setDueDate('');
                      saveField('due_date', null);
                    }}
                    className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-600 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
            </FieldRow>

            {/* Area */}
            <FieldRow label="Area" htmlFor="drawer-project-area">
              <input
                id="drawer-project-area"
                type="text"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                onBlur={handleAreaBlur}
                placeholder="e.g. Marketing, Engineering…"
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                aria-label="Project area"
              />
            </FieldRow>

            {/* Stakeholders */}
            <FieldRow label="Stakeholders" htmlFor="drawer-project-stakeholders">
              <input
                id="drawer-project-stakeholders"
                type="text"
                value={stakeholders}
                onChange={(e) => setStakeholders(e.target.value)}
                onBlur={handleStakeholdersBlur}
                placeholder="Comma-separated names…"
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                aria-label="Stakeholders"
              />
              {/* Display stakeholders as pills */}
              {stakeholders.trim() && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {stakeholders.split(',').map((s) => s.trim()).filter(Boolean).map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </FieldRow>

            {/* ----------------------------------------------------------------
                Task summary (read-only)
            ---------------------------------------------------------------- */}
            <div>
              <p className="block text-xs font-medium uppercase tracking-wide text-gray-400 mb-1">
                Tasks
              </p>
              <p className="text-sm text-gray-700">{taskSummary}</p>
            </div>

            {/* ----------------------------------------------------------------
                Notes
            ---------------------------------------------------------------- */}
            <div>
              <p className="block text-xs font-medium uppercase tracking-wide text-gray-400 mb-2">
                Notes
              </p>

              {/* Existing notes */}
              {isLoadingNotes ? (
                <p className="text-xs text-gray-400 italic">Loading notes…</p>
              ) : notes.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No notes yet.</p>
              ) : (
                <div className="mb-2 max-h-48 overflow-y-auto space-y-0.5 pr-1">
                  {notes.map((note) => (
                    <div key={note.id} className="py-0.5 px-1.5 rounded-md">
                      <p className="text-[0.7rem] leading-snug text-gray-700 whitespace-pre-wrap">
                        <span className="text-gray-500">
                          {format(new Date(note.created_at), 'EEEE, MMM do, h:mm a')}:
                        </span>{' '}
                        {note.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Add note input */}
              <input
                id="drawer-project-new-note"
                type="text"
                value={newNoteContent}
                onChange={(e) => {
                  setNewNoteContent(e.target.value);
                  if (noteError) setNoteError(null);
                }}
                onKeyDown={handleNoteKeyDown}
                disabled={isSavingNote}
                placeholder="Add a note… (Enter to save)"
                aria-label="New note"
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-800 placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-60 disabled:bg-gray-50"
              />
              {noteError && (
                <p className="mt-1 text-xs text-red-500" role="alert">
                  {noteError}
                </p>
              )}
            </div>

            {/* ----------------------------------------------------------------
                Metadata
            ---------------------------------------------------------------- */}
            <div className="pt-2 border-t border-gray-100 space-y-1">
              {project.created_at && (
                <p className="text-xs text-gray-400">
                  Created:{' '}
                  <span className="text-gray-500">
                    {format(parseISO(project.created_at), 'EEE, MMM do yyyy')}
                  </span>
                </p>
              )}
              {project.updated_at && (
                <p className="text-xs text-gray-400">
                  Updated:{' '}
                  <span className="text-gray-500">
                    {format(parseISO(project.updated_at), 'EEE, MMM do yyyy, h:mm a')}
                  </span>
                </p>
              )}
            </div>

            {/* ----------------------------------------------------------------
                Delete section
            ---------------------------------------------------------------- */}
            <div className="pt-2 border-t border-gray-100">
              {showDeleteConfirm ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 space-y-3">
                  <p className="text-sm font-medium text-red-800">Delete project?</p>
                  <p className="text-xs text-red-700">
                    This cannot be undone. Tasks will remain but will become unassigned.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleDeleteConfirm}
                      disabled={isDeleting}
                      className="flex-1 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                    >
                      {isDeleting ? 'Deleting…' : 'Yes, delete'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={isDeleting}
                      className="flex-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 transition-colors"
                >
                  <TrashIcon className="h-4 w-4" />
                  Delete project
                </button>
              )}
            </div>
          </div>
          {/* end scrollable body */}

        </DialogPanel>
      </div>
    </Dialog>
  );
}
