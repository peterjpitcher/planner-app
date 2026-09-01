# Performance Analyst Report -- Projects Page Redesign

**Date:** 2026-04-07
**Spec reviewed:** `docs/superpowers/specs/2026-04-07-projects-page-redesign-design.md`
**Analyst focus:** Pre-implementation performance risk identification
**Severity scale:** CRITICAL > HIGH > MEDIUM > LOW

---

## Executive Summary

The redesign moves from a collapsed-by-default card list to an always-visible sidebar + always-rendered workspace with live task and note data. This fundamentally changes the rendering and data-load profile. Seven performance risks were identified, two of them critical. The most dangerous is the silent task truncation caused by the API's pagination default, and the second is uncached notes fetching that fires a network round-trip on every project click.

---

## Findings

### PERF-001: Task fetch is silently capped at 100 rows -- data loss on initial load [CRITICAL]

**Location:** Spec section "Data Flow > Initial Load" step 2; `apiClient.getTasks()` line 79; `tasks/route.js` line 58-59

The spec calls `apiClient.getTasks(null, { states: 'today,this_week,backlog,waiting' })` and then groups by `project_id` to populate every project's task list. However:

- `getTasks()` does not pass a `limit` parameter.
- The API route defaults to `limit = 100` (line 58: `parseInt(searchParams.get('limit') || '100', 10)`).
- The API hard-caps at 200 (`Math.min(Math.max(parsedLimit, 1), 200)`).

A user with more than 100 active tasks across all projects will get only the first 100 (sorted by `sort_order` then `created_at`). Tasks beyond 100 simply vanish from the UI with no indication. Projects whose tasks fall outside the first 100 rows will appear to have zero tasks, breaking the "No tasks" attention filter, the sidebar task counts, and the workspace task list.

**Current code shares this bug** (ProjectsView.jsx line 496 makes the same un-paginated call), but today the damage is contained because task lists are collapsed by default -- the user must expand each card to see tasks. In the redesign the workspace always renders every task for the selected project, making missing data much more visible and confusing.

**Recommendation:**
- Pass `limit: 200` explicitly in the `getTasks` call as an immediate fix.
- Implement pagination-aware fetching: use the `pagination.hasMore` flag returned by the API and fetch additional pages in a loop, or raise the server-side maximum for this specific use case.
- Alternatively, fetch tasks per-project lazily when a project is selected, rather than all tasks upfront.

---

### PERF-002: Notes fetched on every project selection with no client-side cache [CRITICAL]

**Location:** Spec section "Data Flow > On Project Select" step 1; `apiClient.getNotes()` line 169-175

Every time the user clicks a different project in the sidebar, `apiClient.getNotes({ projectId })` fires a network request. Critically, `getNotes()` does **not** use `dedupedFetch` or any caching -- it calls `this.fetchWithAuth()` directly (compare with `getProjects()` on line 30 which wraps in `dedupedFetch`).

This means:
- Clicking project A, then B, then back to A fires three separate HTTP requests.
- Rapid project browsing (which the sidebar design encourages) creates a burst of concurrent network calls.
- Each request includes a full auth context resolution and Supabase query on the server.
- The notes API rate limit is 100/minute; a user quickly scanning 20+ projects could approach this.

**Recommendation:**
- Wrap `getNotes()` in `dedupedFetch` with a project-specific cache key (e.g., `notes-project-${projectId}`), consistent with how `getProjects` and batch endpoints already work.
- Clear the cache key when a note is created for that project.
- Consider a longer TTL for notes (they change infrequently) -- 30 seconds instead of the default 5 seconds.
- Alternatively, batch-fetch notes for all visible projects on initial load using the existing `getProjectNotesBatch()` method.

---

### PERF-003: Full re-render cascade on every filter/area change [HIGH]

**Location:** Spec section "Filtering Logic"; current ProjectsView.jsx lines 694-711

The spec describes `visibleProjects` as a derived computation that re-runs on every state change. In the redesign, filter pills, area dropdown, and "show completed" toggle each change state, which triggers:

1. Re-computation of `visibleProjects` (filter + sort on every project).
2. Re-computation of attention counts for all four dashboard cards.
3. Re-render of the entire sidebar project list.
4. Potential de-selection of the current project (spec: "If the currently selected project gets filtered out, the main panel reverts to the dashboard summary"), causing the workspace to unmount and dashboard to mount.

With the current code pattern, `visibleProjects` is computed inline in the render body (line 694) with no `useMemo`. For 50+ projects each needing task-count lookups into `tasksByProject`, this is O(projects * tasks-per-project) on every render.

**Recommendation:**
- Wrap `visibleProjects`, attention counts, and `tasksByProject` grouping in `useMemo` with proper dependency arrays.
- Memoize the sidebar list items with `React.memo` to prevent re-rendering items whose data has not changed.
- Memoize the `ProjectWorkspace` component so that a filter change that does not affect the selected project does not unmount/remount the workspace.

---

### PERF-004: Client-side task grouping runs on every state update [HIGH]

**Location:** Spec section "Data Flow > Initial Load" step 2; current ProjectsView.jsx lines 499-514

The spec states tasks are "grouped client-side by `project_id`." The current code builds `byProject` as a plain object in `loadData()`. But the redesign also requires re-grouping after every optimistic mutation:

