'use client';

import React from 'react';
import { 
  FolderIcon, 
  ClipboardDocumentListIcon, 
  DocumentTextIcon,
  MagnifyingGlassIcon,
  PlusCircleIcon
} from '@heroicons/react/24/outline';

/**
 * Empty state for projects
 */
export function EmptyProjects({ onCreateProject }) {
  return (
    <div className="text-center py-12 px-4 bg-white rounded-lg border-2 border-dashed border-gray-300">
      <FolderIcon className="mx-auto h-12 w-12 text-gray-400" />
      <h3 className="mt-2 text-sm font-medium text-gray-900">No projects yet</h3>
      <p className="mt-1 text-sm text-gray-500">Get started by creating your first project.</p>
      {onCreateProject && (
        <button
          onClick={onCreateProject}
          className="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          <PlusCircleIcon className="h-5 w-5 mr-1.5" />
          New Project
        </button>
      )}
    </div>
  );
}

/**
 * Empty state for tasks
 */
export function EmptyTasks({ projectName, onAddTask }) {
  return (
    <div className="text-center py-8 px-4 bg-gray-50 rounded-lg border border-gray-200">
      <ClipboardDocumentListIcon className="mx-auto h-10 w-10 text-gray-400" />
      <h3 className="mt-2 text-sm font-medium text-gray-900">No tasks yet</h3>
      <p className="mt-1 text-sm text-gray-500">
        {projectName ? `Add tasks to "${projectName}" to get started.` : 'Add your first task to get started.'}
      </p>
      {onAddTask && (
        <button
          onClick={onAddTask}
          className="mt-3 inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md text-indigo-700 bg-indigo-100 hover:bg-indigo-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          Add Task
        </button>
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
      <DocumentTextIcon className="mx-auto h-8 w-8 text-gray-400" />
      <p className="mt-2 text-xs text-gray-500">No notes yet. Add a note above.</p>
    </div>
  );
}

/**
 * Empty state for search results
 */
export function EmptySearchResults({ searchTerm }) {
  return (
    <div className="text-center py-12 px-4">
      <MagnifyingGlassIcon className="mx-auto h-12 w-12 text-gray-400" />
      <h3 className="mt-2 text-sm font-medium text-gray-900">No results found</h3>
      <p className="mt-1 text-sm text-gray-500">
        No projects or tasks found matching "{searchTerm}".
      </p>
      <p className="mt-2 text-xs text-gray-400">
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
    <div className="text-center py-8 px-4 bg-gray-50 rounded-lg">
      <FolderIcon className="mx-auto h-10 w-10 text-gray-400" />
      <p className="mt-2 text-sm text-gray-600">
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
      <Icon className="mx-auto h-12 w-12 text-gray-400" />
      <h3 className="mt-2 text-sm font-medium text-gray-900">{title}</h3>
      <p className="mt-1 text-sm text-gray-500">{message}</p>
      {action && (
        <button
          onClick={action}
          className="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          {actionText}
        </button>
      )}
    </div>
  );
}