// src/components/Projects/ProjectDashboard.jsx
'use client';

import { CheckCircleIcon } from '@heroicons/react/20/solid';
import { getStatusClasses, cn } from '@/lib/styleUtils';
import { formatDate } from '@/lib/dateUtils';

const CARDS = [
  { key: 'overdue', label: 'Overdue', countKey: 'overdue', filter: 'overdue', textClass: 'text-red-600', bgClass: 'bg-red-50', borderClass: 'border-red-200' },
  { key: 'noTasks', label: 'No Tasks', countKey: 'noTasks', filter: 'no_tasks', textClass: 'text-amber-600', bgClass: 'bg-amber-50', borderClass: 'border-amber-200' },
  { key: 'stale', label: 'Stale', countKey: 'stale', filter: 'stale', textClass: 'text-gray-600', bgClass: 'bg-gray-50', borderClass: 'border-gray-300' },
  { key: 'onHold', label: 'On Hold', countKey: 'onHold', filter: 'on_hold', textClass: 'text-blue-600', bgClass: 'bg-blue-50', borderClass: 'border-blue-200' },
];

function AttentionCards({ counts, onFilterClick }) {
  const allHealthy = Object.values(counts).every((v) => v === 0);

  if (allHealthy) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 px-6 py-4 text-center">
        <CheckCircleIcon className="mx-auto h-8 w-8 text-green-500" />
        <p className="mt-1 text-sm font-medium text-green-700">All projects healthy</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {CARDS.map((card) => {
        const count = counts[card.countKey] || 0;
        return (
          <button
            key={card.key}
            type="button"
            onClick={() => count > 0 && onFilterClick(card.filter)}
            disabled={count === 0}
            className={cn(
              'rounded-lg border px-4 py-3 text-left transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
              count > 0 ? `${card.bgClass} ${card.borderClass} hover:shadow-md cursor-pointer` : 'bg-gray-50 border-gray-200 opacity-50 cursor-default'
            )}
          >
            <p className={cn('text-2xl font-bold', count > 0 ? card.textClass : 'text-gray-400')}>
              {count}
            </p>
            <p className={cn('text-xs font-medium', count > 0 ? card.textClass : 'text-gray-400')}>
              {card.label}
            </p>
          </button>
        );
      })}
    </div>
  );
}

function SummaryTable({ projects, tasksByProject, onSelectProject }) {
  if (projects.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-500">No projects to show.</p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Name</th>
            <th scope="col" className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Status</th>
            <th scope="col" className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Tasks</th>
            <th scope="col" className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Due Date</th>
            <th scope="col" className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Area</th>
            <th scope="col" className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {projects.map((project) => {
            const taskCount = (tasksByProject[project.id] || []).length;
            const statusClasses = getStatusClasses(project.status);
            return (
              <tr
                key={project.id}
                onClick={() => onSelectProject(project.id)}
                className="cursor-pointer hover:bg-gray-50 focus-within:bg-gray-50"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectProject(project.id); } }}
              >
                <td className="whitespace-nowrap px-4 py-2.5 text-sm font-medium text-gray-900">{project.name}</td>
                <td className="whitespace-nowrap px-4 py-2.5">
                  <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', statusClasses)}>
                    {project.status}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-sm text-gray-600">{taskCount}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-sm text-gray-600">
                  {project.due_date ? formatDate(project.due_date, 'MMM d, yyyy') : '—'}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-sm text-gray-600">{project.area || '—'}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-sm text-gray-400">
                  {project.updated_at ? formatDate(project.updated_at, 'MMM d') : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ProjectDashboard({ attentionCounts, projects, tasksByProject, onFilterClick, onSelectProject }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Projects</h1>
        <p className="mt-0.5 text-sm text-gray-500">Overview of project health and attention items.</p>
      </div>

      <AttentionCards counts={attentionCounts} onFilterClick={onFilterClick} />

      <div>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">All Projects</h2>
        <SummaryTable
          projects={projects}
          tasksByProject={tasksByProject}
          onSelectProject={onSelectProject}
        />
      </div>
    </div>
  );
}
