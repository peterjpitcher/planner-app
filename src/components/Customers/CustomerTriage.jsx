// src/components/Customers/CustomerTriage.jsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/apiClient';
import { cn } from '@/lib/styleUtils';

/**
 * One-off setup screen: turn existing stakeholder names into customers, and
 * assign the projects that are still unattached.
 *
 * These are the same job. Marking a name as a customer assigns every project
 * carrying it, so most of the assignment fills itself in, and only the leftovers
 * need a manual choice.
 *
 * Nothing is written until Apply. The screen can be explored freely first, which
 * matters because the decision (is "Kim" a company or a person?) is a judgement
 * only the user can make.
 *
 * The Person choice is deliberately absent here: contacts do not exist until
 * Phase 2, and it will be added to this screen then. A name left alone stays in
 * projects.stakeholders untouched, so nothing is lost in between.
 */
export default function CustomerTriage({ onDone }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [decisions, setDecisions] = useState({});
  const [assignments, setAssignments] = useState({});
  const [customers, setCustomers] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [triage, customerList] = await Promise.all([
        apiClient.getCustomerTriage(),
        apiClient.getCustomers({ includeArchived: false }),
      ]);
      setData(triage);
      setCustomers(customerList);
    } catch (err) {
      setError(err.message || 'Could not load your stakeholders.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const chosenNames = useMemo(
    () => Object.entries(decisions).filter(([, choice]) => choice === 'customer').map(([name]) => name),
    [decisions]
  );

  const pendingAssignments = useMemo(
    () =>
      Object.entries(assignments)
        .filter(([, customerId]) => customerId)
        .map(([projectId, customerId]) => ({ projectId, customerId })),
    [assignments]
  );

  const hasChanges = chosenNames.length > 0 || pendingAssignments.length > 0;

  async function apply() {
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const outcome = await apiClient.applyCustomerTriage({
        customerNames: chosenNames,
        assignments: pendingAssignments,
      });
      setResult(outcome);
      setDecisions({});
      setAssignments({});
      await load();
      onDone?.();
    } catch (err) {
      setError(err.message || 'Could not apply those changes.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-3 p-6">
        <div className="h-6 w-64 rounded bg-gray-200" />
        <div className="h-40 rounded-lg bg-gray-100" />
      </div>
    );
  }

  const profile = data?.profile;

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <h1 className="text-lg font-semibold text-gray-900">Set up your customers</h1>
      <p className="mt-1 text-sm text-gray-500">
        Your projects already carry stakeholder names. Some are companies, some are
        people. Mark the companies and their projects get assigned automatically.
      </p>

      {/* The profile is shown rather than hidden, because the decisions below
          only make sense against what is actually in the data. */}
      {profile && (
        <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-gray-500">Distinct names</dt>
            <dd className="font-semibold text-gray-900">{profile.distinctNames}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Projects with names</dt>
            <dd className="font-semibold text-gray-900">{profile.projectsWithStakeholders}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Already assigned</dt>
            <dd className="font-semibold text-gray-900">
              {data.assignedCount} of {data.totalProjects}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Look like emails</dt>
            <dd className="font-semibold text-gray-900">{profile.emailLike}</dd>
          </div>
        </dl>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {result && (
        <div
          role="status"
          className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
        >
          <p>
            {result.customersCreated.length} customer
            {result.customersCreated.length === 1 ? '' : 's'} created,{' '}
            {result.projectsAssigned} project
            {result.projectsAssigned === 1 ? '' : 's'} assigned.
          </p>
          {result.conflicts?.length > 0 && (
            <p className="mt-1 text-amber-800">
              {result.conflicts.length} project
              {result.conflicts.length === 1 ? ' was' : 's were'} left alone because they
              already had a different customer:{' '}
              {result.conflicts.slice(0, 5).map((c) => c.projectName).join(', ')}.
            </p>
          )}
        </div>
      )}

      {/* Stakeholder names */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold text-gray-700">
          Stakeholder names ({profile?.names.length || 0})
        </h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Most-used first. Anything you leave alone stays exactly where it is.
        </p>

        {profile?.names.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-gray-200 py-6 text-center text-sm text-gray-400">
            No stakeholder names to sort out.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {profile.names.map((entry) => {
              const choice = decisions[entry.name];
              return (
                <li
                  key={entry.name}
                  className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {entry.name}
                      {entry.looksLikeEmail && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                          looks like a person
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-gray-500">
                      {entry.projects.length} project
                      {entry.projects.length === 1 ? '' : 's'}:{' '}
                      {entry.projects.slice(0, 3).map((p) => p.name).join(', ')}
                      {entry.projects.length > 3 && ` and ${entry.projects.length - 3} more`}
                    </p>
                  </div>

                  <div className="flex shrink-0 gap-1.5" role="group" aria-label={`Decision for ${entry.name}`}>
                    <button
                      type="button"
                      aria-pressed={choice === 'customer'}
                      onClick={() =>
                        setDecisions((prev) => ({
                          ...prev,
                          [entry.name]: prev[entry.name] === 'customer' ? undefined : 'customer',
                        }))
                      }
                      className={cn(
                        'rounded-full px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                        choice === 'customer'
                          ? 'bg-indigo-600 text-white'
                          : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                      )}
                    >
                      Customer
                    </button>
                    <button
                      type="button"
                      aria-pressed={choice === 'skip'}
                      onClick={() =>
                        setDecisions((prev) => ({
                          ...prev,
                          [entry.name]: prev[entry.name] === 'skip' ? undefined : 'skip',
                        }))
                      }
                      className={cn(
                        'rounded-full px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                        choice === 'skip'
                          ? 'bg-gray-600 text-white'
                          : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                      )}
                    >
                      Not a customer
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Projects still without a customer */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold text-gray-700">
          Projects with no customer ({data?.unassignedProjects.length || 0})
        </h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Open projects only. Marking a stakeholder as a customer above will clear most of these.
        </p>

        {data?.unassignedProjects.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-gray-200 py-6 text-center text-sm text-gray-400">
            Every open project has a customer.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {data.unassignedProjects.map((project) => (
              <li
                key={project.id}
                className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/projects?id=${project.id}`}
                    className="truncate text-sm font-medium text-gray-900 hover:text-indigo-600"
                  >
                    {project.name}
                  </Link>
                  {project.stakeholders.length > 0 && (
                    <p className="mt-0.5 truncate text-xs text-gray-500">
                      {project.stakeholders.join(', ')}
                    </p>
                  )}
                </div>

                <select
                  value={assignments[project.id] || ''}
                  onChange={(event) =>
                    setAssignments((prev) => ({ ...prev, [project.id]: event.target.value }))
                  }
                  aria-label={`Customer for ${project.name}`}
                  className="shrink-0 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                >
                  <option value="">Leave unassigned</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="sticky bottom-0 mt-6 flex items-center justify-between gap-3 border-t border-gray-200 bg-white py-3">
        <p className="text-xs text-gray-500">
          {hasChanges
            ? `${chosenNames.length} customer${chosenNames.length === 1 ? '' : 's'} to create, ${pendingAssignments.length} manual assignment${pendingAssignments.length === 1 ? '' : 's'}.`
            : 'Nothing selected yet. Nothing is written until you apply.'}
        </p>
        <button
          type="button"
          onClick={apply}
          disabled={!hasChanges || submitting}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Applying…' : 'Apply'}
        </button>
      </div>
    </div>
  );
}
