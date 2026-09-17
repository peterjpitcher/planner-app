'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/20/solid';
import { apiClient } from '@/lib/apiClient';
import { createLatestGuard } from '@/lib/requestCache';
import { outlookMessageLink } from '@/lib/outlookWebLink';
import {
  FOLLOWUP_STATE,
  FOLLOWUP_DRAFT_STATUS,
  FOLLOWUP_MAILBOX,
} from '@/lib/constants';

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const MAILBOX_LABELS = {
  [FOLLOWUP_MAILBOX.ORANGE_JELLY]: 'Orange Jelly',
  [FOLLOWUP_MAILBOX.ANCHOR]: 'The Anchor',
};

const STATE_LABELS = {
  [FOLLOWUP_STATE.AWAITING_ME]: 'Waiting on you',
  [FOLLOWUP_STATE.AWAITING_THEM]: 'Waiting on them',
  [FOLLOWUP_STATE.CLOSED]: 'Done',
};

// Asking Jordan to write a draft uses 'edit_requested', the status Jordan
// already picks up each run and answers with a draft marked 'ready'. With no
// draft on the row it is a first draft; with one it is a redraft. No new status
// was needed, so neither the table nor Jordan's worklist had to change.
function hasDraft(item) {
  return Boolean(item.proposed_draft && item.proposed_draft.trim());
}

// The decisions Peter makes on a draft. 'none' and 'sent' are machine states.
function decisionOptions(item) {
  return [
    { value: FOLLOWUP_DRAFT_STATUS.READY, label: 'Draft ready to review' },
    { value: FOLLOWUP_DRAFT_STATUS.APPROVED, label: 'Approve and send' },
    {
      value: FOLLOWUP_DRAFT_STATUS.EDIT_REQUESTED,
      label: hasDraft(item) ? 'Ask Jordan to redraft with my feedback' : 'Ask Jordan to write a draft',
    },
    { value: FOLLOWUP_DRAFT_STATUS.HOLD, label: 'Hold' },
  ];
}

const DECISION_VALUES = new Set([
  FOLLOWUP_DRAFT_STATUS.READY,
  FOLLOWUP_DRAFT_STATUS.APPROVED,
  FOLLOWUP_DRAFT_STATUS.EDIT_REQUESTED,
  FOLLOWUP_DRAFT_STATUS.HOLD,
]);

const DRAFT_STATUS_BADGE = {
  [FOLLOWUP_DRAFT_STATUS.NONE]: { label: 'No draft', className: 'bg-gray-100 text-gray-500' },
  [FOLLOWUP_DRAFT_STATUS.READY]: { label: 'Draft ready', className: 'bg-indigo-100 text-indigo-700' },
  [FOLLOWUP_DRAFT_STATUS.APPROVED]: { label: 'Approved', className: 'bg-emerald-100 text-emerald-700' },
  [FOLLOWUP_DRAFT_STATUS.EDIT_REQUESTED]: { label: 'Redraft requested', className: 'bg-amber-100 text-amber-700' },
  [FOLLOWUP_DRAFT_STATUS.HOLD]: { label: 'On hold', className: 'bg-gray-100 text-gray-600' },
  [FOLLOWUP_DRAFT_STATUS.SENT]: { label: 'Sent', className: 'bg-emerald-50 text-emerald-600' },
};

function draftBadge(item) {
  if (item.draft_status === FOLLOWUP_DRAFT_STATUS.EDIT_REQUESTED && !hasDraft(item)) {
    return { label: 'Draft requested', className: 'bg-amber-100 text-amber-700' };
  }
  return DRAFT_STATUS_BADGE[item.draft_status] ?? DRAFT_STATUS_BADGE[FOLLOWUP_DRAFT_STATUS.NONE];
}

// A row can be sent to Jordan for a draft when it is still open, has no draft
// text, and is not already asked for or approved.
function canRequestDraft(item) {
  return (
    item.state !== FOLLOWUP_STATE.CLOSED &&
    !hasDraft(item) &&
    item.draft_status !== FOLLOWUP_DRAFT_STATUS.EDIT_REQUESTED &&
    item.draft_status !== FOLLOWUP_DRAFT_STATUS.APPROVED
  );
}

function OpenEmailLink({ item, className = '' }) {
  const href = outlookMessageLink(item.message_id);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open the email${item.subject ? ` "${item.subject}"` : ''} in Outlook`}
      className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-indigo-600 hover:text-indigo-800 hover:underline ${className}`}
    >
      Open email
      <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" aria-hidden="true" />
    </a>
  );
}

function formatWhen(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}

// ---------------------------------------------------------------------------
// Review panel (expanded under a row)
// ---------------------------------------------------------------------------

