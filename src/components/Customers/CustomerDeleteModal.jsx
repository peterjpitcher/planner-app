// src/components/Customers/CustomerDeleteModal.jsx
'use client';

import { Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

/**
 * Confirmation for removing a customer record.
 *
 * The wording matters and is deliberate. "Delete customer" reads as "erase
 * everything on this page", and the customer page is a roll-up: it shows work
 * that belongs to projects and tasks, not to the customer. Those survive. Only
 * the customer record itself goes, and the link from each project and task is
 * cleared.
 *
 * Counts are therefore shown as what happens to each thing, not as one merged
 * number, because a merged number would imply the projects go too.
 */
export default function CustomerDeleteModal({
  isOpen,
  onClose,
  onConfirm,
  customerName,
  impact,
  loading = false,
  submitting = false,
  error = null,
}) {
  const projects = impact?.projects ?? 0;
  const tasks = impact?.tasks ?? 0;

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={submitting ? () => {} : onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-900/25 backdrop-blur-sm transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 sm:items-center sm:p-0">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative w-full transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:max-w-lg sm:p-6">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
                    <ExclamationTriangleIcon className="h-5 w-5 text-red-600" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <Dialog.Title className="text-base font-semibold text-gray-900">
                      Remove {customerName}?
                    </Dialog.Title>

                    {loading ? (
                      <p className="mt-2 text-sm text-gray-500">Checking what this affects…</p>
                    ) : (
                      <div className="mt-2 space-y-2 text-sm text-gray-600">
                        <p>
                          This removes the customer record. It does not delete their work.
                        </p>
                        <ul className="space-y-1 rounded-md bg-gray-50 p-3 text-sm">
                          <li>
                            <strong>{projects}</strong> project{projects === 1 ? '' : 's'} will be
                            kept and become unassigned.
                          </li>
                          <li>
                            <strong>{tasks}</strong> task{tasks === 1 ? '' : 's'} will be kept and
                            lose their customer.
                          </li>
                        </ul>
                        <p className="text-xs text-gray-500">
                          If you only want them out of the way, archive instead. Archiving is
                          reversible and keeps the link.
                        </p>
                      </div>
                    )}

                    {error && (
                      <p role="alert" className="mt-2 text-sm text-red-600">
                        {error}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={submitting}
                    className="rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={onConfirm}
                    disabled={submitting || loading}
                    className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting ? 'Removing…' : 'Remove record'}
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
