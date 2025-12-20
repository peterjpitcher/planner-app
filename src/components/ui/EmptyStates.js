'use client';

import React from 'react';
import {
  FolderIcon,
  ClipboardDocumentListIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
  PlusCircleIcon
} from '@heroicons/react/24/outline';
import Button from '@/components/ui/Button';

/**
 * Empty state for projects
 */
export function EmptyProjects({ onCreateProject }) {
  return (
    <div className="text-center py-12 px-4 bg-white/50 backdrop-blur-sm rounded-xl border-2 border-dashed border-[var(--surface-border)]">
      <FolderIcon className="mx-auto h-12 w-12 text-[var(--text-secondary)]/50" />
      <h3 className="mt-2 text-sm font-medium text-[var(--text-primary)]">No projects yet</h3>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">Get started by creating your first project.</p>
      {onCreateProject && (
        <div className="mt-4">
          <Button onClick={onCreateProject} icon={PlusCircleIcon}>
            New Project
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Empty state for tasks
 */
export function EmptyTasks({ projectName, onAddTask }) {
  return (
    <div className="text-center py-8 px-4 bg-[var(--surface-base)] rounded-xl border border-[var(--surface-border)]">
      <ClipboardDocumentListIcon className="mx-auto h-10 w-10 text-[var(--text-secondary)]/50" />
      <h3 className="mt-2 text-sm font-medium text-[var(--text-primary)]">No tasks yet</h3>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        {projectName ? `Add tasks to "${projectName}" to get started.` : 'Add your first task to get started.'}
      </p>
      {onAddTask && (
        <div className="mt-3">
          <Button onClick={onAddTask} variant="secondary" size="sm">
            Add Task
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Empty state for notes
 */
export function EmptyNotes() {
  return (
    <div className="text-center py-6 px-4">
      <DocumentTextIcon className="mx-auto h-8 w-8 text-[var(--text-secondary)]/50" />
      <p className="mt-2 text-xs text-[var(--text-secondary)]">No notes yet. Add a note above.</p>
    </div>
  );
}

/**
 * Empty state for search results
 */
export function EmptySearchResults({ searchTerm }) {
  return (
    <div className="text-center py-12 px-4">
      <MagnifyingGlassIcon className="mx-auto h-12 w-12 text-[var(--text-secondary)]/50" />
      <h3 className="mt-2 text-sm font-medium text-[var(--text-primary)]">No results found</h3>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        No projects or tasks found matching "{searchTerm}".
      </p>
      <p className="mt-2 text-xs text-[var(--text-secondary)]/70">
        Try searching with different keywords or check your filters.
      </p>
    </div>
  );
}

/**
 * Empty state for filtered results
 */
export function EmptyFilteredResults({ filterType }) {
  const messages = {
    overdue: 'No overdue projects found. Great job staying on track!',
    untouched: 'All projects have been updated recently.',
    noTasks: 'All projects have at least one task.',
    stakeholder: 'No projects found for this stakeholder.'
  };

  return (
    <div className="text-center py-8 px-4 bg-[var(--surface-base)] rounded-xl">
      <FolderIcon className="mx-auto h-10 w-10 text-[var(--text-secondary)]/50" />
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        {messages[filterType] || 'No items match your current filters.'}
      </p>
    </div>
  );
}

/**
 * Generic empty state
 */
export function EmptyState({
  icon: Icon = FolderIcon,
  title = 'No items',
  message = 'No items to display.',
  action,
  actionText = 'Get Started'
}) {
  return (
    <div className="text-center py-12 px-4">
      <Icon className="mx-auto h-12 w-12 text-[var(--text-secondary)]/50" />
      <h3 className="mt-2 text-sm font-medium text-[var(--text-primary)]">{title}</h3>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">{message}</p>
      {action && (
        <div className="mt-4">
          <Button onClick={action}>
            {actionText}
          </Button>
        </div>
      )}
    </div>
  );
}