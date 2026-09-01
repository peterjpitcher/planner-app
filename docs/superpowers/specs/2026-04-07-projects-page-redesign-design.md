# Projects Page Redesign — Design Spec

**Date:** 2026-04-07
**Status:** Approved (revised after QA review)
**Scope:** Replace the current card-list /projects page with a sidebar + workspace layout
**Complexity:** XL — broken into implementation phases via plan

---

## Overview

The /projects page currently shows projects as expandable cards in a single column. This redesign replaces it with a fixed sidebar listing all projects on the left, and a main content panel on the right that acts as a full workspace for the selected project — showing tasks, notes, and all project details inline. When no project is selected, the main panel shows a dashboard summary of attention items across all projects.

The goal is to let the user work within a single project context without navigating away, and to surface projects that need attention (overdue, stale, empty) via one-click filters.

---

## Page Layout

Full viewport height (minus the app navigation bar). Two panels side by side:

- **Sidebar**: fixed width ~280px, left side, full height, scrollable project list
- **Main panel**: fills remaining width, scrollable independently

**Loading state**: Full-page skeleton on initial load — sidebar shows 5 placeholder items, main panel shows dashboard skeleton with 4 card placeholders and table row placeholders.

**Error state**: If initial data load fails, show an error banner at the top of the page with a retry button. Sidebar and main panel both show empty state with error message.

---

## Sidebar

Top to bottom:

### 1. New Project Button
- Full-width indigo button at the top of the sidebar
- Opens the existing `CreateProjectModal`
- Label: "+ New project"
- On project created: append to local projects list, select the new project, refresh areas if the new project has a new area value

### 2. Filter Pills
- Horizontal row of pill buttons, single-select (one active at a time)
- Keyboard navigable: arrow keys to move between pills, Enter/Space to select
- Filters:
  - **All** (default) — all active projects
  - **Overdue** — projects where `due_date < today` OR projects containing at least one task where `due_date < today`
  - **No tasks** — projects with zero active tasks (states: today, this_week, backlog, waiting)
  - **Stale** — projects where `updated_at` is 14+ days ago
  - **On Hold** — projects with status "On Hold"
- Active pill: uses `bg-indigo-100 text-indigo-700` tokens. Inactive: `bg-white border border-gray-200 text-gray-600`.
- Selecting a filter updates the project list immediately. If the currently selected project gets filtered out, clear the selection (and `?id=` from URL) and revert to dashboard summary.
- Each pill shows a count badge: e.g. "Overdue (3)"

**Date comparison rule**: All overdue/stale date comparisons MUST use `getStartOfTodayLondon()` from `dateUtils.js` to avoid timezone and DST boundary issues. Never use raw `new Date()` for date comparisons.

### 3. Area Dropdown
- Native `<select>` element below the filter pills
- Options: "All areas" (default), then each distinct area from the user's projects only (not tasks)
- Area list derived client-side from the loaded projects array using case-insensitive deduplication (normalise to lowercase for comparison, display original casing of first occurrence)
- Combines with filter pills using AND logic (e.g. "Overdue" + "The Anchor" = overdue projects in The Anchor area)
- Area comparison is case-insensitive: `project.area?.toLowerCase() === selectedArea?.toLowerCase()`
- Area represents the user's three jobs, so this acts as a workspace-level filter
- When a project's area is updated via inline edit, recompute the area list from the local projects state

### 4. Project List
- Scrollable list filling remaining sidebar height
- Keyboard navigable: arrow keys to move between items, Enter to select
- Each item shows:
  - **Status dot** (left) — colour-coded using existing `getStatusClasses()` from `styleUtils.js` (not hardcoded hex values)
  - **Project name** — truncated with ellipsis if too long
  - **Summary line** — "{n} active tasks · Due {date}" or "{n} active tasks · No due date". Task count is always active tasks only (today, this_week, backlog, waiting). Dates formatted via `formatDate()` from `dateUtils.js`.
  - **Attention indicator** (right side) — small coloured dot with priority order (only the highest-priority indicator shown):
    1. Red (highest): project is overdue or has overdue tasks
    2. Amber: project has zero active tasks
    3. Grey (lowest): project is stale (14+ days since update)
