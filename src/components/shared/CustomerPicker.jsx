// src/components/shared/CustomerPicker.jsx
'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/apiClient';

/**
 * Choose the customer a project is for.
 *
 * A plain select rather than a combobox: the list is short, it is keyboard
 * operable for free, and a native control needs no ARIA of its own. Creating a
 * customer from here is deliberately not offered, because the create form has
 * fields this control has nowhere to put; the sidebar's "New customer" button
 * is one click away.
 *
 * Archived customers are excluded from the options but shown if one is already
 * selected, so an existing link is never silently dropped by the picker.
 */
export default function CustomerPicker({
  value,
  onChange,
  disabled = false,
  id = 'customer-picker',
  label = 'Customer',
  className = '',
}) {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const list = await apiClient.getCustomers({ includeArchived: true });
        if (!cancelled) setCustomers(list);
      } catch {
        // A failed load leaves the picker empty rather than blocking the form.
        // The project can still be saved without a customer and linked later.
        if (!cancelled) setCustomers([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectable = customers.filter(
    (customer) => !customer.archived_at || customer.id === value
  );

  return (
    <select
      id={id}
      value={value || ''}
      disabled={disabled || loading}
      aria-label={label}
      onChange={(event) => onChange(event.target.value || null)}
      className={
        className ||
        'w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-60'
      }
    >
      <option value="">{loading ? 'Loading customers…' : 'No customer'}</option>
      {selectable.map((customer) => (
        <option key={customer.id} value={customer.id}>
          {customer.name}
          {customer.archived_at ? ' (archived)' : ''}
        </option>
      ))}
    </select>
  );
}
