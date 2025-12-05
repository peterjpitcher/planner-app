import React, { useState, useEffect } from 'react';
import { Dialog } from '@headlessui/react';
import { CalendarDaysIcon } from '@heroicons/react/24/outline';

export default function ChaseTaskModal({ isOpen, onClose, onConfirm, taskName }) {
  const durations = [
    { label: '1 Day', days: 1 },
    { label: '2 Days', days: 2 },
    { label: '3 Days', days: 3 },
    { label: '1 Week', days: 7 },
    { label: '2 Weeks', days: 14 },
    { label: '1 Month', days: 30 },
    { label: '3 Months', days: 90 },
  ];

  const handleDurationClick = (days) => {
    onConfirm(days);
  };

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" />

      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="mx-auto max-w-sm rounded-xl bg-white p-6 shadow-xl ring-1 ring-gray-900/5 w-full">
          <div className="flex items-center gap-4 mb-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 sm:h-10 sm:w-10">
              <CalendarDaysIcon className="h-6 w-6 text-indigo-600" aria-hidden="true" />
            </div>
            <Dialog.Title className="text-lg font-medium leading-6 text-gray-900">
              Chase Task
            </Dialog.Title>
          </div>

          <div className="mt-2">
            <p className="text-sm text-gray-500 mb-4">
              This will add a "Chased" note and push the due date for:
              <br />
              <span className="font-medium text-gray-700">"{taskName}"</span>
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {durations.map((duration) => (
                <button
                  key={duration.label}
                  type="button"
                  className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                  onClick={() => handleDurationClick(duration.days)}
                >
                  {duration.label}
                </button>
              ))}
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
                onClick={onClose}
              >
                Cancel
              </button>
            </div>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