- **Selected state**: `border-l-3 border-indigo-500 bg-indigo-50` (design tokens, not hex)
- **Sort order**: status priority (In Progress > Open > On Hold > Completed > Cancelled), then by due date ascending (nulls last)
- Clicking a project item selects it and loads the workspace in the main panel
- **Empty states**:
  - No projects at all: "No projects yet. Create one to get started." with arrow pointing to the New Project button.
  - All filtered out: "No projects match the current filters." with a "Clear filters" link.
  - Only completed (toggle off): "All projects are completed. Toggle 'Show completed' to see them."

### 5. Dashboard Link
- Small text button/link above the completed toggle: "Dashboard" or a home icon
- Clicking clears the project selection, removes `?id=` from URL, and shows the dashboard summary
- Provides the desktop path back to the dashboard without relying on filters

### 6. Show Completed Toggle
- Pinned to the bottom of the sidebar, above the fold
- Checkbox label: "Show completed ({count})"
- When unchecked (default): hides Completed and Cancelled projects from the list
- When checked: shows all projects

---

## Main Panel — Dashboard Summary (No Project Selected)

Default view on page load and when no project is selected.

### Attention Cards
Horizontal row of 4 stat cards at the top:

| Card | Metric | Accent Colour | Click Action |
|------|--------|---------------|--------------|
| Overdue | Count of unique projects that are overdue (project due date OR any task due date — deduplicated, not summed) | Red (`text-red-600 bg-red-50`) | Activates "Overdue" filter in sidebar |
| No tasks | Count of projects with zero active tasks | Amber (`text-amber-600 bg-amber-50`) | Activates "No tasks" filter |
| Stale | Count of projects not updated in 14+ days | Grey (`text-gray-600 bg-gray-50`) | Activates "Stale" filter |
| On Hold | Count of on-hold projects | Blue (`text-blue-600 bg-blue-50`) | Activates "On Hold" filter |

- Attention cards always show **global counts** (all active projects, not filtered by current pill or area). This gives a consistent health overview regardless of what filter is active.
- Cards respect the `showCompleted` toggle — completed/cancelled projects are excluded from counts when the toggle is off.
- When all counts are zero, show a success state: "All projects healthy" with a green checkmark.
- Each card is clickable (keyboard accessible: focusable, Enter/Space to activate) and applies the corresponding sidebar filter.

### Project Summary Table
Below the attention cards. Compact table of all active projects:

- **Columns**: Name, Status, Tasks (active count), Due Date, Area, Last Updated
- **Table markup**: proper `<table>` with `<thead>`, `<th scope="col">` for accessibility
- **Sorted**: same as sidebar (status priority, then due date)
- **Row click**: selects the project in the sidebar and opens the workspace. Rows are keyboard navigable.
- Respects the current area dropdown filter and `showCompleted` toggle
- Does NOT respect the active filter pill (the table always shows the full list for the current area, so you can see everything at a glance)
- **Empty state**: "No projects to show." when the table would be empty

---

## Main Panel — Project Workspace (Project Selected)

### Header (always visible, inline details)

All fields are editable inline for active projects (Open, In Progress). For On Hold projects, fields are editable but a subtle banner says "This project is on hold." For Completed/Cancelled projects, fields are **read-only** and tasks/notes cannot be added — a banner shows "This project is {status}. Reopen to make changes."

