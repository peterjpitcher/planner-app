// src/components/Customers/CustomerSidebar.jsx
'use client';

import { memo } from 'react';
import { PlusIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { cn } from '@/lib/styleUtils';
import { CUSTOMER_STATUS } from '@/lib/constants';

// "Needs attention" is derived rather than stored: a customer with open
// projects but nothing logged recently is the one you have gone quiet on.
// Until notes carry customer_id (Phase 2) the "nothing logged" half cannot be
// computed, so the filter is deliberately absent rather than wrong.
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: CUSTOMER_STATUS.ACTIVE, label: 'Active' },
  { key: CUSTOMER_STATUS.PROSPECT, label: 'Prospect' },
  { key: CUSTOMER_STATUS.DORMANT, label: 'Dormant' },
  { key: CUSTOMER_STATUS.FORMER, label: 'Former' },
  { key: 'archived', label: 'Archived' },
];

const STATUS_DOT = {
  [CUSTOMER_STATUS.ACTIVE]: 'bg-emerald-500',
  [CUSTOMER_STATUS.PROSPECT]: 'bg-sky-500',
  [CUSTOMER_STATUS.DORMANT]: 'bg-amber-500',
  [CUSTOMER_STATUS.FORMER]: 'bg-gray-400',
};

function FilterPills({ activeFilter, onFilterChange, counts }) {
  return (
    <div className="flex flex-wrap gap-1.5 px-3 pb-2" role="radiogroup" aria-label="Customer filters">
      {FILTERS.map((filter) => {
        const isActive = activeFilter === filter.key;
        const count = counts[filter.key];
        return (
          <button
            key={filter.key}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onFilterChange(filter.key)}
            className={cn(
              'rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
              isActive
                ? 'bg-indigo-100 text-indigo-700'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            )}
          >
            {filter.label}
            {count != null && count > 0 && (
              <span className="ml-1 text-[10px] opacity-75">({count})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function CustomerRow({ customer, isSelected, onSelect }) {
  const openWork = customer.open_project_count + customer.open_task_count;

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(customer.id)}
        aria-current={isSelected ? 'true' : undefined}
        className={cn(
          'flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
          isSelected ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-gray-50'
        )}
      >
        <span
          className={cn(
            'mt-1.5 h-2 w-2 shrink-0 rounded-full',
            STATUS_DOT[customer.status] || 'bg-gray-300'
          )}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-900">
            {customer.name}
          </span>
          <span className="mt-0.5 block text-xs text-gray-500">
            {/* Status is repeated as text, not left to the colour alone. */}
            {customer.archived_at ? 'Archived · ' : ''}
            {customer.status}
            {openWork > 0 && (
              <>
                {' · '}
                {customer.open_project_count} project
                {customer.open_project_count === 1 ? '' : 's'}
                {', '}
                {customer.open_task_count} task
                {customer.open_task_count === 1 ? '' : 's'}
              </>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}

function CustomerSidebar({
  customers,
  selectedCustomerId,
  onSelect,
  onCreate,
  activeFilter,
  onFilterChange,
  search,
  onSearchChange,
  areas,
  selectedArea,
  onAreaChange,
  counts,
}) {
  return (
    <div className="flex h-full w-full shrink-0 flex-col border-r border-gray-200 bg-gray-50/50 md:w-[280px]">
      <div className="p-3">
        <button
          type="button"
          onClick={onCreate}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <PlusIcon className="h-4 w-4" aria-hidden="true" />
          New customer
        </button>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <MagnifyingGlassIcon
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search customers"
            aria-label="Search customers"
            className="w-full rounded-md border border-gray-200 bg-white py-1.5 pl-8 pr-8 text-sm placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <XMarkIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <FilterPills activeFilter={activeFilter} onFilterChange={onFilterChange} counts={counts} />

      {areas.length > 0 && (
        <div className="px-3 pb-2">
          <select
            value={selectedArea}
            onChange={(event) => onAreaChange(event.target.value)}
            aria-label="Filter by area"
            className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          >
            <option value="all">All areas</option>
            {areas.map((area) => (
              <option key={area} value={area}>
                {area}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {customers.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs italic text-gray-400">
            No customers match.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {customers.map((customer) => (
              <CustomerRow
                key={customer.id}
                customer={customer}
                isSelected={customer.id === selectedCustomerId}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default memo(CustomerSidebar);
