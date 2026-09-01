# Projects Page Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the /projects card-list page with a sidebar + workspace layout featuring filters, inline editing, and a dashboard summary.

**Architecture:** New `ProjectsView` orchestrator splits into 4 child components: `ProjectSidebar` (filters, project list), `ProjectDashboard` (attention cards, summary table), `ProjectWorkspace` (inline editing, tasks, notes), and `ProjectNotes` (notes with caching/abort). `AddTaskInput` extracted to shared. State lives in the orchestrator; children receive data and callbacks via props.

**Tech Stack:** React 19, Next.js 15 App Router, Headless UI, Heroicons, date-fns, Tailwind CSS, existing apiClient + requestCache

**Spec:** `docs/superpowers/specs/2026-04-07-projects-page-redesign-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/components/shared/AddTaskInput.jsx` | Create | Extract from ProjectsView — rapid-fire task input with auto-refocus |
| `src/components/Projects/ProjectSidebar.jsx` | Create | Filter pills, area dropdown, project list, dashboard link, completed toggle |
| `src/components/Projects/ProjectDashboard.jsx` | Create | Attention cards, summary table, empty/success states |
| `src/components/Projects/ProjectWorkspace.jsx` | Create | Inline-editable project header, two-column tasks/notes layout |
| `src/components/Projects/ProjectNotes.jsx` | Create | Notes list, add input, caching via dedupedFetch, AbortController |
| `src/components/Projects/ProjectsView.jsx` | Rewrite | Orchestrator — state, data fetching, callbacks, layout |
| `src/lib/apiClient.js` | Modify | Add `getAllProjects()` and `getAllTasks()` that paginate through all pages |
| `src/lib/projectFilters.js` | Create | Filter logic, attention counts, area dedup — pure functions, testable |

---

## Task 1: Extract AddTaskInput to Shared Component

**Files:**
- Create: `src/components/shared/AddTaskInput.jsx`
- Modify: `src/components/Projects/ProjectsView.jsx`

- [ ] **Step 1: Create the shared AddTaskInput component**

```jsx
// src/components/shared/AddTaskInput.jsx
'use client';

import { useRef, useState } from 'react';
import { format } from 'date-fns';
import { apiClient } from '@/lib/apiClient';

/**
 * Rapid-fire task creation input. Creates tasks with due date defaulting to today.
 * Auto-refocuses after each creation for quick sequential entry.
 *
 * @param {{ projectId: string|null, onTaskAdded: (task: object, projectId: string|null) => void }} props
 */
export default function AddTaskInput({ projectId, onTaskAdded, disabled = false }) {
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef(null);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || isSubmitting || disabled) return;
    setIsSubmitting(true);
    try {
      const newTask = await apiClient.createTask({
        name: trimmed,
        projectId: projectId ?? undefined,
        dueDate: format(new Date(), 'yyyy-MM-dd'),
        state: 'backlog',
      });
      setName('');
      onTaskAdded?.(newTask, projectId);
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch {
      // silently fail — task creation errors are rare
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Add a task…"
        maxLength={255}
        disabled={isSubmitting || disabled}
        className="flex-1 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm placeholder-gray-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={!name.trim() || isSubmitting || disabled}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        Add
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Update ProjectsView to import the shared component**

In `src/components/Projects/ProjectsView.jsx`, remove the internal `AddTaskInput` function (lines ~127-171) and replace with:

```jsx
import AddTaskInput from '@/components/shared/AddTaskInput';
```

Update all references — `AddTaskInput` is used in `ProjectTaskList` (line ~199) and the unassigned tasks section (line ~839). No prop changes needed — the shared component has the same interface.

- [ ] **Step 3: Verify the build passes**

Run: `npm run build`
Expected: Clean build with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/shared/AddTaskInput.jsx src/components/Projects/ProjectsView.jsx
git commit -m "refactor: extract AddTaskInput to shared component for reuse"
```

---

## Task 2: Add Pagination Helpers to apiClient

**Files:**
- Modify: `src/lib/apiClient.js`

- [ ] **Step 1: Add getAllProjects method**

Add after the existing `getProjects` method in `src/lib/apiClient.js`:

```javascript
async getAllProjects(includeCompleted = false) {
  const allProjects = [];
  let offset = 0;
  const limit = 200; // max allowed by API
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams();
    if (includeCompleted) params.append('includeCompleted', 'true');
    params.append('limit', limit.toString());
    params.append('offset', offset.toString());

    const response = await this.fetchWithAuth(`/api/projects?${params}`);
    const data = response.data || [];
    allProjects.push(...data);
    hasMore = response.pagination?.hasMore ?? false;
    offset += limit;
  }

  return allProjects;
}
```

- [ ] **Step 2: Add getAllTasks method**

Add after the existing `getTasks` method:

