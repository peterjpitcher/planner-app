// src/components/Customers/CustomerFacts.jsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { PlusIcon, TrashIcon } from '@heroicons/react/20/solid';
import { apiClient } from '@/lib/apiClient';

/**
 * The standing things about a customer that are not stream entries: a VAT
 * number, a portal URL, an invoicing email, parking instructions.
 *
 * A label and value list rather than a custom field engine. That is most of the
 * value of custom fields for a fraction of the cost, and it is the half of
 * "random things they send me" that is a fact rather than an event.
 */
export default function CustomerFacts({ customerId, disabled = false }) {
  const [facts, setFacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAll, setShowAll] = useState(false);

  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    try {
      setFacts(await apiClient.getCustomerFacts(customerId));
      setError(null);
    } catch (err) {
      setError(err.message || 'Could not load key facts.');
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(event) {
    event.preventDefault();
    if (!label.trim() || !value.trim() || adding) return;

    setAdding(true);
    setError(null);
    try {
      await apiClient.createCustomerFact(customerId, {
        label: label.trim(),
        value: value.trim(),
      });
      setLabel('');
      setValue('');
      await load();
    } catch (err) {
      setError(err.message || 'Could not add that fact.');
    } finally {
      setAdding(false);
    }
  }

  async function remove(factId) {
    try {
      await apiClient.deleteCustomerFact(customerId, factId);
      setFacts((prev) => prev.filter((fact) => fact.id !== factId));
    } catch (err) {
      setError(err.message || 'Could not remove that fact.');
    }
  }

  async function edit(fact, patch) {
    try {
      await apiClient.updateCustomerFact(customerId, fact.id, patch);
      await load();
    } catch (err) {
      setError(err.message || 'Could not save that change.');
    }
  }

  const visible = showAll ? facts : facts.slice(0, 5);

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-gray-700">Key facts ({facts.length})</h2>

      {loading ? (
        <p className="py-3 text-xs text-gray-400">Loading…</p>
      ) : (
        <>
          {facts.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-200 py-4 text-center text-xs italic text-gray-400">
              Nothing recorded yet. Account numbers, portal addresses, how they like to be invoiced.
            </p>
          ) : (
            <dl className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {visible.map((fact) => (
                <div key={fact.id} className="flex items-start gap-3 px-3 py-2">
                  <dt className="w-1/3 shrink-0 text-xs font-medium text-gray-500">
                    <input
                      defaultValue={fact.label}
                      disabled={disabled}
                      aria-label={`Label for ${fact.label}`}
                      onBlur={(event) => {
                        const next = event.target.value.trim();
                        if (next && next !== fact.label) edit(fact, { label: next });
                      }}
                      className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-gray-200 focus:border-indigo-400 focus:bg-white focus:outline-none"
                    />
                  </dt>
                  <dd className="min-w-0 flex-1 text-sm text-gray-800">
                    <input
                      defaultValue={fact.value}
                      disabled={disabled}
                      aria-label={`Value for ${fact.label}`}
                      onBlur={(event) => {
                        const next = event.target.value.trim();
                        if (next && next !== fact.value) edit(fact, { value: next });
                      }}
                      className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-gray-200 focus:border-indigo-400 focus:bg-white focus:outline-none"
                    />
                  </dd>
                  {!disabled && (
                    <button
                      type="button"
                      onClick={() => remove(fact.id)}
                      aria-label={`Remove ${fact.label}`}
                      className="shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <TrashIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
            </dl>
          )}

          {facts.length > 5 && (
            <button
              type="button"
              onClick={() => setShowAll((open) => !open)}
              aria-expanded={showAll}
              className="mt-1.5 text-xs text-indigo-600 underline hover:text-indigo-700"
            >
              {showAll ? 'Show fewer' : `Show all ${facts.length}`}
            </button>
          )}

          {!disabled && (
            <form onSubmit={add} className="mt-2 flex flex-wrap gap-2">
              <input
                type="text"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Label"
                maxLength={80}
                aria-label="New fact label"
                className="w-32 rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
              <input
                type="text"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="Value"
                maxLength={2000}
                aria-label="New fact value"
                className="min-w-0 flex-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
              <button
                type="submit"
                disabled={!label.trim() || !value.trim() || adding}
                className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                <PlusIcon className="h-4 w-4" aria-hidden="true" />
                Add
              </button>
            </form>
          )}

          {/* Facts are plain text and searchable. Saying so here is the
              proportionate answer for a personal planner: building encryption,
              masking and an audit trail is a different project, and implying a
              protection that does not exist would be worse than saying nothing. */}
          <p className="mt-1.5 text-[11px] text-gray-400">
            Do not store passwords, API keys or recovery codes here. A portal address and a
            username are fine; the credential is not.
          </p>
        </>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
