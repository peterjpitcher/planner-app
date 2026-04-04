'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { apiClient } from '@/lib/apiClient';
import { sanitizeInput } from '@/lib/validators';

const MAX_LENGTH = 255;
const CHAR_COUNT_THRESHOLD = 200;

/**
 * QuickCapture — floating input for rapid task/idea capture.
 *
 * Keyboard shortcuts:
 *   Enter          → create task in Backlog
 *   Shift+Enter    → create task in Today > Good to Do
 *   "! " prefix    → create an Idea (exclamation + space, then title)
 */
export default function QuickCapture() {
  const [isOpen, setIsOpen] = useState(false);
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState(null); // { type: 'success'|'error', message: string }
  const inputRef = useRef(null);
  const flashTimerRef = useRef(null);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Clean up flash timer on unmount
  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  const showFlash = useCallback((type, message) => {
    setFlash({ type, message });
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlash(null), 2500);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setValue('');
    setFlash(null);
  }, []);

  const handleKeyDown = useCallback(
    async (e) => {
      // Close on Escape
      if (e.key === 'Escape') {
        handleClose();
        return;
      }

      if (e.key !== 'Enter') return;

      e.preventDefault();

      const raw = value.trim();
      if (!raw || submitting) return;

      const sanitized = sanitizeInput(raw);
      if (!sanitized) return;

      setSubmitting(true);
      setFlash(null);

      try {
        // "! " prefix → create Idea (bare "!" without a following space is treated normally)
        if (sanitized.startsWith('! ')) {
          const title = sanitized.slice(2).trim();
          if (!title) {
            showFlash('error', 'Idea title cannot be empty');
            setSubmitting(false);
            return;
          }
          await apiClient.createIdea({ title });
          showFlash('success', 'Idea captured');
        } else if (e.shiftKey) {
          // Shift+Enter → Today > Good to Do
          await apiClient.createTask({ name: sanitized, state: 'today', today_section: 'good_to_do' });
          showFlash('success', 'Added to Today');
        } else {
          // Enter → Backlog
          await apiClient.createTask({ name: sanitized, state: 'backlog' });
          showFlash('success', 'Task captured');
        }

        setValue('');
      } catch (err) {
        showFlash('error', err?.message || 'Something went wrong');
      } finally {
        setSubmitting(false);
        // Re-focus after submission so the user can keep typing
        requestAnimationFrame(() => {
          if (inputRef.current) inputRef.current.focus();
        });
      }
    },
    [value, submitting, showFlash, handleClose]
  );

  const isIdea = value.startsWith('! ');
  const charCount = value.length;
  const showCharCount = charCount > CHAR_COUNT_THRESHOLD;
  const atLimit = charCount >= MAX_LENGTH;

  return (
    <>
      {/* Floating action button — always visible */}
      <button
        type="button"
        aria-label={isOpen ? 'Close quick capture' : 'Open quick capture'}
        onClick={() => (isOpen ? handleClose() : setIsOpen(true))}
        className={`
          fixed bottom-6 right-6 z-50
          flex h-14 w-14 items-center justify-center
          rounded-full shadow-lg
          transition-all duration-200
          focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0496c7]/60
          ${isOpen
            ? 'bg-[#052a3b] text-white hover:bg-[#063347]'
            : 'bg-[#0496c7] text-white hover:bg-[#0382ac]'
          }
        `}
      >
        {isOpen ? (
          <XMarkIcon className="h-6 w-6" aria-hidden="true" />
        ) : (
          <PlusIcon className="h-6 w-6" aria-hidden="true" />
        )}
      </button>

      {/* Capture panel */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Quick capture"
          className="
            fixed bottom-24 right-6 z-40
            w-[min(22rem,calc(100vw-3rem))]
            rounded-2xl border border-[#0496c7]/20
            bg-white shadow-lg
            p-4
          "
        >
          {/* Flash message */}
          {flash && (
            <div
              role="status"
              aria-live="polite"
              className={`
                mb-3 rounded-xl px-3 py-2 text-xs font-medium
                ${flash.type === 'success'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-rose-50 text-rose-600'
                }
              `}
            >
              {flash.message}
            </div>
          )}

          {/* Input */}
          <div className="relative">
            <label htmlFor="quick-capture-input" className="sr-only">
              Capture a task or idea
            </label>
            <input
              id="quick-capture-input"
              ref={inputRef}
              type="text"
              placeholder={isIdea ? 'Idea title…' : 'Capture a task…'}
              value={value}
              maxLength={MAX_LENGTH}
              disabled={submitting}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="
                w-full rounded-xl border border-[#0496c7]/25
                bg-white px-4 py-2.5 pr-16
                text-sm text-[#052a3b]
                shadow-inner shadow-[#0496c7]/10
                placeholder:text-[#2f617a]/60
                focus:border-[#0496c7] focus:outline-none focus:ring-2 focus:ring-[#0496c7]/30
                disabled:cursor-not-allowed disabled:opacity-60
              "
              aria-describedby="quick-capture-hint"
            />

            {/* Character count — only shown when approaching limit */}
            {showCharCount && (
              <span
                aria-live="polite"
                className={`
                  absolute right-3 top-1/2 -translate-y-1/2
                  text-xs tabular-nums
                  ${atLimit ? 'text-rose-500 font-semibold' : 'text-[#2f617a]/60'}
                `}
              >
                {MAX_LENGTH - charCount}
              </span>
            )}
          </div>

          {/* Mode indicator */}
          {isIdea && (
            <p className="mt-1.5 text-xs font-medium text-violet-600">
              Idea mode — enter a title and press Enter
            </p>
          )}

          {/* Keyboard hint */}
          <p
            id="quick-capture-hint"
            className="mt-2 text-[11px] leading-tight text-[#2f617a]/50"
          >
            Enter&nbsp;= Backlog&nbsp;·&nbsp;Shift+Enter&nbsp;= Today&nbsp;·&nbsp;!&nbsp;= Idea
          </p>
        </div>
      )}
    </>
  );
}
