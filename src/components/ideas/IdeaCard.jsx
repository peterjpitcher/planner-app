'use client';

import React, { useState } from 'react';
import { Menu } from '@headlessui/react';
import {
  EllipsisVerticalIcon,
  ArrowUpCircleIcon,
  TrashIcon,
} from '@heroicons/react/20/solid';
import { IDEA_STATE } from '@/lib/constants';
import { format, parseISO } from 'date-fns';

// ---------------------------------------------------------------------------
// Area badge
// ---------------------------------------------------------------------------

function AreaBadge({ area }) {
  if (!area) return null;
  return (
    <span className="inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
      {area}
    </span>
  );
}

// ---------------------------------------------------------------------------
// IdeaCard
// ---------------------------------------------------------------------------

/**
 * Single idea card supporting Captured, Exploring, and Ready Later states.
 *
 * @param {{
 *   idea: object,
 *   onUpdate: (id: string, updates: object) => Promise<void>,
 *   onPromote: (id: string) => Promise<void>,
 *   onDelete: (id: string) => Promise<void>,
 * }} props
 */
export default function IdeaCard({ idea, onUpdate, onPromote, onDelete }) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPromoting, setIsPromoting] = useState(false);

  // Local editable field state — only used in Exploring mode
  const [whyItMatters, setWhyItMatters] = useState(idea.why_it_matters ?? '');
  const [smallestStep, setSmallestStep] = useState(idea.smallest_step ?? '');
  const [area, setArea] = useState(idea.area ?? '');

  const isExploring = idea.idea_state === IDEA_STATE.EXPLORING;
  const isReadyLater = idea.idea_state === IDEA_STATE.READY_LATER;

  // Format created date subtly
  const createdLabel = idea.created_at
    ? format(parseISO(idea.created_at), 'MMM d')
    : null;

  // Format review date for Ready Later
  const reviewLabel = idea.review_date
    ? format(parseISO(idea.review_date), 'MMM d, yyyy')
    : null;

  // -------------------------------------------------------------------------
  // Blur save handlers (for Exploring state inline edits)
  // -------------------------------------------------------------------------

  function handleWhyItMattersBlur() {
    if (whyItMatters !== (idea.why_it_matters ?? '')) {
      onUpdate(idea.id, { why_it_matters: whyItMatters });
    }
  }

  function handleSmallestStepBlur() {
    if (smallestStep !== (idea.smallest_step ?? '')) {
      onUpdate(idea.id, { smallest_step: smallestStep });
    }
  }

  function handleAreaBlur() {
    if (area !== (idea.area ?? '')) {
      onUpdate(idea.id, { area });
    }
  }

  // -------------------------------------------------------------------------
  // Action handlers
  // -------------------------------------------------------------------------

  async function handlePromote() {
    if (isPromoting) return;
    setIsPromoting(true);
    try {
      await onPromote(idea.id);
    } finally {
      setIsPromoting(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete idea "${idea.title}"? This cannot be undone.`)) return;
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await onDelete(idea.id);
    } finally {
      setIsDeleting(false);
    }
  }

  function handleMoveToExploring() {
    onUpdate(idea.id, { idea_state: IDEA_STATE.EXPLORING });
  }

  function handleMoveToReadyLater() {
    onUpdate(idea.id, { idea_state: IDEA_STATE.READY_LATER });
  }

  function handleMoveToCaptured() {
    onUpdate(idea.id, { idea_state: IDEA_STATE.CAPTURED });
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div
      className={[
        'group relative rounded-lg border bg-white px-3 py-3 text-sm shadow-sm transition-shadow duration-150 hover:shadow-md',
        isExploring ? 'border-indigo-200' : 'border-gray-200',
        isReadyLater ? 'border-green-200' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Header row: title + menu */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-gray-800 leading-snug">{idea.title || 'Untitled idea'}</p>
        </div>

        {/* Action menu */}
        <Menu as="div" className="relative shrink-0">
          <Menu.Button
            type="button"
            className="rounded p-0.5 text-gray-300 opacity-0 transition-opacity group-hover:opacity-100 hover:text-gray-600 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            aria-label="Idea actions"
          >
            <EllipsisVerticalIcon className="h-4 w-4" />
          </Menu.Button>

          <Menu.Items className="absolute right-0 z-10 mt-1 w-52 origin-top-right rounded-md border border-gray-200 bg-white py-1 shadow-lg focus:outline-none">
            {/* State changes */}
            {!isExploring && (
              <Menu.Item>
                {({ active }) => (
                  <button
                    type="button"
                    onClick={handleMoveToExploring}
                    className={`w-full px-3 py-1.5 text-left text-sm ${
                      active ? 'bg-gray-50 text-gray-900' : 'text-gray-700'
                    }`}
                  >
                    Move to Exploring
                  </button>
                )}
              </Menu.Item>
            )}

            {!isReadyLater && (
              <Menu.Item>
                {({ active }) => (
                  <button
                    type="button"
                    onClick={handleMoveToReadyLater}
                    className={`w-full px-3 py-1.5 text-left text-sm ${
                      active ? 'bg-gray-50 text-gray-900' : 'text-gray-700'
                    }`}
                  >
                    Move to Ready Later
                  </button>
                )}
              </Menu.Item>
            )}

            {(isExploring || isReadyLater) && (
              <Menu.Item>
                {({ active }) => (
                  <button
                    type="button"
                    onClick={handleMoveToCaptured}
                    className={`w-full px-3 py-1.5 text-left text-sm ${
                      active ? 'bg-gray-50 text-gray-900' : 'text-gray-700'
                    }`}
                  >
                    Move to Captured
                  </button>
                )}
              </Menu.Item>
            )}

            <div className="my-1 border-t border-gray-100" role="separator" />

            {/* Promote to Task */}
            <Menu.Item>
              {({ active }) => (
                <button
                  type="button"
                  onClick={handlePromote}
                  disabled={isPromoting}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                    active ? 'bg-indigo-50 text-indigo-800' : 'text-indigo-700'
                  } disabled:opacity-50`}
                >
                  <ArrowUpCircleIcon className="h-4 w-4 shrink-0" />
                  {isPromoting ? 'Promoting…' : 'Promote to Task'}
                </button>
              )}
            </Menu.Item>

            <div className="my-1 border-t border-gray-100" role="separator" />

            {/* Delete */}
            <Menu.Item>
              {({ active }) => (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                    active ? 'bg-red-50 text-red-800' : 'text-red-600'
                  } disabled:opacity-50`}
                >
                  <TrashIcon className="h-4 w-4 shrink-0" />
                  {isDeleting ? 'Deleting…' : 'Delete'}
                </button>
              )}
            </Menu.Item>
          </Menu.Items>
        </Menu>
      </div>

      {/* Area badge — shown in all states when area is set */}
      {idea.area && !isExploring && (
        <div className="mt-1.5">
          <AreaBadge area={idea.area} />
        </div>
      )}

      {/* Exploring: editable prompts */}
      {isExploring && (
        <div className="mt-3 space-y-3">
          {/* Area (editable) */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
              Area
            </label>
            <input
              type="text"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              onBlur={handleAreaBlur}
              placeholder="e.g. Marketing, Product…"
              className="w-full rounded border border-gray-200 bg-gray-50 px-2 py-1 text-sm text-gray-800 placeholder-gray-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </div>

          {/* Why it matters */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
              Why it matters
            </label>
            <textarea
              value={whyItMatters}
              onChange={(e) => setWhyItMatters(e.target.value)}
              onBlur={handleWhyItMattersBlur}
              placeholder="What problem does this solve?"
              rows={2}
              className="w-full resize-none rounded border border-gray-200 bg-gray-50 px-2 py-1 text-sm text-gray-800 placeholder-gray-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </div>

          {/* Smallest step */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
              Smallest next step
            </label>
            <textarea
              value={smallestStep}
              onChange={(e) => setSmallestStep(e.target.value)}
              onBlur={handleSmallestStepBlur}
              placeholder="What's the one small action to move this forward?"
              rows={2}
              className="w-full resize-none rounded border border-gray-200 bg-gray-50 px-2 py-1 text-sm text-gray-800 placeholder-gray-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </div>
        </div>
      )}

      {/* Ready Later: show review date if set */}
      {isReadyLater && reviewLabel && (
        <p className="mt-1.5 text-xs text-green-600">Review: {reviewLabel}</p>
      )}

      {/* Created date — shown subtly at bottom */}
      {createdLabel && (
        <p className="mt-2 text-right text-xs text-gray-300">{createdLabel}</p>
      )}
    </div>
  );
}