function ReviewPanel({ item, onSave }) {
  const [draft, setDraft] = useState(item.proposed_draft ?? '');
  const [feedback, setFeedback] = useState(item.feedback ?? '');
  const [decision, setDecision] = useState(
    DECISION_VALUES.has(item.draft_status) ? item.draft_status : ''
  );
  const [urgent, setUrgent] = useState(item.urgent === true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(item.proposed_draft ?? ''); }, [item.proposed_draft]);
  useEffect(() => { setFeedback(item.feedback ?? ''); }, [item.feedback]);
  useEffect(() => { setUrgent(item.urgent === true); }, [item.urgent]);

  const dirty =
    draft !== (item.proposed_draft ?? '') ||
    feedback !== (item.feedback ?? '') ||
    urgent !== (item.urgent === true) ||
    (decision && decision !== item.draft_status);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    const updates = { proposed_draft: draft, feedback, urgent };
    if (decision) updates.draft_status = decision;
    await onSave(item.id, updates);
    setSaving(false);
  }

  return (
    <div className="bg-gray-50 px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <label className="block text-xs font-medium text-gray-500" htmlFor={`draft-${item.id}`}>
          Proposed reply
        </label>
        <OpenEmailLink item={item} />
      </div>
      <textarea
        id={`draft-${item.id}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={5}
        placeholder="No draft yet. Choose 'Ask Jordan to write a draft' below, or write one here and approve it."
        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
      />

      <label className="mt-3 block text-xs font-medium text-gray-500" htmlFor={`feedback-${item.id}`}>
        Your feedback (a redraft uses this)
      </label>
      <textarea
        id={`feedback-${item.id}`}
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        rows={2}
        placeholder="e.g. warmer tone, and confirm Thursday works."
        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <select
          value={decision}
          onChange={(e) => setDecision(e.target.value)}
          aria-label="Decision"
          className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        >
          <option value="">No change</option>
          {decisionOptions(item).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={urgent}
            onChange={(e) => setUrgent(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-400"
          />
          Urgent
        </label>

        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="ml-auto rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {decision === FOLLOWUP_DRAFT_STATUS.APPROVED && (
        <p className="mt-2 text-xs text-emerald-700">Jordan will send this on its next run and mark it sent.</p>
      )}
      {decision === FOLLOWUP_DRAFT_STATUS.EDIT_REQUESTED && (
        <p className="mt-2 text-xs text-amber-700">
          Jordan writes it on its next run (weekday mornings), using your feedback if you gave any. It
          comes back here as Draft ready for you to approve. Nothing is sent until you do.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The list (table)
// ---------------------------------------------------------------------------

export default function FollowUpList() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const loadGuardRef = useRef(createLatestGuard());

  const load = useCallback(async (withDone) => {
    const token = loadGuardRef.current.begin();
    try {
      setError(null);
      const data = await apiClient.getFollowUps(withDone ? { includeClosed: 1 } : {});
      if (loadGuardRef.current.isStale(token)) return;
      setItems(data);
    } catch (err) {
      if (loadGuardRef.current.isStale(token)) return;
      setError(err.message || 'Failed to load follow-ups.');
    } finally {
      if (!loadGuardRef.current.isStale(token)) setLoading(false);
    }
  }, []);

  useEffect(() => { load(showDone); }, [load, showDone]);

  const handleSave = useCallback(async (id, updates) => {
    try {
      const updated = await apiClient.updateFollowUp(id, updates);
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...updated } : it)));
      return true;
    } catch (err) {
      setError(err.message || 'Failed to save.');
      return false;
    }
  }, []);

  // Mark a thread done: it moves to the "closed" state and drops off the active
  // list. Reversible from the "Show done" view.
  const handleDone = useCallback(async (id) => {
    setBusyId(id);
    try {
      const updated = await apiClient.updateFollowUp(id, { state: FOLLOWUP_STATE.CLOSED });
      setItems((prev) =>
        showDone ? prev.map((it) => (it.id === id ? { ...it, ...updated } : it)) : prev.filter((it) => it.id !== id)
      );
      if (expandedId === id) setExpandedId(null);
    } catch (err) {
      setError(err.message || 'Failed to mark done.');
    } finally {
      setBusyId(null);
    }
  }, [expandedId, showDone]);

  // Ask Jordan for a draft (or, when waiting on them, a chase). It is written on
  // Jordan's next run and comes back as 'ready'; nothing sends without approval.
  const handleRequestDraft = useCallback(async (id) => {
    setBusyId(id);
    try {
      const updated = await apiClient.updateFollowUp(id, { draft_status: FOLLOWUP_DRAFT_STATUS.EDIT_REQUESTED });
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...updated } : it)));
    } catch (err) {
      setError(err.message || 'Failed to request a draft.');
    } finally {
      setBusyId(null);
    }
  }, []);

  const handleReopen = useCallback(async (id) => {
    setBusyId(id);
    try {
      const updated = await apiClient.updateFollowUp(id, { state: FOLLOWUP_STATE.AWAITING_ME });
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...updated } : it)));
    } catch (err) {
      setError(err.message || 'Failed to reopen.');
    } finally {
      setBusyId(null);
    }
  }, []);

  // Urgent first, then waiting-on-you before waiting-on-them, then oldest first
  // (most overdue at the top). Closed rows sink to the bottom.
  const order = { [FOLLOWUP_STATE.AWAITING_ME]: 0, [FOLLOWUP_STATE.AWAITING_THEM]: 1, [FOLLOWUP_STATE.CLOSED]: 2 };
  const sorted = [...items].sort((a, b) => {
    const ao = order[a.state] ?? 9;
    const bo = order[b.state] ?? 9;
    if (ao !== bo) return ao - bo;
    if ((b.urgent ? 1 : 0) !== (a.urgent ? 1 : 0)) return (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0);
    return new Date(a.last_message_at || 0) - new Date(b.last_message_at || 0);
  });

  const awaitingMe = items.filter((i) => i.state === FOLLOWUP_STATE.AWAITING_ME).length;
  const awaitingThem = items.filter((i) => i.state === FOLLOWUP_STATE.AWAITING_THEM).length;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Follow-ups</h1>
          <p className="mt-1 text-sm text-gray-500">
            Everything waiting on a reply. Open email shows the thread in Outlook. Request draft asks
            Jordan to write a reply (or a chase) on its next weekday run; review it, approve it or
            leave feedback. Nothing sends without your approval.
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-500">
          <span><strong className="text-gray-800">{awaitingMe}</strong> waiting on you</span>
          <span><strong className="text-gray-800">{awaitingThem}</strong> waiting on them</span>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={showDone}
              onChange={(e) => setShowDone(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-400"
            />
            Show done
          </label>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-2 underline hover:no-underline focus:outline-none">
            Dismiss
          </button>
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} className="h-11 w-full animate-pulse rounded bg-gray-100" />
          ))}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="mx-auto max-w-2xl rounded-xl border border-dashed border-gray-300 px-6 py-12 text-center">
          <p className="text-base font-medium text-gray-500">Nothing waiting.</p>
          <p className="mt-1 text-sm text-gray-400">
            When Jordan next scans the inbox, anything awaiting a reply will appear here.
          </p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-[900px] w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">Mailbox</th>
                <th className="px-3 py-2">Who</th>
                <th className="px-3 py-2">Subject</th>
                <th className="px-3 py-2 whitespace-nowrap">State</th>
                <th className="px-3 py-2 whitespace-nowrap">Waiting since</th>
                <th className="px-3 py-2 whitespace-nowrap">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((it) => {
                const closed = it.state === FOLLOWUP_STATE.CLOSED;
                const badge = draftBadge(it);
                const isOpen = expandedId === it.id;
                return (
                  <React.Fragment key={it.id}>
                    <tr className={`border-b border-gray-100 align-top ${closed ? 'opacity-60' : ''} ${it.urgent && !closed ? 'bg-amber-50/40' : ''}`}>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">
                        {MAILBOX_LABELS[it.mailbox] ?? it.mailbox}
                      </td>
                      <td className="px-3 py-2 text-gray-800">
                        <div className="font-medium">{it.counterpart_name || it.counterpart_email || 'Unknown'}</div>
                        {it.counterpart_name && it.counterpart_email && (
                          <div className="text-xs text-gray-400">{it.counterpart_email}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-800">
                        <div className="font-medium">{it.subject || '(no subject)'}</div>
                        {it.needs && <div className="mt-0.5 text-xs text-gray-500">{it.needs}</div>}
                        <OpenEmailLink item={it} className="mt-1" />
                        {it.urgent && !closed && (
                          <span className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700">Urgent</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">{STATE_LABELS[it.state] ?? it.state}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">{formatWhen(it.last_message_at)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.className}`}>{badge.label}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right">
                        <div className="flex justify-end gap-2">
                          {canRequestDraft(it) && (
                            <button
                              type="button"
                              onClick={() => handleRequestDraft(it.id)}
                              disabled={busyId === it.id}
                              className="rounded border border-indigo-300 bg-white px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                            >
                              {it.state === FOLLOWUP_STATE.AWAITING_THEM ? 'Request chase' : 'Request draft'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setExpandedId(isOpen ? null : it.id)}
                            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                          >
                            {isOpen ? 'Close' : 'Review'}
                          </button>
                          {closed ? (
                            <button
                              type="button"
                              onClick={() => handleReopen(it.id)}
                              disabled={busyId === it.id}
                              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                              Reopen
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleDone(it.id)}
                              disabled={busyId === it.id}
                              className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              {busyId === it.id ? '…' : 'Done'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={7} className="border-b border-gray-200 p-0">
                          <ReviewPanel item={it} onSave={handleSave} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
