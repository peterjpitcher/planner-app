// src/components/Customers/CustomerWorkspace.jsx
'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { EllipsisVerticalIcon, TrashIcon, ArchiveBoxIcon } from '@heroicons/react/20/solid';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

import { cn, getStatusClasses } from '@/lib/styleUtils';
import { formatDate } from '@/lib/dateUtils';
import { CUSTOMER_STATUS, STATE } from '@/lib/constants';
import TaskCard from '@/components/shared/TaskCard';
import QuickTaskInput from '@/components/shared/QuickTaskInput';
import NotesPanel from '@/components/shared/NotesPanel';
import AttachmentsPanel from '@/components/shared/AttachmentsPanel';
import CustomerFacts from './CustomerFacts';
import CustomerContacts from './CustomerContacts';

// Same grouping as ProjectWorkspace, so a task looks and behaves the same
// wherever you meet it.
const STATE_GROUPS = [
  { key: STATE.TODAY, label: 'Today', labelClass: 'text-red-600' },
  { key: STATE.THIS_WEEK, label: 'This Week', labelClass: 'text-blue-600' },
  { key: STATE.BACKLOG, label: 'Backlog', labelClass: 'text-gray-500' },
  { key: STATE.WAITING, label: 'Waiting', labelClass: 'text-amber-600' },
];