```javascript
async getAllTasks(projectId = null, options = {}) {
  const allTasks = [];
  let offset = 0;
  const limit = 200; // max allowed by API
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams();
    if (projectId) params.append('projectId', projectId);
    if (options.states) params.append('states', options.states);
    if (options.state) params.append('state', options.state);
    params.append('limit', limit.toString());
    params.append('offset', offset.toString());

    const response = await this.fetchWithAuth(`/api/tasks?${params}`);
    const data = response.data || [];
    allTasks.push(...data);
    hasMore = response.pagination?.hasMore ?? false;
    offset += limit;
  }

  return allTasks;
}
```

- [ ] **Step 3: Verify the build passes**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add src/lib/apiClient.js
git commit -m "feat: add getAllProjects and getAllTasks pagination helpers to apiClient"
```

---

## Task 3: Create projectFilters — Pure Filter Logic

**Files:**
- Create: `src/lib/projectFilters.js`

- [ ] **Step 1: Create the filter logic module**

```javascript
// src/lib/projectFilters.js
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { getStartOfTodayLondon } from '@/lib/dateUtils';

/**
 * Check if a project matches the "overdue" filter.
 * A project is overdue if its own due_date is past OR any of its active tasks are past due.
 */
export function isProjectOverdue(project, projectTasks = []) {
  const today = getStartOfTodayLondon();

  if (project.due_date) {
    const projectDue = parseISO(project.due_date);
    if (differenceInCalendarDays(today, projectDue) > 0) return true;
  }

  return projectTasks.some((task) => {
    if (!task.due_date) return false;
    const taskDue = parseISO(task.due_date);
    return differenceInCalendarDays(today, taskDue) > 0;
  });
}

/**
 * Check if a project is "stale" (not updated in 14+ days).
 */
export function isProjectStale(project) {
  if (!project.updated_at) return false;
  const today = getStartOfTodayLondon();
  const updated = parseISO(project.updated_at);
  return differenceInCalendarDays(today, updated) >= 14;
}

/**
 * Check if a project has zero active tasks.
 */
export function hasNoTasks(projectTasks = []) {
  return projectTasks.length === 0;
}

/**
 * Check if a project matches a named filter.
 */
export function matchesFilter(project, filterName, projectTasks = []) {
  switch (filterName) {
    case 'overdue':
      return isProjectOverdue(project, projectTasks);
    case 'no_tasks':
      return hasNoTasks(projectTasks);
    case 'stale':
      return isProjectStale(project);
    case 'on_hold':
      return project.status === 'On Hold';
    case 'all':
    default:
      return true;
  }
}

/**
 * Compute attention counts across all active (non-completed/cancelled) projects.
 * Returns { overdue, noTasks, stale, onHold } — each a unique project count.
 */
export function computeAttentionCounts(projects, tasksByProject) {
  let overdue = 0;
  let noTasks = 0;
  let stale = 0;
  let onHold = 0;

  for (const project of projects) {
    if (project.status === 'Completed' || project.status === 'Cancelled') continue;

    const tasks = tasksByProject[project.id] || [];
    if (isProjectOverdue(project, tasks)) overdue++;
    if (hasNoTasks(tasks)) noTasks++;
    if (isProjectStale(project)) stale++;
    if (project.status === 'On Hold') onHold++;
  }

  return { overdue, noTasks, stale, onHold };
}

/**
 * Derive unique area list from projects (case-insensitive dedup).
 * Returns array of area strings using the casing of the first occurrence.
 */
