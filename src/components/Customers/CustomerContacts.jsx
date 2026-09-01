// src/components/Customers/CustomerContacts.jsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { PlusIcon, StarIcon, TrashIcon } from '@heroicons/react/20/solid';
import { apiClient } from '@/lib/apiClient';
import { findProbableDuplicates } from '@/services/contactService';
import { cn } from '@/lib/styleUtils';

/**
 * The people at a customer.
 *
 * Names are deliberately not unique in the database: two people at one company
 * really can share a name, and refusing to store the second would be worse than
 * showing a duplicate. So a probable duplicate (same name AND a matching email
 * or phone) is warned about here and left to you to decide.
 */
export default function CustomerContacts({ customerId, disabled = false }) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [adding, setAdding] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    try {
      setContacts(await apiClient.getContacts({ customerId }));
      setError(null);
    } catch (err) {
      setError(err.message || 'Could not load contacts.');
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    load();
  }, [load]);

  const duplicates = findProbableDuplicates({ name, email, phone }, contacts);

  async function add(event) {
    event.preventDefault();
    if (!name.trim() || adding) return;

    setAdding(true);
    setError(null);
    try {
      await apiClient.createContact({
        customer_id: customerId,
        name: name.trim(),
        role: role.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
      });
      setName('');
      setRole('');
      setEmail('');
      setPhone('');
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err.message || 'Could not add that contact.');
    } finally {
      setAdding(false);
    }
  }

  async function makePrimary(contactId) {
    try {
      await apiClient.updateContact(contactId, { makePrimary: true, customerId });
      await load();
    } catch (err) {
      setError(err.message || 'Could not set the primary contact.');
    }
  }

  async function archive(contactId) {
    try {
      await apiClient.updateContact(contactId, { archived: true });
      setContacts((prev) => prev.filter((contact) => contact.id !== contactId));
    } catch (err) {
      setError(err.message || 'Could not archive that contact.');
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">People ({contacts.length})</h2>
        {!disabled && (
          <button
            type="button"
            onClick={() => setShowForm((open) => !open)}
            aria-expanded={showForm}
            className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
          >
            <PlusIcon className="h-3.5 w-3.5" aria-hidden="true" />
            Add
          </button>
        )}
      </div>

      {loading ? (
        <p className="py-3 text-xs text-gray-400">Loading…</p>
      ) : contacts.length === 0 && !showForm ? (
        <p className="rounded-lg border border-dashed border-gray-200 py-4 text-center text-xs italic text-gray-400">
          Nobody recorded yet.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {contacts.map((contact) => (
            <li key={contact.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium text-gray-900">
                  {contact.name}
                  {contact.is_primary && (
                    <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                      Primary
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-gray-500">
                  {[contact.role, contact.email, contact.phone].filter(Boolean).join(' · ') ||
                    'No details'}
                </p>
              </div>

              {!disabled && (
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => makePrimary(contact.id)}
                    disabled={contact.is_primary}
                    aria-label={`Make ${contact.name} the primary contact`}
                    className={cn(
                      'rounded p-1',
                      contact.is_primary
                        ? 'cursor-default text-indigo-400'
                        : 'text-gray-300 hover:bg-indigo-50 hover:text-indigo-600'
                    )}
                  >
                    <StarIcon className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => archive(contact.id)}
                    aria-label={`Archive ${contact.name}`}
                    className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <TrashIcon className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {showForm && !disabled && (
        <form onSubmit={add} className="mt-2 space-y-2 rounded-lg border border-gray-200 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name"
              maxLength={120}
              aria-label="Contact name"
              className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
            <input
              type="text"
              value={role}
              onChange={(event) => setRole(event.target.value)}
              placeholder="Role"
              maxLength={120}
              aria-label="Contact role"
              className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email"
              maxLength={320}
              aria-label="Contact email"
              className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
            <input
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="Phone"
              maxLength={40}
              aria-label="Contact phone"
              className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </div>

          {/* Warned about, not blocked. Two people at one company can share a
              name, so this is a prompt to check, not a refusal to save. */}
          {duplicates.length > 0 && (
            <p className="text-xs text-amber-700">
              {duplicates[0].name} already exists with the same contact details. Add anyway if
              they really are two different people.
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || adding}
              className="rounded-md bg-indigo-600 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {adding ? 'Adding…' : 'Add person'}
            </button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
