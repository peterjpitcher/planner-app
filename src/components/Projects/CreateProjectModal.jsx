'use client';

import { useState, useCallback, useRef } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { PROJECT_STATUS } from '@/lib/constants';
import { quickPickOptions } from '@/lib/dateUtils';
import { apiClient } from '@/lib/apiClient';

// ---------------------------------------------------------------------------
// CreateProjectModal
// ---------------------------------------------------------------------------

/**
 * Centered modal for creating a new project.
 *
 * @param {{
 *   isOpen: boolean,
 *   onClose: () => void,
 *   onCreated: () => void,
 * }} props
 */
export default function CreateProjectModal({ isOpen, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [area, setArea] = useState('');
  const [status, setStatus] = useState(PROJECT_STATUS.OPEN);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const nameInputRef = useRef(null);

  const STATUS_OPTIONS = [
    PROJECT_STATUS.OPEN,
    PROJECT_STATUS.IN_PROGRESS,
    PROJECT_STATUS.ON_HOLD,
  ];

  const resetForm = useCallback(() => {
    setName('');
    setDescription('');
    setDueDate('');
    setArea('');
    setStatus(PROJECT_STATUS.OPEN);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    resetForm();
    onClose();
  }, [isSubmitting, resetForm, onClose]);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Project name is required.');
      nameInputRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await apiClient.createProject({
        name: trimmedName,
        description: description.trim() || null,
        due_date: dueDate || null,
        area: area.trim() || null,
        status,
      });
      resetForm();
      onCreated();
    } catch (err) {
      setError(err.message || 'Failed to create project. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [name, description, dueDate, area, status, resetForm, onCreated]);

  return (
    <Dialog open={isOpen} onClose={handleClose} className="relative z-50">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" />

      {/* Centered modal */}
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-md rounded-xl bg-white shadow-2xl ring-1 ring-gray-900/5 overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <DialogTitle className="text-base font-semibold text-gray-900">
              New Project
            </DialogTitle>
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="rounded-md p-1 text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
              aria-label="Close modal"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} noValidate>
            <div className="px-5 py-4 space-y-4">

              {/* Error banner */}
              {error && (
                <div
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                  role="alert"
                >
                  {error}
                </div>
              )}

              {/* Name (required) */}
              <div>
                <label
                  htmlFor="create-project-name"
                  className="block text-xs font-medium uppercase tracking-wide text-gray-400 mb-1"
                >
                  Name <span className="text-red-500 normal-case tracking-normal">*</span>
                </label>
                <input
                  ref={nameInputRef}
                  id="create-project-name"
                  type="text"
                  value={name}
                  onChange={(e) => { setName(e.target.value); if (error) setError(null); }}
                  placeholder="Project name…"
                  maxLength={255}
                  required
                  disabled={isSubmitting}
                  autoFocus
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-60 disabled:bg-gray-50"
                  aria-label="Project name"
                />
              </div>

              {/* Description */}
              <div>
                <label
                  htmlFor="create-project-description"
                  className="block text-xs font-medium uppercase tracking-wide text-gray-400 mb-1"
                >
                  Description
                </label>
                <textarea
                  id="create-project-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="Optional description…"
                  maxLength={1000}
                  disabled={isSubmitting}
                  className="w-full resize-y rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-60 disabled:bg-gray-50"
                  aria-label="Project description"
                />
              </div>

              {/* Status */}
              <div>
                <label
                  htmlFor="create-project-status"
                  className="block text-xs font-medium uppercase tracking-wide text-gray-400 mb-1"
                >
                  Status
                </label>
                <select
                  id="create-project-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white disabled:opacity-60"
                  aria-label="Project status"
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              {/* Due date */}
              <div>
                <label
                  htmlFor="create-project-due-date"
                  className="block text-xs font-medium uppercase tracking-wide text-gray-400 mb-1"
                >
                  Due date
                </label>
                <input
                  id="create-project-due-date"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-60"
                  aria-label="Project due date"
                />
                {/* Quick picks */}
                <div className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Quick date picks">
                  {quickPickOptions.map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => setDueDate(opt.getValue())}
                      className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 transition-colors disabled:opacity-50"
                    >
                      {opt.label}
                    </button>
                  ))}
                  {dueDate && (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => setDueDate('')}
                      className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-600 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 transition-colors disabled:opacity-50"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Area */}
              <div>
                <label
                  htmlFor="create-project-area"
                  className="block text-xs font-medium uppercase tracking-wide text-gray-400 mb-1"
                >
                  Area
                </label>
                <input
                  id="create-project-area"
                  type="text"
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  placeholder="e.g. Marketing, Engineering…"
                  maxLength={255}
                  disabled={isSubmitting}
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-60 disabled:bg-gray-50"
                  aria-label="Project area"
                />
              </div>
            </div>

            {/* Footer actions */}
            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3 bg-gray-50">
              <button
                type="button"
                onClick={handleClose}
                disabled={isSubmitting}
                className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!name.trim() || isSubmitting}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                {isSubmitting ? 'Creating…' : 'Create project'}
              </button>
            </div>
          </form>

        </DialogPanel>
      </div>
    </Dialog>
  );
}
