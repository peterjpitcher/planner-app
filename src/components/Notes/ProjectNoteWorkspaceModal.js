'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { VALIDATION } from '@/lib/constants';
import { apiClient } from '@/lib/apiClient';
import NoteList from './NoteList';
import QuickTaskForm from '@/components/Tasks/QuickTaskForm';
import { format } from 'date-fns';
import { XMarkIcon } from '@heroicons/react/24/outline';

/**
 * Modal workspace for capturing detailed project notes and quick tasks.
 */
export default function ProjectNoteWorkspaceModal({
  isOpen,
  onClose,
  project,
  notes,
  onNoteSaved,
  onTaskSubmit,
  onTaskComplete,
  isLoadingNotes = false,
  noteCreationDisabled = false,
  openTasks = [],
}) {
  const [noteContent, setNoteContent] = useState('');
  const [noteError, setNoteError] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [completingTaskId, setCompletingTaskId] = useState(null);
  const [taskError, setTaskError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setNoteContent('');
      setNoteError('');
      setSaveSuccess(false);
      setTaskError('');
      setCompletingTaskId(null);
    }
  }, [isOpen]);

  const projectName = project?.name || 'Project';
  const projectId = project?.id;

  const remainingCharacters = useMemo(() => {
    return VALIDATION.NOTE_MAX - noteContent.length;
  }, [noteContent.length]);

  const handleNoteSave = useCallback(async (closeAfterSave = false) => {
    if (isSavingNote || noteCreationDisabled) {
      if (noteCreationDisabled) {
        setNoteError('Notes are locked for this project.');
      }
      return;
    }
    const trimmedContent = noteContent.trim();
    if (!trimmedContent) {
      setNoteError('Add a bit more detail before saving.');
      return;
    }
    if (!projectId) {
      setNoteError('Project reference missing.');
      return;
    }

    setIsSavingNote(true);
    setNoteError('');
    setSaveSuccess(false);

    try {
      const savedNote = await apiClient.createNote({
        content: trimmedContent,
        project_id: projectId,
      });
      if (onNoteSaved) {
        onNoteSaved(savedNote);
      }
      setNoteContent('');
      setSaveSuccess(true);
      if (closeAfterSave) {
        onClose?.();
      }
    } catch (error) {
      setNoteError(error?.message || 'Could not save that note.');
    } finally {
      setIsSavingNote(false);
    }
  }, [isSavingNote, noteContent, projectId, onNoteSaved, onClose, noteCreationDisabled]);

  const handleKeyDown = useCallback((event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      handleNoteSave(false);
    }
  }, [handleNoteSave]);

  const handleTaskSubmit = useCallback(async (taskPayload) => {
    if (!onTaskSubmit) return;
    try {
      await onTaskSubmit(taskPayload);
      setTaskError('');
    } catch (error) {
      setTaskError(error?.message || 'Could not add that task.');
      throw error;
    }
  }, [onTaskSubmit]);

  const handleTaskComplete = useCallback(async (taskId) => {
    if (!onTaskComplete || !taskId || completingTaskId) return;
    setTaskError('');
    setCompletingTaskId(taskId);
    try {
      await onTaskComplete(taskId);
    } catch (error) {
      setTaskError(error?.message || 'Could not complete that task.');
    } finally {
      setCompletingTaskId(null);
    }
  }, [onTaskComplete, completingTaskId]);

  const formatDueDateLabel = useCallback((dueDate) => {
    if (!dueDate) return 'No due date';
    const parsed = new Date(dueDate);
    if (Number.isNaN(parsed.getTime())) return 'No due date';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (parsed < today) {
      return `Overdue • ${format(parsed, 'EEE, MMM d')}`;
    }
    return `Due ${format(parsed, 'EEE, MMM d')}`;
  }, []);

  const handleAttemptClose = useCallback(() => {
    if (noteCreationDisabled) {
      onClose?.();
      return;
    }

    if (noteContent.trim().length > 0) {
      setNoteError('Save or clear your note before closing.');
      return;
    }
    setNoteError('');
    onClose?.();
  }, [noteContent, onClose, noteCreationDisabled]);

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[80]" onClose={handleAttemptClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 z-[80] overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-2 sm:p-4 md:p-6">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative w-full max-w-[calc(100vw-1.5rem)] min-h-[calc(100vh-1.5rem)] overflow-hidden rounded-3xl bg-white shadow-2xl transition-all md:max-w-[calc(100vw-3rem)]">
                <div className="flex h-full flex-col lg:flex-row">
                  <div className="flex flex-1 flex-col overflow-hidden border-b border-slate-200 bg-slate-50/70 px-5 py-6 md:px-8 lg:border-b-0 lg:border-r">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Dialog.Title className="text-xl font-semibold text-slate-900">
                          {projectName}
                        </Dialog.Title>
                        <p className="mt-1 text-sm text-slate-500">
                          Capture detailed notes and action items while you stay focused in the meeting.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleAttemptClose}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-transparent text-slate-400 transition hover:border-slate-200 hover:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0496c7]/40"
                        aria-label="Close workspace"
                      >
                        <XMarkIcon className="h-5 w-5" />
                      </button>
                    </div>
                    <div className="mt-6 flex flex-1 flex-col overflow-hidden">
                      <div className="flex flex-col">
                        <label htmlFor="project-note-content" className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Project Notes
                        </label>
                        <textarea
                          id="project-note-content"
                          value={noteContent}
                          onChange={(event) => {
                            setNoteContent(event.target.value);
                            if (noteError) setNoteError('');
                            if (saveSuccess) setSaveSuccess(false);
                          }}
                          onKeyDown={handleKeyDown}
                          placeholder="Type everything you need to remember…"
                          className="mt-2 min-h-[14rem] flex-1 resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 shadow-inner focus:border-[#0496c7] focus:outline-none focus:ring-2 focus:ring-[#0496c7]/30"
                          maxLength={VALIDATION.NOTE_MAX}
                          disabled={isSavingNote || noteCreationDisabled}
                        />
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                          <span>{remainingCharacters} characters remaining</span>
                          <div className="flex items-center gap-2">
                            {noteCreationDisabled && (
                              <span className="text-slate-400">Project notes are read-only.</span>
                            )}
                            {noteError && <span className="text-rose-500">{noteError}</span>}
                            {saveSuccess && <span className="text-emerald-600">Saved</span>}
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleNoteSave(false)}
                            className="inline-flex items-center justify-center rounded-xl bg-[#0496c7] px-4 py-2 text-sm font-semibold text-white shadow-md shadow-[#0496c7]/25 transition hover:bg-[#0382ac] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0496c7]/40 disabled:pointer-events-none disabled:opacity-60"
                            disabled={isSavingNote || !noteContent.trim()}
                          >
                            {noteCreationDisabled ? 'Notes Locked' : isSavingNote ? 'Saving…' : 'Save Note'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleNoteSave(true)}
                            className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:border-[#0496c7]/40 hover:text-[#036586]"
                            disabled={noteCreationDisabled || isSavingNote || !noteContent.trim()}
                          >
                            {noteCreationDisabled ? 'Notes Locked' : isSavingNote ? 'Saving…' : 'Save & Close'}
                          </button>
                        <button
                          type="button"
                          onClick={handleAttemptClose}
                          className="ml-auto inline-flex items-center justify-center rounded-xl border border-transparent px-3 py-2 text-sm font-medium text-slate-400 transition hover:text-slate-600"
                          disabled={isSavingNote}
                        >
                          Close
                        </button>
                      </div>
                    </div>
                      <div className="mt-6 flex-1 overflow-y-auto">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Recent Notes
                        </h3>
                        <div className="mt-2 h-full overflow-y-auto rounded-2xl border border-slate-200 bg-white px-3 py-2">
                          {isLoadingNotes ? (
                            <p className="text-xs text-slate-400">Loading notes…</p>
                          ) : (
                            <NoteList notes={notes} />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex w-full flex-col bg-white lg:max-w-xs xl:max-w-sm 2xl:max-w-md">
                    <div className="flex-1 overflow-y-auto border-t border-slate-200 px-5 py-6 md:px-6 lg:border-t-0 lg:border-l">
                      <h3 className="text-sm font-semibold text-slate-700">
                        Open Tasks ({openTasks?.length || 0})
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        Stay on top of what still needs attention.
                      </p>
                      {taskError && (
                        <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
                          {taskError}
                        </p>
                      )}
                      <div className="mt-4 max-h-[50vh] space-y-3 overflow-y-auto pr-1">
                        {openTasks && openTasks.length > 0 ? (
                          openTasks.map((task) => (
                            <div key={task.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                              <div className="flex items-start gap-3">
                                <input
                                  type="checkbox"
                                  checked={completingTaskId === task.id}
                                  onChange={() => handleTaskComplete(task.id)}
                                  disabled={completingTaskId === task.id}
                                  className="mt-1 h-4 w-4 flex-shrink-0 cursor-pointer rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                                  aria-label={`Mark "${task.name}" complete`}
                                />
                                <div className="flex-1">
                                  <p className="text-sm font-semibold text-slate-800">{task.name}</p>
                                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                    <span>{formatDueDateLabel(task.due_date)}</span>
                                    {task.priority && (
                                      <span className="inline-flex items-center rounded-full bg-white px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-[#036586]">
                                        {task.priority}
                                      </span>
                                    )}
                                  </div>
                                  {completingTaskId === task.id && (
                                    <p className="mt-1 text-[0.65rem] font-medium uppercase tracking-wide text-emerald-600">
                                      Completing…
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-xs italic text-slate-400">All caught up—no open tasks.</p>
                        )}
                      </div>
                    </div>
                    <div className="border-t border-slate-200 px-5 py-6 md:px-6">
                      <h3 className="text-sm font-semibold text-slate-700">
                        Quick Todo Capture
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        Add follow-up tasks without leaving the meeting flow.
                      </p>
                      <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
                        <QuickTaskForm
                          onSubmit={handleTaskSubmit}
                          namePlaceholder="Add a follow-up task…"
                          buttonLabel="Add Task"
                          resetDateOnSubmit
                          priorityType="select"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