- **Project name**: large text (text-xl, font-bold). Click to edit, blur to save. Input validated: required, max 255 chars.
- **Status badge**: dropdown/select styled as a pill badge. Changes save immediately on selection. Colour uses existing `getStatusClasses()` from `styleUtils.js`.
- **Due date**: displayed as a readable date via `formatDate()` from `dateUtils.js`. Clickable — opens native date picker (same pattern as TaskCard `DueDateBadge`). Colour-coded using `getDueDateStatus()` styles. Includes a "clear" action (small X button) to remove due date.
- **Area**: text display, editable on click, blur to save. Input trimmed. On change, recompute area list for the dropdown.
- **Stakeholders**: displayed as pills. Editable — comma-separated input on click, parsed to array, blur to save. Input sanitised (trimmed, empty strings removed).
- **Description**: editable text block below the metadata row. Displayed in a subtle `bg-gray-50 border border-gray-100` box. Click to edit, blur to save. Collapses to 2 lines with "show more" if content is long. Max 5000 chars.
- **Project actions menu** (three-dot or gear icon, top right): Delete project (with confirmation dialog: "Delete this project? Tasks will become unassigned."), View in Plan board link.

All saves use `apiClient.updateProject()` with optimistic local state updates. On failure, revert the local state change and show an error toast. The selected project state is derived from the projects array (not stored separately) to prevent sidebar/workspace desync.

**Input sanitisation note**: All text fields (name, description, area, stakeholders, notes) should be treated as plain text. React's default text rendering provides XSS protection, but the server-side API routes should enforce `validateNote()` for notes and add max-length validation for all project fields.

### Two-Column Body

Below the header, separated by a subtle divider. Both columns have `overflow-y: auto` and scroll independently.

#### Left Column — Tasks (~60% width)

