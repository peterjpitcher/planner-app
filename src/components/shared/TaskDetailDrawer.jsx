'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { XMarkIcon, LinkIcon } from '@heroicons/react/24/outline';
import { format, parseISO } from 'date-fns';
import ChipBadge from './ChipBadge';
import { STATE, TASK_TYPE, CHIP_VALUES } from '@/lib/constants';
import { quickPickOptions, toDateInputValue } from '@/lib/dateUtils';
import { useApiClient } from '@/hooks/useApiClient';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Human-readable label for each STATE value. */
const STATE_LABELS = {
  [STATE.TODAY]: 'Today',
  [STATE.THIS_WEEK]: 'This Week',
  [STATE.BACKLOG]: 'Backlog',
  [STATE.WAITING]: 'Waiting',
  [STATE.DONE]: 'Done',
};

/** Tailwind classes for state badge colours. */
const STATE_BADGE_CLASSES = {
  [STATE.TODAY]: 'bg-indigo-100 text-indigo-700',
  [STATE.THIS_WEEK]: 'bg-blue-100 text-blue-700',
  [STATE.BACKLOG]: 'bg-gray-100 text-gray-600',
  [STATE.WAITING]: 'bg-amber-100 text-amber-700',
  [STATE.DONE]: 'bg-green-100 text-green-700',
};

/** Human-readable label for each TASK_TYPE value. */
const TASK_TYPE_LABELS = {
  [TASK_TYPE.ADMIN]: 'Admin',
  [TASK_TYPE.REPLY_CHASE]: 'Reply / Chase',
  [TASK_TYPE.FIX]: 'Fix',
  [TASK_TYPE.PLANNING]: 'Planning',
  [TASK_TYPE.CONTENT]: 'Content',
  [TASK_TYPE.DEEP_WORK]: 'Deep Work',
  [TASK_TYPE.PERSONAL]: 'Personal',
};

/** All available chip values in display order. */
const ALL_CHIPS = Object.values(CHIP_VALUES);

