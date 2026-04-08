// src/components/Projects/ProjectSidebar.jsx
'use client';

import { PlusIcon, HomeIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { getStatusClasses, cn } from '@/lib/styleUtils';
import { formatDate } from '@/lib/dateUtils';
import { getAttentionType } from '@/lib/projectFilters';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'no_tasks', label: 'No tasks' },
  { key: 'stale', label: 'Stale' },
  { key: 'on_hold', label: 'On Hold' },
];

const ATTENTION_DOT = {
  overdue: 'bg-red-500',
  no_tasks: 'bg-amber-500',
  stale: 'bg-gray-400',
};

const ATTENTION_LABEL = {
  overdue: 'Needs attention: overdue',
  no_tasks: 'Needs attention: no tasks',
  stale: 'Needs attention: stale',
};

function FilterPills({ activeFilter, onFilterChange, attentionCounts }) {
  return (
    <div className="flex flex-wrap gap-1.5 px-3 pb-2" role="radiogroup" aria-label="Project filters">
      {FILTERS.map((f) => {
        const isActive = activeFilter === f.key;
        const count = f.key === 'all' ? null : attentionCounts[f.key === 'no_tasks' ? 'noTasks' : f.key === 'on_hold' ? 'onHold' : f.key];
        return (
          <button
            key={f.key}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onFilterChange(f.key)}
            className={cn(
              'rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
              isActive ? 'bg-indigo-100 text-indigo-700' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            )}
          >
            {f.label}
            {count != null && count > 0 && (
              <span className="ml-1 text-[10px] opacity-75">({count})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function AreaDropdown({ areas, selectedArea, onAreaChange }) {
  return (
    <div className="px-3 pb-2">
      <select
        value={selectedArea}
        onChange={(e) => onAreaChange(e.target.value)}
        className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        aria-label="Filter by area"
      >
        <option value="all">All areas</option>
        {areas.map((area) => (
          <option key={area} value={area}>{area}</option>
        ))}
      </select>
    </div>
  );
}

function ProjectListItem({ project, isSelected, taskCount, attentionType, onClick }) {
  const statusClasses = getStatusClasses(project.status);
  // Extract just the bg colour class for the dot
  const dotClass = statusClasses.split(' ').find((c) => c.startsWith('bg-')) || 'bg-gray-400';

  return (
    <button
      type="button"
      onClick={() => onClick(project.id)}
      className={cn(
        'w-full text-left rounded-lg px-2.5 py-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500',
        isSelected
          ? 'bg-indigo-50 border-l-[3px] border-indigo-500'
          : 'hover:bg-gray-50 border-l-[3px] border-transparent'
      )}
      aria-current={isSelected ? 'true' : undefined}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn('h-2 w-2 shrink-0 rounded-full', dotClass)}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
          {project.name}
        </span>
        {attentionType && (
          <span
            className={cn('h-1.5 w-1.5 shrink-0 rounded-full', ATTENTION_DOT[attentionType])}
            aria-label={ATTENTION_LABEL[attentionType]}
          />
        )}
      </div>
      <div className="mt-0.5 pl-4 text-xs text-gray-500">
        {taskCount} task{taskCount !== 1 ? 's' : ''}
        {project.due_date && (
          <> · Due {formatDate(project.due_date, 'MMM d')}</>
        )}
      </div>
    </button>
  );
}

export default function ProjectSidebar({
  projects,
  tasksByProject,
  selectedProjectId,
  onSelectProject,
  onShowDashboard,
  onCreateProject,
  activeFilter,
  onFilterChange,
  selectedArea,
  onAreaChange,
  areas,
  attentionCounts,
  showCompleted,
  onToggleCompleted,
  completedCount,
  unassignedCount,
  searchQuery,
  onSearchChange,
}) {
  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-r border-gray-200 bg-gray-50/50">
      {/* New project button */}
      <div className="p-3 pb-2">
        <button
          type="button"
          onClick={onCreateProject}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <PlusIcon className="h-4 w-4" />
          New project
        </button>
      </div>

      {/* Filter pills */}
      <FilterPills
        activeFilter={activeFilter}
        onFilterChange={onFilterChange}
        attentionCounts={attentionCounts}
      />

      {/* Area dropdown */}
      <AreaDropdown areas={areas} selectedArea={selectedArea} onAreaChange={onAreaChange} />

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search projects…"
            className="w-full rounded-md border border-gray-200 bg-white py-1.5 pl-8 pr-7 text-sm text-gray-700 placeholder:text-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            aria-label="Search projects by name"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label="Clear search"
            >
              <XMarkIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="mx-3 border-t border-gray-200" />

      {/* Project list */}
      <div className="flex-1 overflow-y-auto px-1.5 py-2">
        {projects.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-sm text-gray-500">
              {activeFilter !== 'all' || selectedArea !== 'all' || searchQuery
                ? 'No projects match the current filters.'
                : 'No projects yet. Create one to get started.'}
            </p>
            {(activeFilter !== 'all' || selectedArea !== 'all' || searchQuery) && (
              <button
                type="button"
                onClick={() => { onFilterChange('all'); onAreaChange('all'); onSearchChange(''); }}
                className="mt-2 text-xs font-medium text-indigo-600 hover:text-indigo-700"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {projects.map((project) => (
              <ProjectListItem
                key={project.id}
                project={project}
                isSelected={project.id === selectedProjectId}
                taskCount={(tasksByProject[project.id] || []).length}
                attentionType={getAttentionType(project, tasksByProject[project.id] || [])}
                onClick={onSelectProject}
              />
            ))}
          </div>
        )}
      </div>

      {/* Unassigned tasks entry */}
      {unassignedCount > 0 && (
        <>
          <div className="mx-3 border-t border-gray-200" />
          <div className="px-1.5 py-1">
            <button
              type="button"
              onClick={() => onSelectProject('__unassigned__')}
              className={cn(
                'w-full text-left rounded-lg px-2.5 py-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500',
                selectedProjectId === '__unassigned__'
                  ? 'bg-indigo-50 border-l-[3px] border-indigo-500'
                  : 'hover:bg-gray-50 border-l-[3px] border-transparent'
              )}
            >
              <div className="text-sm font-medium text-gray-700">Unassigned</div>
              <div className="mt-0.5 text-xs text-gray-500">{unassignedCount} task{unassignedCount !== 1 ? 's' : ''}</div>
            </button>
          </div>
        </>
      )}

      {/* Dashboard link + completed toggle */}
      <div className="border-t border-gray-200 px-3 py-2 space-y-2">
        <button
          type="button"
          onClick={onShowDashboard}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <HomeIcon className="h-3.5 w-3.5" />
          Dashboard
        </button>
        {completedCount > 0 && (
          <label className="flex cursor-pointer items-center gap-2 px-2 text-xs text-gray-500">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(e) => onToggleCompleted(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            Show completed ({completedCount})
          </label>
        )}
      </div>
    </aside>
  );
}