- `handleComplete` iterates all project keys in `tasksByProject` (line 596-601).
- `handleUpdate` iterates all project keys (line 632-638).
- `handleDeleteTask` iterates all project keys (line 649-653).

Each of these creates a new `tasksByProject` object reference, which causes React to re-render every component that depends on it -- including the sidebar (task counts) and the workspace (task list). With 20 projects and 100+ tasks, this creates unnecessary object churn.

**Recommendation:**
- For optimistic mutations, update only the affected project's task array instead of cloning the entire `tasksByProject` map. Example: `setTasksByProject(prev => ({ ...prev, [projectId]: prev[projectId].filter(...) }))`.
- The current `handleComplete` and `handleDeleteTask` do not know which project the task belongs to. Pass `projectId` through the callback chain to enable targeted updates.
- Consider a `useReducer` for `tasksByProject` to make mutations more predictable and avoid stale closure issues.

---

### PERF-005: DndContext instantiated per project but drag is a no-op [MEDIUM]

**Location:** Current ProjectsView.jsx line 187; spec reuses `TaskCard` which depends on `useSortable`

The existing `ProjectTaskList` wraps every project's tasks in a `DndContext` + `SortableContext` with an empty `onDragEnd` handler. In the redesign, the workspace renders one project's tasks at a time, but `TaskCard` internally calls `useSortable()`, which requires a `DndContext` ancestor.

Each `DndContext` instantiation:
- Registers pointer/keyboard sensors.
- Sets up collision detection.
- Creates a drag overlay context.
- Monitors pointer events even when drag is never used.

For the workspace view where only one project's tasks are shown, this is a single instance (acceptable). But if the sidebar ever renders inline task previews, or if a future iteration adds drag across the summary table, this becomes multiplicative.

**Recommendation:**
- Since the spec does not include drag-and-drop (explicitly listed as out of scope), create a lightweight `TaskList` wrapper that does not use `DndContext`/`SortableContext` for the projects page.
- Alternatively, make `TaskCard` check for a DndContext ancestor and skip `useSortable()` when none is present (requires a context check or a prop flag).

---

### PERF-006: Areas endpoint queries both tasks and projects tables on every page load [MEDIUM]

**Location:** Spec section "Sidebar > Area Dropdown"; `areas/route.js` lines 19-30; `apiClient.getAreas()` line 264-267

The areas endpoint runs two parallel Supabase queries (one on `tasks`, one on `projects`) and deduplicates client-side. This fires on every page load because `getAreas()` is not wrapped in `dedupedFetch` and has no caching.

Areas change very rarely (they represent the user's jobs). Fetching two full-table scans on every mount is wasteful.

**Recommendation:**
- Wrap `getAreas()` in `dedupedFetch` with a generous TTL (e.g., `areas` key, 60-second TTL via a configurable parameter, or a separate long-TTL cache).
- Clear the cache when a project or task area is updated.
- Consider caching areas at the session level rather than refetching per page navigation.

---

### PERF-007: Optimistic mutation failure triggers full `loadData()` reload [LOW]

**Location:** Spec section "Data Flow > On Mutations" final bullet; current ProjectsView.jsx lines 607, 623, 643, 660

When any optimistic mutation fails, the catch block calls `loadData()`, which refetches ALL projects and ALL tasks from scratch. In the redesign this also implies:

- Re-computation of `tasksByProject` grouping.
- Re-computation of all attention counts.
- Re-render of the entire sidebar and workspace.
- Loss of the user's current scroll position in both panels.
- If notes were loaded, they are not refetched but the workspace re-mounts, potentially losing unsaved note input.

For a single failed task update, this is a sledgehammer response.

**Recommendation:**
- On mutation failure, revert only the affected item to its pre-mutation state (store the previous value before the optimistic update).
- Only call `loadData()` as a last resort if the revert itself fails or the state is irrecoverably inconsistent.
- Show a toast error rather than silently reverting.

---

## Risk Summary Table

| ID | Severity | Category | One-line summary |
|----|----------|----------|-----------------|
| PERF-001 | CRITICAL | Data integrity | Task fetch capped at 100 rows; projects silently show wrong task counts |
| PERF-002 | CRITICAL | Network | Notes refetched on every project click with zero caching |
| PERF-003 | HIGH | Rendering | Filter changes trigger full sidebar + workspace re-render without memoisation |
| PERF-004 | HIGH | State management | Task grouping map cloned entirely on every single-task mutation |
| PERF-005 | MEDIUM | Bundle / runtime | DndContext instantiated with sensors even though drag is out of scope |
| PERF-006 | MEDIUM | Network | Areas endpoint runs two DB queries per load with no client cache |
| PERF-007 | LOW | UX / state | Any mutation failure nukes all local state via full reload |

---

## Recommendations Priority Order

1. **Fix PERF-001 before implementation** -- this is a data correctness bug, not just performance. Either paginate properly or fetch tasks per-project on demand.
2. **Fix PERF-002 during implementation** -- add `dedupedFetch` to `getNotes()` with a project-scoped cache key. This is a one-line change in `apiClient.js`.
3. **Address PERF-003 and PERF-004 during implementation** -- use `useMemo` for derived state and targeted state updates for mutations. These are standard React patterns.
4. **Address PERF-005 and PERF-006 as follow-up** -- lower risk but easy wins.
5. **Address PERF-007 as tech debt** -- the current pattern works but degrades UX on flaky networks.
