'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/apiClient';
import { createLatestGuard } from '@/lib/requestCache';
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

// What Peter can set. 'sent' and 'none' are machine states, not choices, so the
// picker offers only the four decisions he actually makes.
const DECISION_OPTIONS = [
  { value: FOLLOWUP_DRAFT_STATUS.READY, label: 'Draft ready to review' },
  { value: FOLLOWUP_DRAFT_STATUS.APPROVED, label: 'Approve and send' },
  { value: FOLLOWUP_DRAFT_STATUS.EDIT_REQUESTED, label: 'Redraft with my feedback' },
  { value: FOLLOWUP_DRAFT_STATUS.HOLD, label: 'Hold' },
];

const DRAFT_STATUS_BADGE = {
  [FOLLOWUP_DRAFT_STATUS.NONE]: { label: 'No draft yet', className: 'bg-gray-100 text-gray-500' },
  [FOLLOWUP_DRAFT_STATUS.READY]: { label: 'Draft ready', className: 'bg-indigo-100 text-indigo-700' },
  [FOLLOWUP_DRAFT_STATUS.APPROVED]: { label: 'Approved to send', className: 'bg-emerald-100 text-emerald-700' },
  [FOLLOWUP_DRAFT_STATUS.EDIT_REQUESTED]: { label: 'Redraft requested', className: 'bg-amber-100 text-amber-700' },
  [FOLLOWUP_DRAFT_STATUS.HOLD]: { label: 'On hold', className: 'bg-gray-100 text-gray-600' },
  [FOLLOWUP_DRAFT_STATUS.SENT]: { label: 'Sent', className: 'bg-emerald-50 text-emerald-600' },
};

function formatWhen(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ---------------------------------------------------------------------------
// One follow-up card
// ---------------------------------------------------------------------------

function FollowUpCard({ item, onSave }) {
  const [draft, setDraft] = useState(item.proposed_draft ?? '');
  const [feedback, setFeedback] = useState(item.feedback ?? '');
  const [decision, setDecision] = useState(
    DECISION_OPTIONS.some((o) => o.value === item.draft_status) ? item.draft_status : ''
  );
  const [urgent, setUrgent] = useState(item.urgent === true);
  const [saving, setSaving] = useState(false);

  // Keep local fields in step when a background refresh brings new data (e.g.
  // the worker replaced the draft after a redraft request).
  useEffect(() => { setDraft(item.proposed_draft ?? ''); }, [item.proposed_draft]);
  useEffect(() => { setFeedback(item.feedback ?? ''); }, [item.feedback]);
  useEffect(() => { setUrgent(item.urgent === true); }, [item.urgent]);

  const badge = DRAFT_STATUS_BADGE[item.draft_status] ?? DRAFT_STATUS_BADGE.none;
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
    const ok = await onSave(item.id, updates);
    setSaving(false);
    if (!ok) return;
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900">
            {item.subject || '(no subject)'}
          </p>
          <p className="mt-0.5 truncate text-xs text-gray-500">
            {item.counterpart_name || item.counterpart_email || 'Unknown sender'}
            {item.last_message_at ? ` · last activity ${formatWhen(item.last_message_at)}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
            {MAILBOX_LABELS[item.mailbox] ?? item.mailbox}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.className}`}>
            {badge.label}
          </span>
        </div>
      </div>

      {item.needs && (
        <p className="mt-2 text-sm text-gray-700">{item.needs}</p>
      )}

      {item.state === FOLLOWUP_STATE.AWAITING_THEM && (
        <p className="mt-2 text-xs text-gray-500">
          Waiting on them
          {item.next_chase_date ? ` · chase from ${formatWhen(item.next_chase_date)}` : ''}
          {item.chase_count > 0 ? ` · chased ${item.chase_count}×` : ''}
        </p>
      )}

      <label className="mt-3 block text-xs font-medium text-gray-500" htmlFor={`draft-${item.id}`}>
        Proposed reply
      </label>
      <textarea
        id={`draft-${item.id}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={5}
        placeholder="No draft yet."
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
          {DECISION_OPTIONS.map((o) => (
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
        <p className="mt-2 text-xs text-emerald-700">
          Jordan will send this on its next run and mark it sent.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export default function FollowUpList() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const loadGuardRef = useRef(createLatestGuard());

  const load = useCallback(async () => {
    const token = loadGuardRef.current.begin();
    try {
      setError(null);
      const data = await apiClient.getFollowUps();
      if (loadGuardRef.current.isStale(token)) return;
      setItems(data);
    } catch (err) {
      if (loadGuardRef.current.isStale(token)) return;
      setError(err.message || 'Failed to load follow-ups.');
    } finally {
      if (!loadGuardRef.current.isStale(token)) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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

  const awaitingMe = items.filter((it) => it.state === FOLLOWUP_STATE.AWAITING_ME);
  const awaitingThem = items.filter((it) => it.state === FOLLOWUP_STATE.AWAITING_THEM);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Follow-ups</h1>
        <p className="mt-1 text-sm text-gray-500">
          Everything waiting on a reply, in one place. Review a draft, approve it or leave
          feedback, and Jordan sends it. Nothing sends without your approval.
        </p>
      </div>

      {error && (
        <div className="mb-4 max-w-3xl rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-2 underline hover:no-underline focus:outline-none">
            Dismiss
          </button>
        </div>
      )}

      {loading && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="animate-pulse rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div className="h-4 w-2/3 rounded bg-gray-200" />
              <div className="mt-2 h-3 w-1/3 rounded bg-gray-100" />
              <div className="mt-4 h-20 w-full rounded bg-gray-100" />
            </div>
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
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-gray-400">
              Waiting on you
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                {awaitingMe.length}
              </span>
            </h2>
            {awaitingMe.length === 0 ? (
              <p className="text-sm text-gray-400">Nothing needs your reply right now.</p>
            ) : (
              <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
                {awaitingMe.map((it) => (
                  <FollowUpCard key={it.id} item={it} onSave={handleSave} />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-gray-400">
              Waiting on them
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                {awaitingThem.length}
              </span>
            </h2>
            {awaitingThem.length === 0 ? (
              <p className="text-sm text-gray-400">Nothing outstanding with anyone else.</p>
            ) : (
              <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
                {awaitingThem.map((it) => (
                  <FollowUpCard key={it.id} item={it} onSave={handleSave} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