- **Section header**: "Tasks ({active count})"
- **AddTaskInput** at the top — extracted from ProjectsView into its own shared component (`src/components/shared/AddTaskInput.jsx`). Creates tasks defaulting to due today in backlog state. Rapid-fire entry with auto-refocus.
- **Task list**: existing `TaskCard` components wrapped in `DndContext`/`SortableContext` (required by TaskCard's `useSortable` hook even though drag is a no-op — same pattern as current ProjectsView). Grouped by state with subheadings:
  - **Today** (red label, uses `text-red-600`)
  - **This Week** (blue label, uses `text-blue-600`)
  - **Backlog** (grey label, uses `text-gray-500`)
  - **Waiting** (amber label, uses `text-amber-600`)
- Empty state groups are hidden (don't show "Today" heading if no today tasks)
- **All-empty state**: "No tasks yet. Add one above to get started."
- TaskCard interactions work identically to other views: complete, move, push due date, delete, clickable due date badge, three-dot menu
- Clicking a task opens the existing `TaskDetailDrawer` as a right-side overlay
- New tasks appear immediately via local state append (no full reload)
- Completing/deleting tasks updates the sidebar task count optimistically
- **Task project reassignment**: If a task's `project_id` changes via TaskDetailDrawer, remove it from the current project's task list and add it to the new project's list (or unassigned). This requires the TaskDetailDrawer `onUpdate` callback to include the old and new project_id so the parent can regroup.

#### Right Column — Notes (~40% width)

- **Section header**: "Notes ({count})"
- **Add note input** at the top — text input, Enter to save, Escape to cancel. Disabled for completed/cancelled projects.
- **Notes list**: chronological, newest first
- Each note shows:
  - **Date stamp**: formatted via `formatDate()` from `dateUtils.js`, bold, uses `text-amber-700`
  - **Content**: body text below the date
  - Styled with `bg-amber-50 border-l-3 border-amber-400` (design tokens)
- New notes appear immediately via local state append
- Notes fetched via `apiClient.getNotes(projectId)` (positional argument, not object) when a project is selected. Returns `response.data` array (unwrap the `{ data }` wrapper).
- **Notes caching**: Wrap notes fetch in `dedupedFetch` with key `notes-{projectId}`. Clear the cache entry when a new note is created for that project.
- **Race condition protection**: Use an AbortController per project selection. When the user switches projects, abort the in-flight notes request for the previous project. On fetch completion, verify the response is for the currently selected project before setting state.
- **Loading state**: Show a skeleton (2-3 placeholder note blocks) while notes are loading.
- **Error state**: "Failed to load notes." with a retry link.
- **Empty state**: "No notes yet. Add one above."
- Both columns scroll independently

---

## Data Flow

### Initial Load
1. Fetch all projects: `apiClient.getProjects(true)` — **must fetch ALL projects, not just the first page**. The API currently defaults to limit=50. The client must either pass a high limit (e.g. `limit=500`) or paginate through all pages. This is critical — sidebar counts, filters, and the dashboard depend on the complete dataset.
2. Fetch all active tasks: `apiClient.getTasks(null, { states: 'today,this_week,backlog,waiting' })` — **must fetch ALL matching tasks**. The API currently defaults to limit=100. Same solution: pass a high limit or paginate. Grouped client-side by `project_id`.
3. Compute areas client-side from the loaded projects (case-insensitive dedup) — no separate API call needed.
4. Compute attention counts for dashboard cards using `getStartOfTodayLondon()` for all date comparisons.
5. If `?id=` is in the URL, attempt to select that project. If the project is not in the loaded list (invalid ID, different user, or outside pagination), silently clear `?id=` from the URL and show the dashboard.

### On Project Select
1. Notes for the selected project are fetched: `apiClient.getNotes(projectId)` with AbortController and `dedupedFetch` caching.
2. Tasks are already available from the initial load (grouped by project).
3. No additional project data fetch needed — project details come from the initial load.

### On Mutations
- **Task created**: append to local `tasksByProject[projectId]`, update sidebar count and attention indicators. Recompute overdue/no-tasks status for the affected project.
- **Task completed/deleted**: remove from local state, update sidebar count and attention indicators.
- **Task updated**: update in local state. If `project_id` changed, move task between project groups. If `due_date` changed, recompute overdue status. Update sidebar.
- **Task moved (state change)**: if task moved to 'done', remove from active lists. If moved between states, regroup within the project. Full reload only if regrouping logic becomes complex.
- **Note created**: append to local notes list. Clear `dedupedFetch` cache for `notes-{projectId}`.
- **Project updated**: update in local projects array (single source of truth — selectedProjectId references into this array, not a separate copy). Update sidebar display. If area changed, recompute area list.
- **Project status changed**: update local state, may affect filter visibility. If project becomes completed/cancelled, switch workspace to read-only mode.
- **Project deleted**: remove from local projects array, clear selection if it was selected, remove `?id=` from URL, show dashboard. Orphaned tasks move to unassigned state (handled server-side).
- All mutations use existing `apiClient` methods. On failure, revert the optimistic local state change and show an error toast (not a full `loadData()` which destroys scroll position).

### State Design
- `projects[]` — single source of truth for all project data
- `selectedProjectId` — string ID (not a copy of the project object). Derive the selected project via `projects.find(p => p.id === selectedProjectId)` to prevent desync.
- `tasksByProject{}` — tasks keyed by project_id
- `unassignedTasks[]` — tasks with no project_id (still needed for task reassignment flows)
- `notesByProject{}` — notes keyed by project_id (cached as loaded)
- `areas[]` — derived from projects, recomputed on project create/update
- `activeFilter` — current pill selection
- `selectedArea` — current area dropdown selection

---

## URL Behaviour

- Selecting a project sets `?id={projectId}` in the URL via `router.replace` (no navigation, just URL update)
- Clearing selection (via dashboard link or filter hiding the project) removes `?id=` from the URL
- On page load, if `?id=` is present:
  - If the project is in the loaded list and visible: auto-select it
  - If the project is in the loaded list but hidden by filters: auto-enable `showCompleted` if it's a completed project, otherwise clear filters to reveal it
  - If the project is not in the loaded list (invalid/other user): silently clear `?id=` and show dashboard
- This makes project links bookmarkable and shareable, and survives page refresh

---

## Filtering Logic

Filters and area dropdown combine with AND logic:

```
visibleProjects = projects
  .filter(showCompleted ? all : not completed/cancelled)
  .filter(area === 'All areas' ? all : project.area.toLowerCase() === selectedArea.toLowerCase())
  .filter(activeFilter === 'all' ? all : matchesFilter(project, activeFilter))
```

Filter definitions (all date comparisons use `getStartOfTodayLondon()`):
- **overdue**: project has overdue due_date OR any of its active tasks have overdue due_date (unique project count — a project matching both conditions counts once)
- **no_tasks**: `(tasksByProject[id] || []).length === 0`
- **stale**: `differenceInCalendarDays(getStartOfTodayLondon(), parseISO(project.updated_at)) >= 14`
- **on_hold**: `project.status === 'On Hold'`

Attention counts use `useMemo` to avoid recomputation on every render. Filter derivation (`visibleProjects`) also uses `useMemo` with appropriate dependencies.

---

## Unassigned Tasks

The current page has an "Unassigned tasks" section for tasks with no `project_id`. This section is **retained** in the redesign:

- Appears as a special entry at the bottom of the project list in the sidebar, below the divider and above the completed toggle
- Label: "Unassigned ({count})" with a distinct icon (inbox or tray)
- Clicking it shows a workspace-like view in the main panel with just the task list (no notes, no project header)
- This ensures tasks orphaned by project deletion are still accessible

---

## Components Affected

### New/Rewritten
- `ProjectsView.jsx` — complete rewrite to sidebar + main panel layout (orchestrator component)
- `ProjectSidebar.jsx` — new component: filter pills, area dropdown, project list, dashboard link, completed toggle
- `ProjectDashboard.jsx` — new component: attention cards + summary table
- `ProjectWorkspace.jsx` — new component: header with inline editable fields + two-column tasks/notes body
- `ProjectNotes.jsx` — new component: notes list + add note input with caching and race condition protection

### Extracted/Moved
- `AddTaskInput` — extract from ProjectsView into `src/components/shared/AddTaskInput.jsx` so it can be reused across views

### Reused As-Is
- `TaskCard` — no changes needed (still requires `DndContext`/`SortableContext` wrapper for `useSortable` hook)
- `TaskDetailDrawer` — no changes needed
- `CreateProjectModal` — no changes needed

### Removed
- `ProjectDetailDrawer` — replaced by the inline ProjectWorkspace. The drawer's functionality is absorbed into the main panel.
- `ProjectCard` (internal to ProjectsView) — replaced by the sidebar list items
- `ProjectTaskList` (internal to ProjectsView) — replaced by workspace task list

---

## Accessibility

- All interactive elements have visible focus styles (`:focus-visible` ring)
- Filter pills use `role="radiogroup"` with `role="radio"` on each pill, with `aria-checked`
- Project list items are keyboard navigable (arrow keys, Enter to select)
- Attention cards and summary table rows are keyboard accessible (focusable, Enter/Space to activate)
- Summary table uses proper `<table>`, `<thead>`, `<th scope="col">` markup
- Inline edit fields manage focus: clicking "edit" focuses the input, Escape cancels and restores focus to the trigger
- Colour is never the sole indicator — status dots have tooltip labels, attention badges have text labels alongside colour

---

## Mobile Considerations

On screens below `md` breakpoint (768px):
- Sidebar becomes a full-width project list view (stacked, not beside)
- Selecting a project navigates to a full-width workspace view
- A "Back to projects" button appears in the workspace header to return to the list
- The two-column tasks/notes layout stacks vertically (tasks above, notes below)
- Touch targets are minimum 44x44px
- This is desktop-first for this iteration — mobile is a progressive enhancement

---

## Security Notes

- All data fetches are user-scoped server-side (`session.user.id` filter) — the `?id=` URL parameter cannot be used to access other users' projects
- Project mutation routes should add `user_id` to the final write predicate (not just the read check) to close IDOR gap: `.eq('id', id).eq('user_id', userId)` on PATCH/DELETE
- Notes API route should enforce `validateNote()` server-side before insert
- All text inputs are rendered as plain text by React (no `dangerouslySetInnerHTML`)

---

## Out of Scope

- Drag-and-drop reordering of tasks within the project workspace
- Sub-projects or project nesting
- Task dependencies
- Note editing or deletion (create-only, matching current behaviour)
- Real-time collaboration or live updates from other sessions
- Stale detection based on note creation (notes do not currently touch `project.updated_at` — this is intentional and matches current behaviour)