function InlineEdit({ value, onSave, placeholder, disabled = false, as: Tag = 'span', className }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  function start() {
    if (disabled) return;
    setDraft(value ?? '');
    setEditing(true);
  }

  function save() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== (value || '').trim()) onSave(trimmed);
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') save();
          if (event.key === 'Escape') setEditing(false);
        }}
        aria-label={placeholder}
        className="w-full rounded-md border border-indigo-300 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
      />
    );
  }

  return (
    <Tag
      onClick={start}
      onKeyDown={(event) => {
        if (event.key === 'Enter') start();
      }}
      tabIndex={disabled ? undefined : 0}
      role={disabled ? undefined : 'button'}
      aria-label={disabled ? undefined : `Edit ${placeholder}`}
      className={cn(
        className,
        !disabled && 'cursor-text rounded px-1 -mx-1 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400'
      )}
    >
      {value || <span className="italic text-gray-400">{placeholder}</span>}
    </Tag>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-0.5 text-xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

export default function CustomerWorkspace({
  customer,
  openProjects,
  closedProjects,
  tasks,
  onUpdateCustomer,
  onArchive,
  onDelete,
  onTaskAdded,
  onCompleteTask,
  onUpdateTask,
  onDeleteTask,
  onTaskClick,
}) {
  const [showClosed, setShowClosed] = useState(false);

  // TaskCard calls useSortable, which needs a DndContext ancestor. Reordering is
  // not offered here (a customer's tasks span several projects, so there is no
  // single sort_order that means anything), but the context still has to exist.
  const sensors = useSensors(useSensor(PointerSensor));

  const isArchived = Boolean(customer.archived_at);

  const tasksByState = useMemo(() => {
    const grouped = {};
    tasks.forEach((task) => {
      (grouped[task.state] ||= []).push(task);
    });
    return grouped;
  }, [tasks]);

  return (
    <div className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <InlineEdit
            as="h1"
            value={customer.name}
            placeholder="Customer name"
            disabled={isArchived}
            onSave={(name) => onUpdateCustomer(customer.id, { name })}
            className="truncate text-xl font-semibold text-gray-900"
          />

          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <select
              value={customer.status}
              onChange={(event) => onUpdateCustomer(customer.id, { status: event.target.value })}
              disabled={isArchived}
              aria-label="Customer status"
              className={cn(
                'rounded-full border-0 px-2.5 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60',
                getStatusClasses(customer.status)
              )}
            >
              {Object.values(CUSTOMER_STATUS).map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>

            {isArchived && (
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                Archived
              </span>
            )}

            {/* Areas are being retired in favour of the customer itself. Any
                existing value still shows, but there is no longer a way to set
                one: the thing it was standing in for is now the record you are
                looking at. */}
            {customer.area && (
              <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                {customer.area}
              </span>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-gray-400">Website:</span>
            {customer.website ? (
              <a
                href={customer.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 underline hover:text-indigo-700"
              >
                {customer.website}
              </a>
            ) : (
              <InlineEdit
                value={null}
                placeholder="Add a website"
                disabled={isArchived}
                onSave={(website) => onUpdateCustomer(customer.id, { website: website || null })}
                className="text-gray-700"
              />
            )}
            {customer.website && !isArchived && (
              <button
                type="button"
                onClick={() => onUpdateCustomer(customer.id, { website: null })}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <Menu as="div" className="relative shrink-0">
          <MenuButton
            aria-label="Customer actions"
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <EllipsisVerticalIcon className="h-5 w-5" aria-hidden="true" />
          </MenuButton>
          <MenuItems className="absolute right-0 z-10 mt-1 w-52 rounded-md border border-gray-200 bg-white py-1 shadow-lg focus:outline-none">
            <MenuItem>
              <button
                type="button"
                onClick={() => onArchive(customer)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 data-[focus]:bg-gray-50"
              >
                <ArchiveBoxIcon className="h-4 w-4" aria-hidden="true" />
                {isArchived ? 'Restore from archive' : 'Archive'}
              </button>
            </MenuItem>
            <MenuItem>
              <button
                type="button"
                onClick={() => onDelete(customer)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 data-[focus]:bg-red-50"
              >
                <TrashIcon className="h-4 w-4" aria-hidden="true" />
                Remove customer record
              </button>
            </MenuItem>
          </MenuItems>
        </Menu>
      </div>

      {/* Stats */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Open projects" value={openProjects.length} />
        <StatCard label="Open tasks" value={tasks.length} />
        <StatCard label="Closed projects" value={closedProjects.length} />
        <StatCard label="Status" value={customer.status} />
      </div>

      {/* Summary */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Summary</h2>
        <textarea
          defaultValue={customer.summary || ''}
          disabled={isArchived}
          onBlur={(event) => {
            const next = event.target.value.trim();
            if (next !== (customer.summary || '').trim()) {
              onUpdateCustomer(customer.id, { summary: next || null });
            }
          }}
          rows={3}
          placeholder="The one paragraph you would tell someone about this customer."
          aria-label="Customer summary"
          className="w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-60"
        />
      </section>

      {/* Open projects */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">
          Open projects ({openProjects.length})
        </h2>
        {openProjects.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-200 py-6 text-center text-xs italic text-gray-400">
            No open projects for this customer.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {openProjects.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/projects?id=${project.id}`}
                  className="block rounded-lg border border-gray-200 bg-white p-3 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <span className="block truncate text-sm font-medium text-gray-900">
                    {project.name}
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                    <span className={cn('rounded-full px-2 py-0.5', getStatusClasses(project.status))}>
                      {project.status}
                    </span>
                    {project.due_date && <span>Due {formatDate(project.due_date, 'MMM d')}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Closed projects, collapsed. Closing a project must not make its work
          invisible, which is the whole point of surfacing it here. */}
      {closedProjects.length > 0 && (
        <section className="mt-6">
          <button
            type="button"
            onClick={() => setShowClosed((open) => !open)}
            aria-expanded={showClosed}
            className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 hover:text-gray-900"
          >
            Closed projects ({closedProjects.length})
            <span aria-hidden="true" className="text-xs text-gray-400">
              {showClosed ? 'Hide' : 'Show'}
            </span>
          </button>
          {showClosed && (
            <ul className="mt-2 space-y-1">
              {closedProjects.map((project) => (
                <li key={project.id}>
                  <Link
                    href={`/projects?id=${project.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm hover:bg-gray-100"
                  >
                    <span className="min-w-0 truncate text-gray-600">{project.name}</span>
                    <span className="shrink-0 text-xs text-gray-500">
                      {project.status}
                      {project.completed_at && ` · ${formatDate(project.completed_at, 'MMM d, yyyy')}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}


      {/* Tasks: the union of tasks pointing straight at the customer and those
          reaching it through a project. Both carry customer_id thanks to
          fn_task_customer_sync, so this is one read and a project's task cannot
          be counted twice. */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Tasks ({tasks.length})</h2>

        {!isArchived && (
          <div className="mb-3">
            <QuickTaskInput mode="single" onTaskAdded={onTaskAdded} />
          </div>
        )}

        {tasks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-200 py-6 text-center text-xs italic text-gray-400">
            No open tasks for this customer.
          </p>
        ) : (
          <div className="space-y-4">
            {STATE_GROUPS.map(({ key, label, labelClass }) => {
              const groupTasks = tasksByState[key] || [];
              if (groupTasks.length === 0) return null;
              return (
                <div key={key}>
                  <h3 className={cn('mb-1.5 text-xs font-semibold uppercase tracking-wide', labelClass)}>
                    {label} ({groupTasks.length})
                  </h3>
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={() => {}}>
                    <SortableContext
                      items={groupTasks.map((task) => task.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="flex flex-col gap-1.5">
                        {groupTasks.map((task) => (
                          <TaskCard
                            key={task.id}
                            task={task}
                            onComplete={onCompleteTask}
                            onUpdate={onUpdateTask}
                            onDelete={onDeleteTask}
                            onClick={onTaskClick}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Key facts and people: the standing reference, below the live work.
          Facts and contacts change rarely and are looked up on demand, so they
          sit under the projects and tasks you actually open the page for. */}
      <div className="mt-6">
        <CustomerFacts customerId={customer.id} disabled={isArchived} />
      </div>

      <div className="mt-6">
        <CustomerContacts customerId={customer.id} disabled={isArchived} />
      </div>

      {/* Files */}
      <section className="mt-6">
        <AttachmentsPanel parentType="customer" parentId={customer.id} disabled={isArchived} />
      </section>

      {/* The timeline: every note that reaches this customer, whether it is
          filed on them, on one of their projects (open or closed), or on one of
          their tasks. Closing a project must not make its notes disappear from
          the record, which is the whole reason this rolls up. */}
      <section className="mt-6">
        <NotesPanel
          customerId={customer.id}
          timeline
          title="Timeline"
          disabled={isArchived}
        />
      </section>
    </div>
  );
}
