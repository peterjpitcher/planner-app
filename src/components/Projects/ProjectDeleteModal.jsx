'use client';

import { Fragment, useEffect, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { TrashIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { cn } from '@/lib/utils';

/**
 * Confirmation for deleting a project.
 *
 * This dialog used to lead with a warning that deleting a project destroyed
 * every note on it, permanently, with no undo. That was accurate:
 * notes.project_id was ON DELETE CASCADE.
 *
 * It no longer is. The notes now move to the project's customer, or become
 * unfiled when it has none, and only an explicit opt-in destroys them. So the
 * dialog's job changed with it: say what is KEPT and where it goes, and reserve
 * the warning for the one path that actually loses something.
 */
export default function ProjectDeleteModal({
  isOpen,
  onClose,
  onConfirm,
  projectName,
  taskCount = 0,
  noteCount = 0,
  customerName = null,
  loading = false,
  submitting = false,
  error = null,
}) {
  const [destroyContent, setDestroyContent] = useState(false);

  // Reset between openings so a tick on one project cannot carry to the next.
  useEffect(() => {
    if (isOpen) setDestroyContent(false);
  }, [isOpen]);
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
                  <div className="mx-auto flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                    <TrashIcon className="h-6 w-6 text-red-600" aria-hidden="true" />
                  </div>
                  <div className="mt-3 min-w-0 flex-1 text-center sm:ml-4 sm:mt-0 sm:text-left">
                    <Dialog.Title as="h3" className="text-base font-semibold text-gray-900">
                      Delete project
                    </Dialog.Title>
                    <p className="mt-1 text-sm text-gray-500">
                      &ldquo;{projectName}&rdquo; will be deleted. This cannot be undone.
                    </p>
                  </div>
                </div>

                <div className="mt-4 space-y-2 text-sm">
                  {loading ? (
                    <p className="text-gray-500">Checking what this affects...</p>
                  ) : (
                    <>
                      <div className="rounded-md bg-gray-50 px-3 py-2 text-gray-600">
                        {taskCount > 0 ? (
                          <>
                            <strong>{taskCount} open task{taskCount === 1 ? '' : 's'}</strong> will be kept
                            and moved to Unassigned.
                          </>
                        ) : (
                          'This project has no open tasks.'
                        )}
                      </div>

                      {noteCount > 0 && !destroyContent && (
                        <div className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800">
                          <strong>{noteCount} note{noteCount === 1 ? '' : 's'}</strong> will be kept
                          {customerName ? (
                            <> and moved to <strong>{customerName}</strong>&apos;s record.</>
                          ) : (
                            <>. This project has no customer, so they will be left unfiled and
                            listed on the Customers page.</>
                          )}
                        </div>
                      )}

                      {noteCount > 0 && destroyContent && (
                        <div className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-red-700">
                          <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                          <span>
                            <strong>{noteCount} note{noteCount === 1 ? '' : 's'}</strong> will be
                            permanently deleted. This cannot be undone.
                          </span>
                        </div>
                      )}

                      {noteCount === 0 && (
                        <p className="text-xs text-gray-500">This project has no notes.</p>
                      )}

                      {/* Never the default. Deleting the notes is a separate,
                          deliberate choice from deleting the project. */}
                      {noteCount > 0 && (
                        <label className="flex items-start gap-2 pt-1 text-xs text-gray-600">
                          <input
                            type="checkbox"
                            checked={destroyContent}
                            onChange={(event) => setDestroyContent(event.target.checked)}
                            disabled={submitting}
                            className="mt-0.5 rounded border-gray-300 text-red-600 focus:ring-red-500"
                          />
                          <span>Delete the notes too, rather than keeping them.</span>
                        </label>
                      )}

                      <p className="text-xs text-gray-500">
                        Its Microsoft To Do list will also be removed from Outlook.
                      </p>
                    </>
                  )}
                </div>

                {error && (
                  <div className="mt-3 flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                    <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="mt-5 gap-2 sm:mt-4 sm:flex sm:flex-row-reverse">
                  <button
                    type="button"
                    disabled={loading || submitting}
                    onClick={() => onConfirm({ destroyContent })}
                    className={cn(
                      'inline-flex w-full justify-center rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 sm:w-auto',
                      (loading || submitting) && 'cursor-not-allowed opacity-60'
                    )}
                  >
                    {submitting ? 'Deleting...' : 'Delete project'}
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={onClose}
                    className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-60 sm:mt-0 sm:w-auto"
                  >
                    Keep project
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