/** CHIP_CONFIG mirrors the config in ChipBadge — needed for toggle pill styling. */
const CHIP_CONFIG = {
  high_impact: { label: 'High impact', activeClass: 'bg-red-100 text-red-700 border-red-300', inactiveClass: 'border-gray-200 text-gray-500 hover:border-red-200 hover:text-red-600' },
  urgent: { label: 'Urgent', activeClass: 'bg-orange-100 text-orange-700 border-orange-300', inactiveClass: 'border-gray-200 text-gray-500 hover:border-orange-200 hover:text-orange-600' },
  blocks_others: { label: 'Blocks others', activeClass: 'bg-purple-100 text-purple-700 border-purple-300', inactiveClass: 'border-gray-200 text-gray-500 hover:border-purple-200 hover:text-purple-600' },
  stress_relief: { label: 'Stress relief', activeClass: 'bg-teal-100 text-teal-700 border-teal-300', inactiveClass: 'border-gray-200 text-gray-500 hover:border-teal-200 hover:text-teal-600' },
  only_i_can: { label: 'Only I can', activeClass: 'bg-indigo-100 text-indigo-700 border-indigo-300', inactiveClass: 'border-gray-200 text-gray-500 hover:border-indigo-200 hover:text-indigo-600' },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * A labelled field row used throughout the drawer.
 * Renders a <label> above the provided children.
 */
function FieldRow({ label, htmlFor, children, helpText }) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-xs font-medium uppercase tracking-wide text-gray-400 mb-1"
      >
        {label}
      </label>
      {children}
      {helpText && (
        <p id={helpText.id} className="mt-0.5 text-xs text-gray-400">
          {helpText.text}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TaskDetailDrawer
// ---------------------------------------------------------------------------

/**
 * Slide-in side panel for viewing and editing a task's details.
 *
 * Each field saves independently on blur by calling:
 *   onUpdate(taskId, { fieldName: newValue })
 *
 * Notes are created via the notes API and appended to local state.
 *
 * @param {{
 *   task: object | null,
 *   isOpen: boolean,
 *   onClose: () => void,
 *   onUpdate: (taskId: string, updates: object) => void,
 * }} props
 */
export default function TaskDetailDrawer({ task, isOpen, onClose, onUpdate }) {
  const api = useApiClient();

  // Local field state — initialised from task prop when drawer opens
  const [name, setName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [description, setDescription] = useState('');
  const [area, setArea] = useState('');
  const [taskType, setTaskType] = useState('');
  const [chips, setChips] = useState([]);
  const [dueDate, setDueDate] = useState('');
  const [waitingReason, setWaitingReason] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');

  // Notes state
  const [notes, setNotes] = useState([]);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [noteError, setNoteError] = useState(null);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);

  const nameInputRef = useRef(null);
  const prevTaskIdRef = useRef(null);

  // Sync local state whenever the task prop changes (or drawer opens with a new task)
  useEffect(() => {
    if (!task) return;

    setName(task.name ?? '');
    setIsEditingName(false);
    setDescription(task.description ?? '');
    setArea(task.area ?? '');
    setTaskType(task.task_type ?? '');
    setChips(Array.isArray(task.chips) ? task.chips : []);
    setDueDate(toDateInputValue(task.due_date));
    setWaitingReason(task.waiting_reason ?? '');
    setFollowUpDate(toDateInputValue(task.follow_up_date));
    setNotes([]);
    setNewNoteContent('');
    setNoteError(null);

    // Only fetch notes when the task changes
    if (task.id !== prevTaskIdRef.current) {
      prevTaskIdRef.current = task.id;
      fetchNotes(task.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task]);

  const fetchNotes = useCallback(async (taskId) => {
    setIsLoadingNotes(true);
    const { data, error } = await api.notes.list({ taskId });
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
      if (!task) return;
      onUpdate(task.id, { [field]: value });
    },
    [task, onUpdate]
  );

  const handleNameBlur = useCallback(() => {
    setIsEditingName(false);
    const trimmed = name.trim();
    if (trimmed && trimmed !== task?.name) {
      saveField('name', trimmed);
    } else {
      // Revert to original if blank
      setName(task?.name ?? '');
    }
  }, [name, task, saveField]);

  const handleDescriptionBlur = useCallback(() => {
    if (description !== (task?.description ?? '')) {
      saveField('description', description);
    }
  }, [description, task, saveField]);

  const handleAreaBlur = useCallback(() => {
    if (area !== (task?.area ?? '')) {
      saveField('area', area);
    }
  }, [area, task, saveField]);

  const handleTaskTypeChange = useCallback(
    (e) => {
      const value = e.target.value;
      setTaskType(value);
      saveField('task_type', value);
    },
    [saveField]
  );

  const handleChipToggle = useCallback(
    (chip) => {
      const next = chips.includes(chip)
        ? chips.filter((c) => c !== chip)
        : [...chips, chip];
      setChips(next);
      saveField('chips', next);
    },
    [chips, saveField]
  );

  const handleDueDateBlur = useCallback(() => {
    if (dueDate !== toDateInputValue(task?.due_date)) {
      saveField('due_date', dueDate || null);
    }
  }, [dueDate, task, saveField]);

  const handleWaitingReasonBlur = useCallback(() => {
    if (waitingReason !== (task?.waiting_reason ?? '')) {
      saveField('waiting_reason', waitingReason);
    }
  }, [waitingReason, task, saveField]);

  const handleFollowUpDateBlur = useCallback(() => {
    if (followUpDate !== toDateInputValue(task?.follow_up_date)) {
      saveField('follow_up_date', followUpDate || null);
    }
  }, [followUpDate, task, saveField]);

  // ---------------------------------------------------------------------------
  // Notes
  // ---------------------------------------------------------------------------

  const handleAddNote = useCallback(async () => {
    const content = newNoteContent.trim();
    if (!content || !task) return;

    setIsSavingNote(true);
    setNoteError(null);

    const { data, error } = await api.notes.create({
      content,
      task_id: task.id,
      project_id: null,
    });

    setIsSavingNote(false);

    if (error) {
      setNoteError(error);
    } else if (data) {
      setNotes((prev) => [...prev, data]);
      setNewNoteContent('');
    }
  }, [newNoteContent, task, api.notes]);

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
  // Render guards
  // ---------------------------------------------------------------------------

  if (!task) return null;

  const isWaiting = task.state === STATE.WAITING;
  const stateBadgeClass = STATE_BADGE_CLASSES[task.state] ?? 'bg-gray-100 text-gray-600';

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
                  id="drawer-task-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={handleNameBlur}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') nameInputRef.current?.blur();
                    if (e.key === 'Escape') {
                      setName(task.name ?? '');
                      setIsEditingName(false);
                    }
                  }}
                  className="w-full rounded border border-indigo-300 px-2 py-1 text-base font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  aria-label="Task name"
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditingName(true)}
                  className="w-full text-left text-base font-semibold text-gray-900 hover:text-indigo-700 focus:outline-none focus-visible:underline leading-snug"
                  aria-label="Edit task name"
                >
                  <DialogTitle as="span">{name || 'Untitled task'}</DialogTitle>
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
              State badge
          ---------------------------------------------------------------- */}
          <div className="flex items-center gap-2 px-4 pt-3 pb-1 flex-shrink-0">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${stateBadgeClass}`}
            >
              {STATE_LABELS[task.state] ?? task.state}
            </span>
            {task.today_section && (
              <span className="text-xs text-gray-400">
                {task.today_section.replace('_', ' ')}
              </span>
            )}
          </div>

          {/* ----------------------------------------------------------------
              Scrollable body
          ---------------------------------------------------------------- */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

            {/* Description */}
            <FieldRow label="Description" htmlFor="drawer-description">
              <textarea
                id="drawer-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={handleDescriptionBlur}
                rows={3}
                placeholder="Add a description…"
                className="w-full resize-y rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                aria-label="Task description"
              />
            </FieldRow>

            {/* Area */}
            <FieldRow label="Area" htmlFor="drawer-area">
              <input
                id="drawer-area"
                type="text"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                onBlur={handleAreaBlur}
                placeholder="e.g. Marketing, Engineering…"
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                aria-label="Task area"
              />
            </FieldRow>

            {/* Task type */}
            <FieldRow label="Task type" htmlFor="drawer-task-type">
              <select
                id="drawer-task-type"
                value={taskType}
                onChange={handleTaskTypeChange}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
                aria-label="Task type"
              >
                <option value="">— None —</option>
                {Object.entries(TASK_TYPE).map(([key, value]) => (
                  <option key={key} value={value}>
                    {TASK_TYPE_LABELS[value] ?? value}
                  </option>
                ))}
              </select>
            </FieldRow>

            {/* Chips */}
            <FieldRow label="Tags">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Task tags">
                {ALL_CHIPS.map((chip) => {
                  const config = CHIP_CONFIG[chip];
                  if (!config) return null;
                  const isActive = chips.includes(chip);
                  return (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => handleChipToggle(chip)}
                      aria-pressed={isActive}
                      className={[
                        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                        isActive ? config.activeClass : config.inactiveClass,
                      ].join(' ')}
                    >
                      {config.label}
                    </button>
                  );
                })}
              </div>
            </FieldRow>

            {/* Due date */}
            <FieldRow label="Due date" htmlFor="drawer-due-date">
              <input
                id="drawer-due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                onBlur={handleDueDateBlur}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                aria-label="Task due date"
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

            {/* Waiting fields — only shown when state is 'waiting' */}
            {isWaiting && (
              <>
                <FieldRow label="Waiting reason" htmlFor="drawer-waiting-reason">
                  <input
                    id="drawer-waiting-reason"
                    type="text"
                    value={waitingReason}
                    onChange={(e) => setWaitingReason(e.target.value)}
                    onBlur={handleWaitingReasonBlur}
                    placeholder="What are you waiting on?"
                    className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    aria-label="Waiting reason"
                  />
                </FieldRow>

                <FieldRow label="Follow-up date" htmlFor="drawer-follow-up-date">
                  <input
                    id="drawer-follow-up-date"
                    type="date"
                    value={followUpDate}
                    onChange={(e) => setFollowUpDate(e.target.value)}
                    onBlur={handleFollowUpDateBlur}
                    className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    aria-label="Follow-up date"
                  />
                </FieldRow>
              </>
            )}

            {/* Project association (read-only) */}
            {task.project_name && (
              <FieldRow label="Project">
                <p className="text-sm text-gray-700">{task.project_name}</p>
              </FieldRow>
            )}

            {/* Promoted from idea */}
            {task.source_idea_id && (
              <div className="flex items-center gap-1.5 rounded-md bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
                <LinkIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Promoted from idea</span>
              </div>
            )}

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
                id="drawer-new-note"
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
              {task.created_at && (
                <p className="text-xs text-gray-400">
                  Created:{' '}
                  <span className="text-gray-500">
                    {format(parseISO(task.created_at), 'EEE, MMM do yyyy')}
                  </span>
                </p>
              )}
              {task.updated_at && (
                <p className="text-xs text-gray-400">
                  Updated:{' '}
                  <span className="text-gray-500">
                    {format(parseISO(task.updated_at), 'EEE, MMM do yyyy, h:mm a')}
                  </span>
                </p>
              )}
            </div>
          </div>
          {/* end scrollable body */}

        </DialogPanel>
      </div>
    </Dialog>
  );
}
