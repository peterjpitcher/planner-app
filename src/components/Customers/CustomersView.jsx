// src/components/Customers/CustomersView.jsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { UsersIcon } from '@heroicons/react/24/outline';

import { apiClient } from '@/lib/apiClient';
import { CUSTOMER_STATUS } from '@/lib/constants';
import CustomerSidebar from './CustomerSidebar';
import CustomerWorkspace from './CustomerWorkspace';
import CreateCustomerModal from './CreateCustomerModal';
import CustomerDeleteModal from './CustomerDeleteModal';

function EmptyState({ customers, onSelect }) {
  const needsWork = customers.filter((c) => c.open_project_count === 0 && !c.archived_at);

  return (
    <div className="min-w-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center gap-3">
          <UsersIcon className="h-6 w-6 text-indigo-500" aria-hidden="true" />
          <h1 className="text-lg font-semibold text-gray-900">Customers</h1>
        </div>

        {customers.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-gray-200 p-8 text-center">
            <p className="text-sm text-gray-500">
              No customers yet. Your projects already carry stakeholder names, so the
              quickest start is to turn those into customers.
            </p>
            <Link
              href="/customers/setup"
              className="mt-3 inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Set up from stakeholders
            </Link>
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm text-gray-500">
              Pick a customer to see everything open for them in one place.
            </p>

            <Link
              href="/customers/setup"
              className="mt-3 inline-block text-sm font-medium text-indigo-600 underline hover:text-indigo-700"
            >
              Assign projects to customers
            </Link>

            {needsWork.length > 0 && (
              <section className="mt-6">
                <h2 className="text-sm font-semibold text-gray-700">
                  No open projects ({needsWork.length})
                </h2>
                <ul className="mt-2 space-y-1">
                  {needsWork.slice(0, 10).map((customer) => (
                    <li key={customer.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(customer.id)}
                        className="flex w-full items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm hover:border-indigo-300 hover:bg-indigo-50/40"
                      >
                        <span className="min-w-0 truncate text-gray-900">{customer.name}</span>
                        <span className="shrink-0 text-xs text-gray-500">{customer.status}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function CustomersView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlCustomerId = searchParams.get('id');

  const [customers, setCustomers] = useState([]);
  const [areas, setAreas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedCustomerId, setSelectedCustomerId] = useState(urlCustomerId);
  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(false);

  const [activeFilter, setActiveFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedArea, setSelectedArea] = useState('all');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleteImpact, setDeleteImpact] = useState(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);
  const [confirmError, setConfirmError] = useState(null);

  // Guards against a slow response for a customer you have already navigated
  // away from overwriting the one you are now looking at.
  const overviewRequestRef = useRef(0);

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, areaList] = await Promise.all([
        apiClient.getCustomers({ includeArchived: true }),
        apiClient.getAreas(),
      ]);
      setCustomers(list);
      setAreas(areaList);
    } catch (err) {
      setError(err.message || 'Failed to load customers.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  const loadOverview = useCallback(async (customerId) => {
    if (!customerId) {
      setOverview(null);
      return;
    }

    const requestId = ++overviewRequestRef.current;
    setOverviewLoading(true);
    try {
      const data = await apiClient.getCustomerOverview(customerId);
      if (overviewRequestRef.current !== requestId) return;
      setOverview(data);
    } catch (err) {
      if (overviewRequestRef.current !== requestId) return;
      setError(err.message || 'Failed to load this customer.');
      setOverview(null);
    } finally {
      if (overviewRequestRef.current === requestId) setOverviewLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview(selectedCustomerId);
  }, [selectedCustomerId, loadOverview]);

  // Keep the URL in step so a customer can be linked to and survives a refresh.
  const handleSelect = useCallback(
    (customerId) => {
      setSelectedCustomerId(customerId);
      router.replace(customerId ? `/customers?id=${customerId}` : '/customers', { scroll: false });
    },
    [router]
  );

  const filteredCustomers = useMemo(() => {
    const term = search.trim().toLowerCase();

    return customers.filter((customer) => {
      if (activeFilter === 'archived') {
        if (!customer.archived_at) return false;
      } else if (customer.archived_at) {
        // Archived customers only appear under their own filter, never mixed in.
        return false;
      } else if (activeFilter !== 'all' && customer.status !== activeFilter) {
        return false;
      }

      if (selectedArea !== 'all') {
        if ((customer.area || '').toLowerCase() !== selectedArea.toLowerCase()) return false;
      }

      if (term && !customer.name.toLowerCase().includes(term)) return false;

      return true;
    });
  }, [customers, activeFilter, search, selectedArea]);

  const counts = useMemo(() => {
    const result = { all: 0, archived: 0 };
    Object.values(CUSTOMER_STATUS).forEach((status) => {
      result[status] = 0;
    });
    customers.forEach((customer) => {
      if (customer.archived_at) {
        result.archived += 1;
        return;
      }
      result.all += 1;
      result[customer.status] = (result[customer.status] || 0) + 1;
    });
    return result;
  }, [customers]);

  async function handleCreate(payload) {
    const created = await apiClient.createCustomer(payload);
    setCustomers((prev) => [...prev, { ...created, open_project_count: 0, closed_project_count: 0, open_task_count: 0, last_contact_at: null }]);
    handleSelect(created.id);
    if (created.area && !areas.includes(created.area)) {
      setAreas((prev) => [...prev, created.area].sort());
    }
    return created;
  }

  async function handleUpdateCustomer(customerId, updates) {
    // Optimistic, reverted by a refetch on failure, matching how projects and
    // tasks behave elsewhere in the app.
    const previous = customers;
    setCustomers((prev) =>
      prev.map((customer) => (customer.id === customerId ? { ...customer, ...updates } : customer))
    );
    setOverview((prev) =>
      prev && prev.customer.id === customerId
        ? { ...prev, customer: { ...prev.customer, ...updates } }
        : prev
    );

    try {
      const updated = await apiClient.updateCustomer(customerId, updates);
      setCustomers((prev) =>
        prev.map((customer) =>
          customer.id === customerId ? { ...customer, ...updated } : customer
        )
      );
      setOverview((prev) =>
        prev && prev.customer.id === customerId ? { ...prev, customer: updated } : prev
      );
    } catch (err) {
      setCustomers(previous);
      setError(err.message || 'Could not save that change.');
      loadOverview(customerId);
    }
  }

  async function handleArchive(customer) {
    try {
      await handleUpdateCustomer(customer.id, { archived: !customer.archived_at });
    } catch (err) {
      setError(err.message || 'Could not archive that customer.');
    }
  }

  async function openDelete(customer) {
    setPendingDelete(customer);
    setDeleteImpact(null);
    setConfirmError(null);
    setImpactLoading(true);
    try {
      setDeleteImpact(await apiClient.getCustomerImpact(customer.id));
    } catch {
      setDeleteImpact(null);
    } finally {
      setImpactLoading(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setConfirmSubmitting(true);
    setConfirmError(null);
    try {
      await apiClient.deleteCustomer(pendingDelete.id);
      setCustomers((prev) => prev.filter((customer) => customer.id !== pendingDelete.id));
      setPendingDelete(null);
      handleSelect(null);
    } catch (err) {
      setConfirmError(err.message || 'Could not remove that customer.');
    } finally {
      setConfirmSubmitting(false);
    }
  }

  const refreshAfterTaskChange = useCallback(() => {
    loadOverview(selectedCustomerId);
    loadCustomers();
  }, [loadOverview, loadCustomers, selectedCustomerId]);

  async function handleCompleteTask(taskId) {
    await apiClient.updateTask(taskId, { state: 'done' });
    refreshAfterTaskChange();
  }

  async function handleUpdateTask(taskId, updates) {
    await apiClient.updateTask(taskId, updates);
    refreshAfterTaskChange();
  }

  async function handleDeleteTask(taskId) {
    await apiClient.deleteTask(taskId);
    refreshAfterTaskChange();
  }

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-4rem)] animate-pulse">
        <div className="w-full shrink-0 space-y-3 border-r border-gray-200 bg-gray-50/50 p-3 md:w-[280px]">
          <div className="h-9 rounded-md bg-gray-200" />
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 rounded-lg bg-gray-200" />
          ))}
        </div>
        <div className="hidden flex-1 space-y-4 p-6 md:block">
          <div className="h-64 rounded-lg bg-gray-100" />
        </div>
      </div>
    );
  }

  const selected = overview?.customer;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col md:flex-row">
      {error && (
        <div
          role="alert"
          className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 bg-red-50 px-4 py-2 text-sm text-red-700"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-xs font-medium underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* On mobile the sidebar is the page until a customer is picked, then the
          workspace takes over. Same behaviour as /projects. */}
      <div className={selectedCustomerId ? 'hidden md:flex' : 'flex flex-1'}>
        <CustomerSidebar
          customers={filteredCustomers}
          selectedCustomerId={selectedCustomerId}
          onSelect={handleSelect}
          onCreate={() => setIsCreateOpen(true)}
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
          search={search}
          onSearchChange={setSearch}
          areas={areas}
          selectedArea={selectedArea}
          onAreaChange={setSelectedArea}
          counts={counts}
        />
      </div>

      {selectedCustomerId && (
        <button
          type="button"
          onClick={() => handleSelect(null)}
          className="border-b border-gray-200 px-4 py-2 text-left text-sm text-indigo-600 md:hidden"
        >
          Back to all customers
        </button>
      )}

      {selected ? (
        <CustomerWorkspace
          customer={selected}
          openProjects={overview.openProjects}
          closedProjects={overview.closedProjects}
          tasks={overview.tasks}
          onUpdateCustomer={handleUpdateCustomer}
          onArchive={handleArchive}
          onDelete={openDelete}
          onTaskAdded={refreshAfterTaskChange}
          onCompleteTask={handleCompleteTask}
          onUpdateTask={handleUpdateTask}
          onDeleteTask={handleDeleteTask}
          onTaskClick={() => {}}
        />
      ) : overviewLoading ? (
        <div className="min-w-0 flex-1 animate-pulse p-6">
          <div className="h-64 rounded-lg bg-gray-100" />
        </div>
      ) : (
        <div className={selectedCustomerId ? 'flex flex-1' : 'hidden md:flex md:flex-1'}>
          <EmptyState customers={customers} onSelect={handleSelect} />
        </div>
      )}

      <CreateCustomerModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreate={handleCreate}
        areas={areas}
      />

      <CustomerDeleteModal
        isOpen={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        customerName={pendingDelete?.name || ''}
        impact={deleteImpact}
        loading={impactLoading}
        submitting={confirmSubmitting}
        error={confirmError}
      />
    </div>
  );
}