export function deriveAreas(projects) {
  const seen = new Map(); // lowercase → original casing
  for (const project of projects) {
    if (project.area) {
      const lower = project.area.toLowerCase().trim();
      if (!seen.has(lower)) {
        seen.set(lower, project.area.trim());
      }
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}

/**
 * Get the highest-priority attention type for a project.
 * Priority: overdue > noTasks > stale > null
 */
export function getAttentionType(project, projectTasks = []) {
  if (isProjectOverdue(project, projectTasks)) return 'overdue';
  if (hasNoTasks(projectTasks)) return 'no_tasks';
  if (isProjectStale(project)) return 'stale';
  return null;
}

/**
 * Filter and sort projects for the sidebar.
 */
export function getVisibleProjects(projects, tasksByProject, { showCompleted, activeFilter, selectedArea }) {
  const STATUS_ORDER = ['In Progress', 'Open', 'On Hold', 'Completed', 'Cancelled'];

  return projects
    .filter((p) => {
      if (!showCompleted && (p.status === 'Completed' || p.status === 'Cancelled')) return false;
      if (selectedArea && selectedArea !== 'all') {
        if ((p.area || '').toLowerCase() !== selectedArea.toLowerCase()) return false;
      }
      if (activeFilter && activeFilter !== 'all') {
        return matchesFilter(p, activeFilter, tasksByProject[p.id] || []);
      }
      return true;
    })
    .sort((a, b) => {
      const aOrder = STATUS_ORDER.indexOf(a.status);
      const bOrder = STATUS_ORDER.indexOf(b.status);
      if (aOrder !== bOrder) return aOrder - bOrder;
      // Due date ascending, nulls last
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return 0;
    });
}
```

- [ ] **Step 2: Verify the build passes**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/lib/projectFilters.js
git commit -m "feat: add projectFilters module with filter logic, attention counts, area dedup"
```

---

## Task 4: Create ProjectSidebar Component

**Files:**
- Create: `src/components/Projects/ProjectSidebar.jsx`

- [ ] **Step 1: Create the ProjectSidebar component**

```jsx
// src/components/Projects/ProjectSidebar.jsx
'use client';

import { useMemo } from 'react';
import { PlusIcon, HomeIcon } from '@heroicons/react/24/outline';
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

      <div className="mx-3 border-t border-gray-200" />

      {/* Project list */}
      <div className="flex-1 overflow-y-auto px-1.5 py-2">
        {projects.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-sm text-gray-500">
              {activeFilter !== 'all' || selectedArea !== 'all'
                ? 'No projects match the current filters.'
                : 'No projects yet. Create one to get started.'}
            </p>
            {(activeFilter !== 'all' || selectedArea !== 'all') && (
              <button
                type="button"
                onClick={() => { onFilterChange('all'); onAreaChange('all'); }}
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
```

- [ ] **Step 2: Verify the build passes**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/components/Projects/ProjectSidebar.jsx
git commit -m "feat: add ProjectSidebar component with filters, area dropdown, project list"
```

---

## Task 5: Create ProjectDashboard Component

**Files:**
- Create: `src/components/Projects/ProjectDashboard.jsx`

- [ ] **Step 1: Create the ProjectDashboard component**

```jsx
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
```

- [ ] **Step 2: Verify the build passes**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/components/Projects/ProjectDashboard.jsx
git commit -m "feat: add ProjectDashboard component with attention cards and summary table"
```

---

## Task 6: Create ProjectNotes Component

**Files:**
- Create: `src/components/Projects/ProjectNotes.jsx`

- [ ] **Step 1: Create the ProjectNotes component**

```jsx
// src/components/Projects/ProjectNotes.jsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/apiClient';
import { formatDate } from '@/lib/dateUtils';
import { dedupedFetch, clearCache } from '@/lib/requestCache';

export default function ProjectNotes({ projectId, disabled = false }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newNote, setNewNote] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const abortRef = useRef(null);

  const loadNotes = useCallback(async (pid) => {
    // Abort any in-flight request for a previous project
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const cacheKey = `notes-${pid}`;
      const response = await dedupedFetch(cacheKey, () =>
        apiClient.getNotes(pid)
      );

      // Guard against stale responses after project switch
      if (controller.signal.aborted) return;

      setNotes(response?.data || response || []);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError('Failed to load notes.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (projectId) {
      loadNotes(projectId);
    } else {
      setNotes([]);
      setLoading(false);
    }

    return () => abortRef.current?.abort();
  }, [projectId, loadNotes]);

  async function handleCreateNote(e) {
    if (e.key === 'Escape') {
      setNewNote('');
      return;
    }
    if (e.key !== 'Enter' || !newNote.trim() || isCreating || disabled) return;

    setIsCreating(true);
    try {
      const result = await apiClient.createNote({
        content: newNote.trim(),
        project_id: projectId,
      });
      const created = result?.data ?? result;
      setNotes((prev) => [created, ...prev]);
      setNewNote('');
      // Invalidate cache so next load gets fresh data
      clearCache(`notes-${projectId}`);
    } catch {
      // silently fail
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="flex flex-col">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">
        Notes ({notes.length})
      </h3>

      {/* Add note input */}
      <input
        type="text"
        value={newNote}
        onChange={(e) => setNewNote(e.target.value)}
        onKeyDown={handleCreateNote}
        placeholder="Add a note… (Enter to save)"
        disabled={isCreating || disabled}
        className="mb-3 w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm placeholder-gray-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50"
      />

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse rounded-lg border-l-[3px] border-amber-300 bg-amber-50/50 p-3">
              <div className="mb-2 h-3 w-20 rounded bg-amber-200/50" />
              <div className="h-3 w-full rounded bg-amber-200/30" />
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="py-4 text-center">
          <p className="text-sm text-red-600">{error}</p>
          <button
            type="button"
            onClick={() => loadNotes(projectId)}
            className="mt-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
          >
            Retry
          </button>
        </div>
      )}

      {/* Notes list */}
      {!loading && !error && (
        notes.length === 0 ? (
          <p className="py-4 text-center text-xs text-gray-400 italic">No notes yet. Add one above.</p>
        ) : (
          <div className="space-y-2 overflow-y-auto">
            {notes.map((note) => (
              <div
                key={note.id}
                className="rounded-lg border-l-[3px] border-amber-400 bg-amber-50 p-3"
              >
                <p className="text-[10px] font-semibold text-amber-700">
                  {formatDate(note.created_at, 'MMM d, yyyy')}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-gray-600">
                  {note.content}
                </p>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify the build passes**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/components/Projects/ProjectNotes.jsx
git commit -m "feat: add ProjectNotes component with caching and abort-on-switch"
```

---

## Task 7: Create ProjectWorkspace Component

**Files:**
- Create: `src/components/Projects/ProjectWorkspace.jsx`

- [ ] **Step 1: Create the ProjectWorkspace component**

```jsx
// src/components/Projects/ProjectWorkspace.jsx
'use client';

import { useCallback, useRef, useState, useMemo } from 'react';
import { Menu } from '@headlessui/react';
import { EllipsisVerticalIcon, TrashIcon } from '@heroicons/react/20/solid';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { apiClient } from '@/lib/apiClient';
import { getStatusClasses, cn } from '@/lib/styleUtils';
import { getDueDateStatus, formatDate } from '@/lib/dateUtils';
import { PROJECT_STATUS, STATE } from '@/lib/constants';
import TaskCard from '@/components/shared/TaskCard';
import AddTaskInput from '@/components/shared/AddTaskInput';
import ProjectNotes from './ProjectNotes';

const STATE_GROUPS = [
  { key: 'today', label: 'Today', labelClass: 'text-red-600' },
  { key: 'this_week', label: 'This Week', labelClass: 'text-blue-600' },
  { key: 'backlog', label: 'Backlog', labelClass: 'text-gray-500' },
  { key: 'waiting', label: 'Waiting', labelClass: 'text-amber-600' },
];

function InlineEdit({ value, onSave, as: Tag = 'span', className = '', inputClassName = '', placeholder = '', maxLength, multiline = false, disabled = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const inputRef = useRef(null);

  function startEdit() {
    if (disabled) return;
    setDraft(value || '');
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function save() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== (value || '').trim()) {
      onSave(trimmed || null);
    }
  }

  function cancel() {
    setEditing(false);
    setDraft(value || '');
  }

  if (editing) {
    const InputTag = multiline ? 'textarea' : 'input';
    return (
      <InputTag
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancel();
          if (e.key === 'Enter' && !multiline) save();
        }}
        maxLength={maxLength}
        placeholder={placeholder}
        className={cn('rounded border border-indigo-300 px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400', inputClassName)}
        rows={multiline ? 3 : undefined}
      />
    );
  }

  return (
    <Tag
      onClick={startEdit}
      className={cn('cursor-pointer rounded px-1 hover:bg-gray-100', disabled && 'cursor-default hover:bg-transparent', className)}
      tabIndex={disabled ? undefined : 0}
      onKeyDown={(e) => { if (e.key === 'Enter') startEdit(); }}
      role={disabled ? undefined : 'button'}
      aria-label={disabled ? undefined : `Edit ${placeholder || 'field'}`}
    >
      {value || <span className="text-gray-400 italic">{placeholder}</span>}
    </Tag>
  );
}

export default function ProjectWorkspace({
  project,
  tasks,
  onUpdateProject,
  onDeleteProject,
  onTaskAdded,
  onCompleteTask,
  onMoveTask,
  onUpdateTask,
  onDeleteTask,
  onTaskClick,
}) {
  const sensors = useSensors(useSensor(PointerSensor));
  const isReadOnly = project.status === 'Completed' || project.status === 'Cancelled';

  const tasksByState = useMemo(() => {
    const grouped = {};
    for (const task of tasks) {
      const state = task.state || 'backlog';
      if (!grouped[state]) grouped[state] = [];
      grouped[state].push(task);
    }
    return grouped;
  }, [tasks]);

  const statusClasses = getStatusClasses(project.status);
  const dueDateStatus = getDueDateStatus(project.due_date);
  const dateRef = useRef(null);

  return (
    <div className="space-y-4">
      {/* Read-only banner */}
      {isReadOnly && (
        <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-600">
          This project is {project.status.toLowerCase()}. Reopen to make changes.
        </div>
      )}

      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <InlineEdit
              value={project.name}
              onSave={(name) => name && onUpdateProject(project.id, { name })}
              as="h1"
              className="text-xl font-bold text-gray-900"
              inputClassName="text-xl font-bold"
              placeholder="Project name"
              maxLength={255}
              disabled={isReadOnly}
            />
            <select
              value={project.status}
              onChange={(e) => onUpdateProject(project.id, { status: e.target.value })}
              disabled={isReadOnly}
              className={cn('rounded-full border px-2.5 py-0.5 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500', statusClasses)}
            >
              {Object.values(PROJECT_STATUS).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Project actions menu */}
          <Menu as="div" className="relative shrink-0">
            <Menu.Button className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" aria-label="Project actions">
              <EllipsisVerticalIcon className="h-5 w-5" />
            </Menu.Button>
            <Menu.Items anchor="bottom end" className="z-50 w-48 rounded-md border border-gray-200 bg-white py-1 shadow-lg focus:outline-none">
              <Menu.Item>
                {({ active }) => (
                  <a href="/plan" className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-sm', active ? 'bg-gray-50 text-gray-900' : 'text-gray-700')}>
                    View in Plan board
                  </a>
                )}
              </Menu.Item>
              <div className="my-1 border-t border-gray-100" />
              <Menu.Item>
                {({ active }) => (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm('Delete this project? Tasks will become unassigned.')) {
                        onDeleteProject(project.id);
                      }
                    }}
                    className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-600', active && 'bg-red-50')}
                  >
                    <TrashIcon className="h-4 w-4" />
                    Delete project
                  </button>
                )}
              </Menu.Item>
            </Menu.Items>
          </Menu>
        </div>

        {/* Metadata row */}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-500">
          {/* Due date */}
          <span className="relative flex items-center gap-1">
            <span className="text-gray-400">Due:</span>
            {project.due_date ? (
              <>
                <button
                  type="button"
                  onClick={() => !isReadOnly && dateRef.current?.showPicker?.()}
                  className={cn(
                    'rounded px-1.5 py-0.5 text-xs font-medium',
                    dueDateStatus?.styles?.bg, dueDateStatus?.styles?.text,
                    !isReadOnly && 'cursor-pointer hover:ring-1 hover:ring-indigo-300'
                  )}
                  disabled={isReadOnly}
                >
                  {formatDate(project.due_date, 'MMM d, yyyy')}
                </button>
                {!isReadOnly && (
                  <button
                    type="button"
                    onClick={() => onUpdateProject(project.id, { due_date: null })}
                    className="text-xs text-gray-400 hover:text-red-500"
                    aria-label="Clear due date"
                  >
                    ×
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={() => !isReadOnly && dateRef.current?.showPicker?.()}
                className="text-xs text-gray-400 hover:text-indigo-600"
                disabled={isReadOnly}
              >
                Set date
              </button>
            )}
            <input
              ref={dateRef}
              type="date"
              className="absolute inset-0 h-full w-0 opacity-0"
              tabIndex={-1}
              value={project.due_date || ''}
              onChange={(e) => onUpdateProject(project.id, { due_date: e.target.value || null })}
            />
          </span>

          <span className="text-gray-300">|</span>

          {/* Area */}
          <span className="flex items-center gap-1">
            <span className="text-gray-400">Area:</span>
            <InlineEdit
              value={project.area}
              onSave={(area) => onUpdateProject(project.id, { area })}
              placeholder="Add area"
              maxLength={255}
              disabled={isReadOnly}
            />
          </span>

          <span className="text-gray-300">|</span>

          {/* Stakeholders */}
          <span className="flex items-center gap-1">
            <span className="text-gray-400">Stakeholders:</span>
            <InlineEdit
              value={(project.stakeholders || []).join(', ')}
              onSave={(val) => {
                const parsed = val ? val.split(',').map((s) => s.trim()).filter(Boolean) : [];
                onUpdateProject(project.id, { stakeholders: parsed });
              }}
              placeholder="Add stakeholders"
              disabled={isReadOnly}
            />
          </span>
        </div>

        {/* Description */}
        <div className="mt-3">
          <InlineEdit
            value={project.description}
            onSave={(description) => onUpdateProject(project.id, { description })}
            as="div"
            className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-600"
            inputClassName="w-full text-sm"
            placeholder="Add a description…"
            maxLength={5000}
            multiline
            disabled={isReadOnly}
          />
        </div>
      </div>

      <div className="border-t border-gray-100" />

      {/* Two-column body */}
      <div className="flex gap-6" style={{ minHeight: '400px' }}>
        {/* Left: Tasks */}
        <div className="flex-[3] min-w-0 overflow-y-auto">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">Tasks ({tasks.length})</h3>

          {!isReadOnly && (
            <div className="mb-3">
              <AddTaskInput projectId={project.id} onTaskAdded={onTaskAdded} />
            </div>
          )}

          {tasks.length === 0 ? (
            <p className="py-4 text-center text-xs text-gray-400 italic">
              {isReadOnly ? 'No active tasks.' : 'No tasks yet. Add one above to get started.'}
            </p>
          ) : (
            <div className="space-y-4">
              {STATE_GROUPS.map(({ key, label, labelClass }) => {
                const groupTasks = tasksByState[key] || [];
                if (groupTasks.length === 0) return null;
                return (
                  <div key={key}>
                    <p className={cn('mb-1.5 text-[10px] font-bold uppercase tracking-wide', labelClass)}>
                      {label}
                    </p>
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={() => {}}>
                      <SortableContext items={groupTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                        <div className="flex flex-col gap-1.5">
                          {groupTasks.map((task) => (
                            <TaskCard
                              key={task.id}
                              task={task}
                              isDragging={false}
                              onComplete={onCompleteTask}
                              onMove={onMoveTask}
                              onUpdate={onUpdateTask}
                              onClick={onTaskClick}
                              onDelete={onDeleteTask}
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
        </div>

        {/* Right: Notes */}
        <div className="flex-[2] min-w-0 overflow-y-auto">
          <ProjectNotes projectId={project.id} disabled={isReadOnly} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the build passes**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/components/Projects/ProjectWorkspace.jsx
git commit -m "feat: add ProjectWorkspace with inline editing, tasks, and notes columns"
```

---

## Task 8: Rewrite ProjectsView Orchestrator

**Files:**
- Rewrite: `src/components/Projects/ProjectsView.jsx`

- [ ] **Step 1: Rewrite the ProjectsView component**

```jsx
// src/components/Projects/ProjectsView.jsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { STATE } from '@/lib/constants';
import {
  computeAttentionCounts,
  deriveAreas,
  getVisibleProjects,
  matchesFilter,
} from '@/lib/projectFilters';
import TaskDetailDrawer from '@/components/shared/TaskDetailDrawer';
import CreateProjectModal from './CreateProjectModal';
import ProjectSidebar from './ProjectSidebar';
import ProjectDashboard from './ProjectDashboard';
import ProjectWorkspace from './ProjectWorkspace';

function ProjectsViewSkeleton() {
  return (
    <div className="flex h-full animate-pulse">
      <div className="w-[280px] shrink-0 border-r border-gray-200 bg-gray-50/50 p-3 space-y-3">
        <div className="h-9 rounded-md bg-gray-200" />
        <div className="flex gap-1.5">{[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-6 w-14 rounded-full bg-gray-200" />)}</div>
        <div className="h-8 rounded-md bg-gray-200" />
        <div className="space-y-2 pt-2">{[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 rounded-lg bg-gray-200" />)}</div>
      </div>
      <div className="flex-1 p-6 space-y-4">
        <div className="grid grid-cols-4 gap-3">{[1, 2, 3, 4].map((i) => <div key={i} className="h-20 rounded-lg bg-gray-100" />)}</div>
        <div className="h-64 rounded-lg bg-gray-100" />
      </div>
    </div>
  );
}

export default function ProjectsView() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Core data
  const [projects, setProjects] = useState([]);
  const [tasksByProject, setTasksByProject] = useState({});
  const [unassignedTasks, setUnassignedTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Selection & filters
  const [selectedProjectId, setSelectedProjectId] = useState(searchParams.get('id') || null);
  const [activeFilter, setActiveFilter] = useState('all');
  const [selectedArea, setSelectedArea] = useState('all');
  const [showCompleted, setShowCompleted] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);

  // ---- Data fetching ----
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [allProjects, allTasks] = await Promise.all([
        apiClient.getAllProjects(true),
        apiClient.getAllTasks(null, { states: 'today,this_week,backlog,waiting' }),
      ]);

      const byProject = {};
      const unassigned = [];
      for (const task of allTasks) {
        if (task.project_id) {
          if (!byProject[task.project_id]) byProject[task.project_id] = [];
          byProject[task.project_id].push(task);
        } else {
          unassigned.push(task);
        }
      }

      setProjects(allProjects);
      setTasksByProject(byProject);
      setUnassignedTasks(unassigned);

      // Validate URL-based selection
      const urlId = searchParams.get('id');
      if (urlId) {
        const found = allProjects.find((p) => p.id === urlId);
        if (found) {
          setSelectedProjectId(urlId);
          // Auto-show completed if the project is completed
          if (found.status === 'Completed' || found.status === 'Cancelled') {
            setShowCompleted(true);
          }
        } else {
          // Invalid or inaccessible project — clear from URL
          setSelectedProjectId(null);
          router.replace('/projects', { scroll: false });
        }
      }
    } catch (err) {
      setError(err.message || 'Failed to load projects.');
    } finally {
      setLoading(false);
    }
  }, [searchParams, router]);

  useEffect(() => { loadData(); }, [loadData]);

  // ---- Derived state (memoised) ----
  const areas = useMemo(() => deriveAreas(projects), [projects]);

  const attentionCounts = useMemo(
    () => computeAttentionCounts(projects, tasksByProject),
    [projects, tasksByProject]
  );

  const visibleProjects = useMemo(
    () => getVisibleProjects(projects, tasksByProject, { showCompleted, activeFilter, selectedArea }),
    [projects, tasksByProject, showCompleted, activeFilter, selectedArea]
  );

  // For dashboard table: respects area and showCompleted but NOT active filter pill
  const dashboardProjects = useMemo(
    () => getVisibleProjects(projects, tasksByProject, { showCompleted, activeFilter: 'all', selectedArea }),
    [projects, tasksByProject, showCompleted, selectedArea]
  );

  const completedCount = useMemo(
    () => projects.filter((p) => p.status === 'Completed' || p.status === 'Cancelled').length,
    [projects]
  );

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  const selectedProjectTasks = useMemo(
    () => tasksByProject[selectedProjectId] || [],
    [tasksByProject, selectedProjectId]
  );

  // ---- Selection handlers ----
  function selectProject(projectId) {
    setSelectedProjectId(projectId);
    setSelectedTask(null);
    router.replace(projectId ? `/projects?id=${projectId}` : '/projects', { scroll: false });
  }

  function showDashboard() {
    selectProject(null);
  }

  function handleFilterChange(filter) {
    setActiveFilter(filter);
    // If current project gets filtered out, clear selection
    if (selectedProjectId && filter !== 'all') {
      const project = projects.find((p) => p.id === selectedProjectId);
      if (project && !matchesFilter(project, filter, tasksByProject[selectedProjectId] || [])) {
        selectProject(null);
      }
    }
  }

  // ---- Project mutation handlers ----
  const handleUpdateProject = useCallback(async (projectId, updates) => {
    // Optimistic update
    setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, ...updates } : p)));
    try {
      await apiClient.updateProject(projectId, updates);
    } catch {
      loadData(); // Revert on failure
    }
  }, [loadData]);

  const handleDeleteProject = useCallback(async (projectId) => {
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    if (selectedProjectId === projectId) selectProject(null);
    try {
      await apiClient.deleteProject(projectId);
    } catch {
      loadData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadData, selectedProjectId]);

  const handleProjectCreated = useCallback(() => {
    setIsCreateOpen(false);
    loadData(); // Full reload to get the new project with server-generated fields
  }, [loadData]);

  // ---- Task mutation handlers ----
  const handleTaskAdded = useCallback((newTask, projectId) => {
    if (!newTask?.id) return;
    if (projectId) {
      setTasksByProject((prev) => ({
        ...prev,
        [projectId]: [...(prev[projectId] || []), newTask],
      }));
    } else {
      setUnassignedTasks((prev) => [...prev, newTask]);
    }
  }, []);

  const handleCompleteTask = useCallback(async (taskId) => {
    setTasksByProject((prev) => {
      const next = { ...prev };
      for (const [pid, tasks] of Object.entries(next)) {
        next[pid] = tasks.filter((t) => t.id !== taskId);
      }
      return next;
    });
    setUnassignedTasks((prev) => prev.filter((t) => t.id !== taskId));
    try {
      await apiClient.updateTask(taskId, { state: 'done' });
    } catch {
      loadData();
    }
  }, [loadData]);

  const handleMoveTask = useCallback(async (taskId, targetState, targetSection) => {
    const updates = { state: targetState };
    if (targetSection) updates.today_section = targetSection;
    if (targetState === STATE.TODAY && !targetSection) updates.today_section = 'good_to_do';

    // Optimistic: update state in local data
    const updateInGroups = (groups) => {
      const next = { ...groups };
      for (const [pid, tasks] of Object.entries(next)) {
        next[pid] = tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t));
      }
      return next;
    };
    setTasksByProject(updateInGroups);

    try {
      await apiClient.updateTask(taskId, updates);
    } catch {
      loadData();
    }
  }, [loadData]);

  const handleUpdateTask = useCallback(async (taskId, updates) => {
    const updateInList = (tasks) => tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t));
    setTasksByProject((prev) => {
      const next = { ...prev };
      for (const [pid, tasks] of Object.entries(next)) {
        next[pid] = updateInList(tasks);
      }
      return next;
    });
    setUnassignedTasks((prev) => updateInList(prev));
    setSelectedTask((prev) => (prev && prev.id === taskId ? { ...prev, ...updates } : prev));
    try {
      await apiClient.updateTask(taskId, updates);
    } catch {
      loadData();
    }
  }, [loadData]);

  const handleDeleteTask = useCallback(async (taskId) => {
    setTasksByProject((prev) => {
      const next = { ...prev };
      for (const [pid, tasks] of Object.entries(next)) {
        next[pid] = tasks.filter((t) => t.id !== taskId);
      }
      return next;
    });
    setUnassignedTasks((prev) => prev.filter((t) => t.id !== taskId));
    setSelectedTask((prev) => (prev && prev.id === taskId ? null : prev));
    try {
      await apiClient.deleteTask(taskId);
    } catch {
      loadData();
    }
  }, [loadData]);

  const handleTaskClick = useCallback((taskId) => {
    for (const tasks of Object.values(tasksByProject)) {
      const found = tasks.find((t) => t.id === taskId);
      if (found) { setSelectedTask(found); return; }
    }
    const found = unassignedTasks.find((t) => t.id === taskId);
    if (found) setSelectedTask(found);
  }, [tasksByProject, unassignedTasks]);

  // ---- Render ----
  if (loading) return <ProjectsViewSkeleton />;

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-red-600">{error}</p>
          <button type="button" onClick={loadData} className="mt-2 text-sm font-medium text-indigo-600 hover:text-indigo-700">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      <ProjectSidebar
        projects={visibleProjects}
        tasksByProject={tasksByProject}
        selectedProjectId={selectedProjectId}
        onSelectProject={selectProject}
        onShowDashboard={showDashboard}
        onCreateProject={() => setIsCreateOpen(true)}
        activeFilter={activeFilter}
        onFilterChange={handleFilterChange}
        selectedArea={selectedArea}
        onAreaChange={setSelectedArea}
        areas={areas}
        attentionCounts={attentionCounts}
        showCompleted={showCompleted}
        onToggleCompleted={setShowCompleted}
        completedCount={completedCount}
        unassignedCount={unassignedTasks.length}
      />

      <main className="flex-1 overflow-y-auto px-6 py-5">
        {selectedProject ? (
          <ProjectWorkspace
            project={selectedProject}
            tasks={selectedProjectTasks}
            onUpdateProject={handleUpdateProject}
            onDeleteProject={handleDeleteProject}
            onTaskAdded={handleTaskAdded}
            onCompleteTask={handleCompleteTask}
            onMoveTask={handleMoveTask}
            onUpdateTask={handleUpdateTask}
            onDeleteTask={handleDeleteTask}
            onTaskClick={handleTaskClick}
          />
        ) : (
          <ProjectDashboard
            attentionCounts={attentionCounts}
            projects={dashboardProjects}
            tasksByProject={tasksByProject}
            onFilterClick={(filter) => { setActiveFilter(filter); }}
            onSelectProject={selectProject}
          />
        )}
      </main>

      {/* Task detail drawer */}
      <TaskDetailDrawer
        task={selectedTask}
        isOpen={!!selectedTask}
        onClose={() => setSelectedTask(null)}
        onUpdate={handleUpdateTask}
        onDelete={handleDeleteTask}
      />

      {/* Create project modal */}
      <CreateProjectModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={handleProjectCreated}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify the build passes**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Manually test in browser**

Run: `npm run dev`

Test each scenario:
1. Page loads with dashboard summary (no `?id=` in URL)
2. Click a project — workspace loads with tasks and notes
3. Click "Dashboard" in sidebar — returns to dashboard
4. Filter pills work — project list updates, counts show
5. Area dropdown filters by job
6. Inline editing works on project name, description, status, due date, area, stakeholders
7. Add a task — appears in task list, sidebar count updates
8. Complete a task — removed from list, sidebar count updates
9. Add a note — appears in notes list
10. Switch projects rapidly — no race condition on notes
11. `?id=` in URL selects the project on load
12. Delete project — returns to dashboard

- [ ] **Step 4: Commit**

```bash
git add src/components/Projects/ProjectsView.jsx
git commit -m "feat: rewrite ProjectsView with sidebar + workspace layout"
```

---

## Task 9: Clean Up Removed Components

**Files:**
- Delete: `src/components/Projects/ProjectDetailDrawer.jsx`

- [ ] **Step 1: Check for imports of ProjectDetailDrawer**

Search for `ProjectDetailDrawer` imports across the codebase. It was imported in the old `ProjectsView.jsx` which we've already rewritten. Confirm no other files import it.

Run: `grep -r "ProjectDetailDrawer" src/ --include="*.jsx" --include="*.tsx" --include="*.js" --include="*.ts" -l`

Expected: No results (or only the file itself).

- [ ] **Step 2: Delete ProjectDetailDrawer**

```bash
rm src/components/Projects/ProjectDetailDrawer.jsx
```

- [ ] **Step 3: Verify the build passes**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove ProjectDetailDrawer, replaced by inline ProjectWorkspace"
```

---

## Task 10: Final Integration Testing & Polish

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: Zero errors, zero warnings. Fix any issues.

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Clean production build.

- [ ] **Step 3: Test all flows end-to-end**

Start dev server: `npm run dev`

Verify all flows from the spec:
- [ ] Dashboard loads with correct attention counts
- [ ] Attention cards are clickable and apply filters
- [ ] Summary table shows all projects, clickable rows
- [ ] Sidebar filters work (All, Overdue, No tasks, Stale, On Hold)
- [ ] Area dropdown filters correctly (case-insensitive)
- [ ] Project selection shows workspace with all details
- [ ] All inline fields are editable (name, status, due date, area, stakeholders, description)
- [ ] Due date picker works, clear button works
- [ ] Tasks grouped by state (Today, This Week, Backlog, Waiting)
- [ ] AddTaskInput creates tasks with due date = today
- [ ] Task complete/delete/move work with sidebar count updates
- [ ] Notes load, create, and display correctly
- [ ] Rapid project switching doesn't show wrong notes
- [ ] URL updates with `?id=` on project select
- [ ] URL clears on dashboard return
- [ ] Deep link `?id=xyz` works on page refresh
- [ ] Completed projects are read-only
- [ ] Project delete works with confirmation
- [ ] Show completed toggle works
- [ ] Empty states display for: no projects, filtered empty, no tasks, no notes
- [ ] Loading skeleton shows on initial load
- [ ] Error state shows with retry button on failure

- [ ] **Step 4: Commit any polish fixes**

```bash
git add -A
git commit -m "fix: polish and integration fixes for projects page redesign"
```
