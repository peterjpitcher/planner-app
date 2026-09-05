'use client';

import { useId, useRef, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { formatDate, toDateInputValue } from '@/lib/dateUtils';

// Native calendars report intermediate dates while browsing months. Keep those
// changes local until Save so filtering or rescheduling cannot remove the editor.
export function DatePickerDialog({ value, title = 'Choose date', min, onSave, onClose }) {
  const [draft, setDraft] = useState(() => toDateInputValue(value));
  const inputRef = useRef(null);
  const id = useId();

  function save(nextValue) {
    onClose();
    if (nextValue !== (toDateInputValue(value) || null)) onSave(nextValue);
  }

  // The native calendar is a browser popup outside DialogPanel. Its day clicks
  // can look like outside clicks, so dismiss only with Cancel or Escape.
  return (
    <Dialog
      open
      initialFocus={inputRef}
      onClose={() => {}}
      className="relative z-[70]"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="fixed inset-0 bg-gray-900/25" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
          <DialogTitle className="text-base font-semibold text-gray-900">{title}</DialogTitle>
          <p className="mt-1 text-sm text-gray-500">Choose a date, then save.</p>
          <label htmlFor={id} className="mt-4 block text-sm font-medium text-gray-700">Date</label>
          <input
            ref={inputRef}
            id={id}
            type="date"
            value={draft}
            min={min}
            onChange={(event) => setDraft(event.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <div className="mt-5 flex items-center justify-end gap-2">
            {value && (
              <button type="button" onClick={() => save(null)} className="mr-auto rounded px-2 py-1.5 text-sm text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500">
                Clear date
              </button>
            )}
            <button type="button" onClick={onClose} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { if (inputRef.current?.reportValidity()) save(draft || null); }}
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
            >
              Save date
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

export default function DatePicker({ value, onSave, title, min, children, className, disabled, id }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        id={id}
        type="button"
        aria-label={title}
        aria-haspopup="dialog"
        disabled={disabled}
        className={className}
        onClick={(event) => { event.stopPropagation(); setOpen(true); }}
      >
        {children ?? (value ? formatDate(value, 'd MMM yyyy') : 'Set date')}
      </button>
      {open && <DatePickerDialog value={value} title={title} min={min} onSave={onSave} onClose={() => setOpen(false)} />}
    </>
  );
}
