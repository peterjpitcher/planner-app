'use client';

import { Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { ExclamationTriangleIcon, CheckCircleIcon } from '@heroicons/react/24/outline';

export default function ProjectCompletionModal({
  isOpen,
  onClose,
  onConfirmCompleteTasks,
  projectName,
  openTasksCount,
}) {
  if (!isOpen) return null;

  const hasOpenTasks = openTasksCount > 0;

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-10" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-900 bg-opacity-10 backdrop-blur-sm transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative transform rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6 max-h-[80vh] sm:max-h-[90vh] overflow-y-auto flex flex-col">
                <div className="flex-grow">
                  <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${hasOpenTasks ? 'bg-yellow-100' : 'bg-green-100'}`}>
                    {hasOpenTasks ? (
                      <ExclamationTriangleIcon className="h-6 w-6 text-yellow-600" aria-hidden="true" />
                    ) : (
                      <CheckCircleIcon className="h-6 w-6 text-green-600" aria-hidden="true" />
                    )}
                  </div>
                  <div className="mt-3 text-center sm:mt-5">
                    <Dialog.Title as="h3" className="text-lg font-semibold leading-6 text-gray-900">
                      {hasOpenTasks ? <>Complete Project &quot;{projectName}&quot;?</> : <>Confirm Project Completion</>}
                    </Dialog.Title>
                    <div className="mt-2">
                      {hasOpenTasks ? (
                        <p className="text-sm text-gray-500">
                          This project has {openTasksCount} open task{openTasksCount > 1 ? 's' : ''}. 
                          To mark the project as completed, all open tasks must also be completed. Proceed?
                        </p>
                      ) : (
                        <p className="text-sm text-gray-500">
                          Are you sure you want to mark project &quot;{projectName}&quot; as completed?
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                <div className={`mt-5 sm:mt-6 flex-shrink-0 ${hasOpenTasks ? 'grid grid-flow-row-dense grid-cols-1 sm:grid-cols-2 gap-3' : 'flex flex-col-reverse sm:flex-row-reverse sm:gap-3' }`}>
                  <button
                    type="button"
                    className={`inline-flex w-full justify-center rounded-md px-3 py-2 text-sm font-semibold text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 
                                ${hasOpenTasks ? 'bg-green-600 hover:bg-green-500 focus-visible:outline-green-600 sm:col-start-2' 
                                              : 'bg-indigo-600 hover:bg-indigo-500 focus-visible:outline-indigo-600'}`}
                    onClick={onConfirmCompleteTasks}
                  >
                    {hasOpenTasks ? 'Yes, complete tasks & project' : 'Yes, complete project'}
                  </button>
                  <button
                    type="button"
                    className={`mt-3 sm:mt-0 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 
                                ${hasOpenTasks ? 'sm:col-start-1' : ''}` }
                    onClick={onClose}
                  >
                    Cancel
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