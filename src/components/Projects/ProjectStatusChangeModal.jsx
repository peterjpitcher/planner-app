'use client';

import { Fragment, useState, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { ExclamationTriangleIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { PROJECT_STATUS } from '@/lib/constants';
import { formatDate } from '@/lib/dateUtils';
import { cn } from '@/lib/utils';

/**
 * Confirmation for closing a project (Completed or Cancelled).
 *
 * Closing a project cascades to its open tasks, so the user has to see exactly
 * which tasks are about to change, by name, before committing. A count alone is
 * not enough to check against: "3 open tasks" gives no way to spot that one of
 * them was the thing you actually still needed.
 *
 * Replaces ProjectCompletionModal, which showed only a count, only ever fired
 * for Completed, and had become unreachable dead code.
 */

const COPY = {
  [PROJECT_STATUS.COMPLETED]: {
    title: 'Complete project',
    verb: 'completed',
    Icon: CheckCircleIcon,
    iconClass: 'text-green-600',
    iconBg: 'bg-green-100',
    confirmClass: 'bg-green-600 hover:bg-green-500 focus-visible:outline-green-600',
    taskEffect: 'will be marked done',
    confirmLabel: (n) => (n > 0 ? `Complete project and ${n} task${n === 1 ? '' : 's'}` : 'Complete project'),
  },
  [PROJECT_STATUS.CANCELLED]: {
    title: 'Cancel project',
    verb: 'cancelled',
    Icon: XCircleIcon,
    iconClass: 'text-red-600',
    iconBg: 'bg-red-100',
    confirmClass: 'bg-red-600 hover:bg-red-500 focus-visible:outline-red-600',
    taskEffect: 'will be cancelled',
    confirmLabel: (n) => (n > 0 ? `Cancel project and ${n} task${n === 1 ? '' : 's'}` : 'Cancel project'),
  },
};

export default function ProjectStatusChangeModal({
  isOpen,
  onClose,
  onConfirm,
  projectName,
  targetStatus,
  previousStatus,
  openTasks,
  reopeningTasks,
  loading = false,
  submitting = false,
  customerName = null,
  error = null,
  impactError = null,
  onRetry,
}) {
  const isReopening = [PROJECT_STATUS.COMPLETED, PROJECT_STATUS.CANCELLED].includes(previousStatus)
    && ![PROJECT_STATUS.COMPLETED, PROJECT_STATUS.CANCELLED].includes(targetStatus);
  const copy = isReopening ? {
    title: 'Reopen project', verb: 'reopened', Icon: CheckCircleIcon,
    iconClass: 'text-indigo-600', iconBg: 'bg-indigo-100',
    confirmClass: 'bg-indigo-600 hover:bg-indigo-500 focus-visible:outline-indigo-600',
    taskEffect: 'will return to Backlog',
    confirmLabel: () => 'Reopen project',
  } : COPY[targetStatus];

  const tasks = (isReopening ? reopeningTasks : openTasks) || [];

  // Close-out capture. Asked on EVERY close, Completed or Cancelled, with no
  // setting to turn it off: what you know at the moment you finish something is
  // exactly what gets lost, and a project that has gone quiet is the one you
  // will not come back to and write up later.
  const [closeoutNote, setCloseoutNote] = useState('');
  const [factLabel, setFactLabel] = useState('');
  const [factValue, setFactValue] = useState('');

  // Reset between openings, so last time's text is never submitted against a
  // different project.
  useEffect(() => {
    if (isOpen) {
      setCloseoutNote('');
      setFactLabel('');
      setFactValue('');
    }
  }, [isOpen]);

  function confirm() {
    const facts = factLabel.trim() && factValue.trim()
      ? [{ label: factLabel.trim(), value: factValue.trim() }]
      : [];
    onConfirm({ closeoutNote: closeoutNote.trim() || null, facts });
  }
  if (!copy) return null;

  const taskCount = tasks.length;
  const { Icon } = copy;

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={submitting ? () => {} : onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-900/25 backdrop-blur-sm transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 sm:items-center sm:p-0">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200" enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-150" leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative w-full transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:max-w-lg sm:p-6">
                <div className="sm:flex sm:items-start">
                  <div className={cn('mx-auto flex h-12 w-12 shrink-0 items-center justify-center rounded-full sm:mx-0 sm:h-10 sm:w-10', copy.iconBg)}>
                    <Icon className={cn('h-6 w-6', copy.iconClass)} aria-hidden="true" />
                  </div>
                  <div className="mt-3 min-w-0 flex-1 text-center sm:ml-4 sm:mt-0 sm:text-left">
                    <Dialog.Title as="h3" className="text-base font-semibold text-gray-900">
                      {copy.title}
                    </Dialog.Title>
                    <p className="mt-1 text-sm text-gray-500">
                      &ldquo;{projectName}&rdquo; will be marked {copy.verb}.
                    </p>
                    {/* Office 365 sync only mirrors active projects, so closing
                        one deletes its Microsoft To Do list. That is by design
                        but was never said anywhere, and it is not reversible by
                        reopening the project: the list comes back empty of any
                        history the user had added on the Outlook side. */}
                    {!isReopening && (
                      <p className="mt-1 text-sm text-gray-500">
                        Its Microsoft To Do list will be removed from Outlook. Your tasks stay here.
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4">
                  {impactError ? (
                    <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                      <p>{impactError}</p>
                      <button type="button" onClick={onRetry} className="mt-2 underline">Retry impact check</button>
                    </div>
                  ) : loading ? (
                    <p className="text-sm text-gray-500">Checking for open tasks...</p>
                  ) : taskCount === 0 ? (
                    <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">
                      {isReopening ? 'No tasks will be reopened. Completed tasks stay done.' : 'This project has no open tasks.'}
                    </p>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-gray-900">
                        {taskCount} {isReopening ? 'cancelled' : 'open'} task{taskCount === 1 ? '' : 's'} {copy.taskEffect}:
                      </p>
                      <ul className="mt-2 max-h-56 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200">
                        {tasks.map((task) => (
                          <li key={task.id} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
                            <span className="min-w-0 break-words text-gray-700">{task.name}</span>
                            {task.due_date && (
                              <span className="shrink-0 text-xs text-gray-400">
                                {formatDate(task.due_date, 'd MMM')}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-xs text-gray-500">
                        {isReopening ? 'Completed tasks stay done. Project notes return to this project.' : 'They will leave Today, the Plan board and your daily email.'}
                        {targetStatus === PROJECT_STATUS.CANCELLED
                          ? ' Reopening the project returns them to the backlog.'
                          : ''}
                      </p>
                    </>
                  )}
                </div>

                {/* Close-out capture, on every close. */}
                {!isReopening && !loading && !impactError && <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <label
                    htmlFor="closeout-note"
                    className="block text-sm font-medium text-gray-700"
                  >
                    {targetStatus === PROJECT_STATUS.CANCELLED
                      ? 'Anything worth remembering about why this stopped?'
                      : 'Anything worth remembering about this?'}
                  </label>
                  <textarea
                    id="closeout-note"
                    rows={3}
                    value={closeoutNote}
                    onChange={(event) => setCloseoutNote(event.target.value)}
                    disabled={submitting}
                    placeholder="Optional. Leave it blank and nothing is written."
                    className="mt-1.5 w-full resize-y rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-60"
                  />

                  {customerName ? (
                    <>
                      <p className="mt-1.5 text-xs text-gray-500">
                        This will be pinned to <strong>{customerName}</strong>, and every note
                        on this project moves onto their record. Reopening brings them back.
                      </p>

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <div>
                          <label htmlFor="closeout-fact-label" className="sr-only">
                            Key fact label
                          </label>
                          <input
                            id="closeout-fact-label"
                            type="text"
                            value={factLabel}
                            onChange={(event) => setFactLabel(event.target.value)}
                            disabled={submitting}
                            placeholder="Key fact (optional)"
                            className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                          />
                        </div>
                        <div>
                          <label htmlFor="closeout-fact-value" className="sr-only">
                            Key fact value
                          </label>
                          <input
                            id="closeout-fact-value"
                            type="text"
                            value={factValue}
                            onChange={(event) => setFactValue(event.target.value)}
                            disabled={submitting}
                            placeholder="Value"
                            className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="mt-1.5 text-xs text-amber-700">
                      This project has no customer, so any notes stay on the project and this
                      one is pinned to it. Set a customer to keep them on a customer record.
                    </p>
                  )}
                </div>}

                {error && (
                  <div className="mt-3 flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                    <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="mt-5 gap-2 sm:mt-4 sm:flex sm:flex-row-reverse">
                  <button
                    type="button"
                    disabled={loading || submitting || Boolean(impactError)}
                    onClick={confirm}
                    className={cn(
                      'inline-flex w-full justify-center rounded-md px-3 py-2 text-sm font-semibold text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 sm:w-auto',
                      copy.confirmClass,
                      (loading || submitting || impactError) && 'cursor-not-allowed opacity-60'
                    )}
                  >
                    {submitting ? 'Saving...' : copy.confirmLabel(taskCount)}
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={onClose}
                    className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-60 sm:mt-0 sm:w-auto"
                  >
                    Keep as is
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
