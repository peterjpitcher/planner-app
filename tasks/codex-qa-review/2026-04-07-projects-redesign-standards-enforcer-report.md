# Standards Enforcer Report -- Projects Page Redesign Design Spec

**Date:** 2026-04-07
**Spec reviewed:** `docs/superpowers/specs/2026-04-07-projects-page-redesign-design.md`
**Reviewer:** Standards Enforcer Agent

---

## Summary

The design spec proposes replacing the current card-list Projects page with a sidebar + workspace layout across 5 new/rewritten components. The spec is strong on data flow, filtering logic, and component decomposition. However, it has significant gaps against the project's established conventions for design tokens, accessibility, error/loading/empty state coverage, date handling, mobile responsiveness, and the Definition of Done checklist. Findings are ordered by severity.

---

## Findings

### CRITICAL -- Must fix before implementation

#### STD-001: Hardcoded hex colours violate design token standard

**Standards:** Workspace CLAUDE.md (Tailwind CSS section), ui-patterns.md, definition-of-done.md
**Location:** Spec sections -- Sidebar (Project List), Main Panel (Notes)

The spec defines colours using hardcoded hex values throughout:
- Status dots: `#3b82f6`, `#22c55e`, `#f59e0b`, `#9ca3af`
- Selected state: `#eef2ff`
- Notes styling: `#fffbeb`, `#f59e0b`

The project has a full design token system in `globals.css` using CSS custom properties (`--primary`, `--accent`, `--border`, `--sidebar-*`, etc.) and a `styleUtils.js` with pre-defined `STATUS_STYLES`, `DUE_DATE_STYLES`, `BUTTON_STYLES`, and `INPUT_STYLES` constants.

**Violation:** Workspace CLAUDE.md explicitly states: "Use design tokens only -- no hardcoded hex colours in components." The Definition of Done checklist includes: "No hardcoded hex colours -- use design tokens."

**Required fix:** Replace every hex value with either a Tailwind utility class (`text-blue-500`, `bg-amber-50`) or a reference to the existing design tokens in `styleUtils.js`. The status dot colours should reuse `STATUS_STYLES` from `styleUtils.js` which already maps all five project statuses to colour classes. The notes warm background should use `bg-amber-50` with `border-amber-500`.

---

#### STD-002: Missing loading states for multiple data-fetching paths

**Standards:** ui-patterns.md (Data Fetching & Display), definition-of-done.md
**Location:** Spec sections -- Initial Load, On Project Select

The spec describes three parallel fetches on initial load (projects, tasks, areas) and a notes fetch on project select. However:

1. **No loading state specified for notes fetch.** When a project is selected, `getNotes({ projectId })` is called but the spec does not describe what the user sees while notes load. The existing `ProjectDetailDrawer` shows "Loading notes..." text -- this pattern must carry forward.
2. **No skeleton/spinner defined for the dashboard summary or workspace.** The spec mentions no loading indicator for the initial page load. The existing `ProjectsView` has a `ProjectCardSkeleton` component for this purpose.
3. **No loading state for filter changes.** If filtering involves re-computation or re-rendering large lists, user feedback is absent.

**Required fix:** The spec must define:
- A skeleton state for the sidebar project list during initial load
- A skeleton/spinner for the main panel (both dashboard and workspace views)
- A loading indicator for the notes section when a project is selected
- Loading states for attention cards while counts are computed

---

#### STD-003: Missing error state handling for new components

**Standards:** ui-patterns.md (Data Fetching & Display -- "Every data-driven UI must handle all three states"), definition-of-done.md
**Location:** Spec sections -- ProjectDashboard, ProjectWorkspace, ProjectNotes, ProjectSidebar

The spec mentions error handling only once: "On failure, revert and show error" for inline field edits. It does not specify:

1. **What happens when the initial data load fails.** The existing `ProjectsView` sets an `error` state and renders a red banner -- this pattern is absent from the spec.
2. **What happens when notes fail to load.**
3. **What happens when note creation fails.** The existing `ProjectDetailDrawer` shows inline error text below the input -- the spec says "Enter to save, Escape to cancel" but no error handling.
4. **What happens when area fetch fails.** The area dropdown depends on `apiClient.getAreas()` but no fallback is specified.
5. **What happens when task creation fails.** The existing `AddTaskInput` silently swallows errors (`catch { }`) -- the spec should explicitly decide whether to preserve this pattern or improve it.

**Required fix:** Every new component that fetches or mutates data needs an explicit error state: what the user sees, whether retry is offered, and whether the error is inline or banner-level.

---

#### STD-004: Missing empty states for new views

**Standards:** ui-patterns.md (Data Fetching & Display -- "Empty -- meaningful empty state component")
**Location:** Spec sections -- ProjectDashboard, ProjectWorkspace, ProjectNotes

The spec specifies: "Empty state groups are hidden (don't show 'Today' heading if no today tasks)" for task groupings. However:

1. **No empty state for the dashboard summary table** when no active projects exist (all completed/cancelled).
2. **No empty state for the notes section** when a project has zero notes. The existing drawer shows "No notes yet." -- this must carry forward.
3. **No empty state for the sidebar** after filtering results in zero projects (e.g., "Overdue" filter with nothing overdue). The spec says "main panel reverts to dashboard summary" but does not address the sidebar itself being empty.
4. **No empty state for the attention cards** when all counts are zero (healthy project portfolio).

**Required fix:** Define meaningful empty states for each of these scenarios, consistent with the existing patterns (dashed border container with descriptive text, as in current `ProjectsView`).

---

### HIGH -- Should fix before implementation

#### STD-005: Keyboard navigation not specified for new interactive patterns

**Standards:** ui-patterns.md (Accessibility Baseline -- "Keyboard navigation works for all interactive elements"), definition-of-done.md
**Location:** Spec sections -- Sidebar (Filter Pills, Project List), Dashboard (Attention Cards, Summary Table)

The spec introduces several new interactive patterns without specifying keyboard behaviour:

1. **Filter pills** -- No mention of arrow key navigation between pills or Enter/Space activation. The existing codebase uses Headless UI components which handle this, but the spec says "pill buttons" without specifying the component pattern.
2. **Project list items** -- Clicking selects a project, but no keyboard navigation (up/down arrows, Enter to select) is specified. This is a primary navigation element.
3. **Attention cards** -- Clickable cards with no keyboard specification.
4. **Summary table rows** -- Clickable rows with no keyboard specification.
5. **Inline editable fields** -- The spec says "click to edit, blur to save" but does not mention Escape to cancel (except for notes), Tab to move between fields, or Enter to confirm.

**Required fix:** Specify keyboard interaction for every new interactive element. Particular attention to: the sidebar project list needing `role="listbox"` or equivalent with arrow key navigation; filter pills needing `role="radiogroup"` semantics; table rows needing Enter key activation.

---

#### STD-006: Inconsistent API client pattern -- spec uses `apiClient` but drawer uses `useApiClient` hook

**Standards:** Existing code patterns
**Location:** Spec section -- Data Flow

The spec references `apiClient.getProjects()`, `apiClient.getTasks()`, `apiClient.getNotes()`, `apiClient.getAreas()`, and `apiClient.updateProject()`. The codebase has **two** API client patterns:

1. `apiClient` (singleton class in `src/lib/apiClient.js`) -- used by `ProjectsView.jsx`
2. `useApiClient()` (React hook in `src/hooks/useApiClient.js`) -- used by `ProjectDetailDrawer.jsx`

The existing `ProjectDetailDrawer` (being removed) uses `useApiClient` hook, which returns `{ data, error }` tuple responses. The `apiClient` singleton throws on error and returns raw data.

The spec should explicitly choose one pattern for the rewrite. Given that the workspace CLAUDE.md says "Follow existing code patterns in the project", and `ProjectsView.jsx` (being rewritten) already uses the singleton `apiClient`, the spec should confirm this choice and note that error handling must use try/catch (not tuple destructuring).

**Required fix:** Explicitly state which API client pattern the new components will use and ensure error handling matches the chosen pattern.

---

#### STD-007: Date handling uses raw `new Date()` instead of `dateUtils` conventions

**Standards:** Workspace CLAUDE.md (Date Handling section), `src/lib/dateUtils.js`
**Location:** Spec section -- Filtering Logic

The spec defines the "stale" filter as: `differenceInCalendarDays(today, project.updated_at) >= 14`. The "overdue" filter checks `project.due_date < today`.

The workspace CLAUDE.md states: "Always use the project's dateUtils for display. Never use raw new Date() or .toISOString() for user-facing dates. Default timezone: Europe/London."

The project has `getStartOfTodayLondon()` in `dateUtils.js` specifically for timezone-aware date comparisons. The spec's "today" comparisons should explicitly use this utility to avoid DST edge cases where a project appears overdue or stale depending on the user's local timezone vs Europe/London.

Additionally, the spec's date display for the sidebar summary line ("Due {date}") does not specify which format function to use. The project has `formatDate()` in `dateUtils.js` and `DATE_FORMATS` constants in `constants.js`.

**Required fix:** Spec should reference `getStartOfTodayLondon()` for all "today" comparisons in filter logic, and specify `formatDate()` or `getDueDateStatus()` from `dateUtils.js` for all date display.

---

#### STD-008: Delete project action missing confirmation dialog

**Standards:** ui-patterns.md (Buttons -- "Confirmation dialogs on destructive actions")
**Location:** Spec section -- Header (inline details)

The spec describes inline-editable project fields and status changes but does not mention project deletion from the workspace view. However, the existing `ProjectDetailDrawer` (being removed/absorbed) has a delete button with a two-step confirmation flow (`showDeleteConfirm` state with "Yes, delete" / "Cancel" buttons). The existing `ProjectCard` in `ProjectsView` has a "Delete project" action in its three-dot menu (currently without confirmation -- itself a standards gap).

Since the drawer's functionality is being absorbed into ProjectWorkspace, the spec must explicitly describe:
1. Where the delete action lives in the new workspace header
2. That it requires a confirmation dialog before executing

The existing codebase has two patterns: `window.confirm()` (in `ProjectItem.js`) and inline confirmation UI (in `ProjectDetailDrawer`). The inline pattern is preferred per the established Headless UI component approach.

**Required fix:** Add a delete action with inline confirmation to the ProjectWorkspace header specification.

---

#### STD-009: Mobile section is underspecified -- does not meet responsive design standards

**Standards:** Workspace CLAUDE.md (Tailwind CSS -- "Always consider responsive breakpoints"), ui-patterns.md (Navigation)
**Location:** Spec section -- Mobile Considerations

The spec says: "On screens below md breakpoint (768px): Sidebar collapses to a top dropdown/sheet that slides over. Main panel takes full width. A 'back to projects' button appears in the header to return to the list. This is a progressive enhancement -- desktop-first for this iteration."

This is too vague for implementation. Missing details:
1. **What component renders the collapsed sidebar?** "Top dropdown/sheet" is ambiguous -- is it a Headless UI `Dialog` acting as a sheet? A `Popover`? A native `<select>`?
2. **What happens to filter pills and area dropdown on mobile?** Are they inside the sheet or separate?
3. **What happens to the two-column tasks/notes layout on mobile?** Should it stack vertically? The spec only mentions the sidebar collapse.
4. **Touch targets.** The project has a `touch-targets.css` imported in globals.css but the spec does not reference it.
5. **Safe area insets.** The project has `pb-safe`, `pt-safe` utilities in `globals.css` for iOS but no mention in spec.

The existing codebase uses `sm:` breakpoint for drawer width (`sm:max-w-md` on `ProjectDetailDrawer`) and various `sm:` responsive utilities in `ProjectCompletionModal` and `AddProjectForm`. The new spec should follow these existing patterns.

**Required fix:** Define the mobile layout in sufficient detail to implement: component choices, breakpoint-specific layout changes for all sections (sidebar, filter, workspace header, two-column body), touch target sizing, and safe area handling.

---

### MEDIUM -- Should address in spec or implementation

#### STD-010: ARIA roles and labels not specified for new interactive regions

**Standards:** ui-patterns.md (Accessibility Baseline), definition-of-done.md
**Location:** All new components

The existing `ProjectsView` and `TaskCard` have good `aria-label` coverage (13 instances in ProjectsView, comprehensive labels on buttons in TaskCard). The spec introduces several new interactive regions without ARIA specification:

1. **Sidebar project list** -- needs `role="listbox"` or `role="navigation"`, `aria-label="Project list"`, `aria-selected` on selected item
2. **Filter pills** -- need `role="radiogroup"` with `role="radio"` on each pill, `aria-checked`
3. **Attention cards** -- need `role="button"` and `aria-label` describing the action ("Show overdue projects")
4. **Summary table** -- needs proper `<thead>`, `<th scope>` per ui-patterns.md
5. **Inline editable fields** -- need `aria-label` describing editable state, `aria-live="polite"` for save confirmation
6. **Show completed toggle** -- needs proper checkbox `aria-label`

**Required fix:** Either specify ARIA attributes in the spec or add an explicit note that implementation must follow the existing ARIA patterns in `ProjectsView.jsx` and `TaskCard.jsx`.

---

#### STD-011: No input validation specified for inline editable fields

**Standards:** ui-patterns.md (Forms -- "Validation errors displayed inline"), definition-of-done.md (Security -- "Input validation complete")
**Location:** Spec section -- Project Workspace Header

The project has validation constants in `constants.js`: `VALIDATION.PROJECT_NAME_MIN = 1`, `VALIDATION.PROJECT_NAME_MAX = 255`, `VALIDATION.DESCRIPTION_MAX = 1000`, `VALIDATION.STAKEHOLDER_MAX = 50`, `VALIDATION.MAX_STAKEHOLDERS = 10`.

The spec says "Click to edit, blur to save" for project name, area, description, and stakeholders, but does not specify:
1. What happens when the user clears the project name (empty string)?
2. Maximum length enforcement on any field.
3. Stakeholder count limits.
4. Whether validation errors are shown inline or silently reverted.

The existing `ProjectDetailDrawer` reverts name to original if trimmed value is empty (`handleNameBlur`). This pattern should be explicitly preserved.

**Required fix:** Specify validation rules for each inline-editable field, referencing the `VALIDATION` constants, and define the error display behaviour.

---

#### STD-012: Spec does not address focus management on view transitions

**Standards:** ui-patterns.md (Accessibility Baseline -- "Modal dialogs trap focus"), existing code patterns
**Location:** Spec sections -- Sidebar project selection, TaskDetailDrawer opening

When the user selects a project in the sidebar, the main panel changes from dashboard to workspace. The spec does not describe:
1. Where focus moves after project selection (should move to the workspace header for screen reader users).
2. Focus management when TaskDetailDrawer opens over the workspace (the existing drawer uses Headless UI `Dialog` which handles focus trapping).
3. Focus management when returning from workspace to dashboard (deselecting a project).

**Required fix:** Specify focus destination for each major view transition.

---

#### STD-013: `apiClient.getNotes()` signature mismatch with spec usage

**Standards:** Existing code patterns in `src/lib/apiClient.js`
**Location:** Spec section -- Data Flow (On Project Select)

The spec says: `apiClient.getNotes({ projectId })`. But the actual `apiClient.getNotes()` signature is:

```javascript
async getNotes(projectId = null, taskId = null)
```

This takes positional arguments, not an options object. The `useApiClient` hook uses the object pattern (`api.notes.list({ projectId })`), but `apiClient` does not. If the implementation uses the singleton `apiClient`, the call should be `apiClient.getNotes(projectId)`.

**Required fix:** Correct the spec to match the actual API client signature, or note that the signature should be updated during implementation.

---

#### STD-014: Dashboard summary table specification missing accessibility markup

**Standards:** ui-patterns.md (Accessibility Baseline -- "Tables use proper `<thead>`, `<th scope>` markup")
**Location:** Spec section -- Main Panel -- Dashboard Summary (Project Summary Table)

The spec defines columns (Name, Status, Tasks, Due Date, Area, Last Updated) and row click behaviour, but does not specify:
1. Proper semantic table markup (`<table>`, `<thead>`, `<th scope="col">`)
2. Whether the table is sortable (current spec says "Sorted: same as sidebar")
3. Row click accessibility -- clickable table rows need `role="link"` or `role="button"` with keyboard activation

**Required fix:** Specify that the summary table must use proper semantic HTML table elements per ui-patterns.md requirements.

---

### LOW -- Minor gaps, can address during implementation

#### STD-015: No mention of `console.log` or debug statement policy

**Standards:** definition-of-done.md (Deployment -- "No console.log or debug statements left in production code")
**Location:** General

The existing `ProjectDetailDrawer` already follows this standard. The existing `AddTaskInput` silently catches errors (`catch { }`). The spec should note that new components must not introduce console.log statements, and that error swallowing (empty catch blocks) should be avoided or explicitly justified.

---

#### STD-016: Two API client patterns create maintenance burden

**Standards:** Workspace CLAUDE.md (Source of Truth Hierarchy -- "Existing code patterns in the project")
**Location:** Codebase-wide concern

The codebase has both `apiClient` (singleton) and `useApiClient()` (hook). The spec's removal of `ProjectDetailDrawer` (which uses `useApiClient`) is an opportunity to consolidate. The spec should note whether the `useApiClient` hook should be deprecated or whether both patterns remain supported.

---

#### STD-017: Spec does not address the "Unassigned tasks" section

**Standards:** Existing code patterns in `ProjectsView.jsx`
**Location:** Spec section -- Components Affected

The current `ProjectsView` has an "Unassigned tasks" expandable section at the bottom, showing tasks with no `project_id`. The spec's "Components Affected" section lists what is new, reused, and removed, but does not mention the unassigned tasks section. Is it:
- Removed entirely from the projects page?
- Kept as a separate section below the main panel?
- Moved to the sidebar as a special "No project" entry?

This is a functional gap that should be clarified.

---

#### STD-018: No complexity score assigned

**Standards:** `complexity-and-incremental-dev.md` (must assign score before starting work)
**Location:** Spec metadata

The spec proposes 5 new/rewritten components, removes 2 components, introduces new URL behaviour, new data fetching patterns, and a fundamentally different page layout. This is clearly a score 4-5 (L-XL) change. Per standards:

> Score >= 4: MUST be broken into smaller PRs with dependencies mapped.

The spec should include a complexity score and a suggested PR breakdown with dependency order (e.g., PR1: ProjectSidebar + filter logic, PR2: ProjectDashboard, PR3: ProjectWorkspace + inline editing, PR4: ProjectNotes, PR5: mobile responsive polish).

---

#### STD-019: Spec uses `router.replace` for URL but does not specify import

**Standards:** Existing code patterns
**Location:** Spec section -- URL Behaviour

The spec says: "Selecting a project sets `?id={projectId}` in the URL via `router.replace`." The existing `ProjectsView` does not use Next.js router. This requires importing `useRouter` from `next/navigation` (App Router) or `useSearchParams` and `usePathname`. The spec should note this is a new dependency introduction.

---

#### STD-020: Status dot colour mapping conflicts with existing `STATUS_STYLES`

**Standards:** Existing code patterns in `styleUtils.js`
**Location:** Spec section -- Sidebar (Project List)

The spec defines status dot colours:
- In Progress: blue (`#3b82f6`)
- Open: green (`#22c55e`)

But the existing `STATUS_STYLES` in `styleUtils.js` maps:
- In Progress: **purple** (`text-purple-700`, `bg-purple-50`)
- Open: **blue** (`text-blue-700`, `bg-blue-50`)

These are different colour assignments. The spec either intentionally changes the status colour mapping or inadvertently conflicts with the existing design system. This must be reconciled to avoid user confusion across views that still use the old colours.

**Required fix:** Either update `STATUS_STYLES` globally (affecting all views) or align the spec with the existing colour mapping.

---

## Definition of Done Checklist Audit

Checking the spec against the full DoD checklist from `definition-of-done.md`:

| DoD Item | Addressed in Spec? | Notes |
|---|---|---|
| Builds successfully | Not mentioned | No build considerations noted |
| Linting passes | Not mentioned | Standard expectation |
| Type checks pass | Not mentioned | Files are `.jsx` not `.tsx` -- no type checking |
| No `any` types | N/A | JavaScript files |
| No hardcoded secrets | N/A | No secrets involved |
| No hardcoded hex colours | **FAIL** | STD-001 -- hex values throughout |
| Server action return types | N/A | No server actions |
| All existing tests pass | N/A | No test suite exists |
| New tests written | Not mentioned | Project has no test suite (tech debt) |
| Auth checks in place | Not addressed | STD note: session required but not specified |
| Permission checks present | Not addressed | See STD-021 below |
| Input validation complete | **FAIL** | STD-011 -- no validation specified |
| No new PII logging | OK | No PII concerns |
| Interactive elements have visible focus styles | Not specified | STD-005, STD-010 |
| Colour is not sole indicator of state | **Partial** | Status dots use colour only; need text labels or tooltips |
| Modal dialogs trap focus | Not specified | TaskDetailDrawer reuse handles this |
| Tables have proper markup | **FAIL** | STD-014 |
| Images have meaningful alt text | N/A | No images |
| Keyboard navigation works | **FAIL** | STD-005 |
| Complex logic commented | Not specified | Standard expectation |
| No console.log statements | Not specified | STD-015 |
| Database migrations tested | N/A | No schema changes |
| Rollback plan documented | Not mentioned | Should address for component removal |

---

## Additional Finding

#### STD-021: RBAC/permission patterns not addressed

**Standards:** ui-patterns.md (Permissions/RBAC section)

The spec does not mention authentication or permission checks. While this is a single-user app authenticated via NextAuth.js, the ui-patterns.md standard states: "Every authenticated page must check permissions via the project's permission helper" and "Server actions must re-check permissions server-side."

The existing `ProjectsView` relies on NextAuth session checks at the layout/page level. The spec should note that this protection continues to apply and that the API routes called (`/api/projects`, `/api/tasks`, `/api/notes`, `/api/areas`) all verify `session.user.id` server-side (verified in the areas route code).

This is low risk given the single-user context but should be acknowledged.

---

## Summary Statistics

| Severity | Count |
|---|---|
| Critical | 4 |
| High | 5 |
| Medium | 5 |
| Low | 7 |
| **Total** | **21** |

## Recommended Actions Before Implementation

1. **Immediately:** Replace all hex values with Tailwind classes or design token references (STD-001)
2. **Immediately:** Add loading, error, and empty state specifications for every new component (STD-002, STD-003, STD-004)
3. **Before implementation:** Specify keyboard navigation and ARIA roles (STD-005, STD-010)
4. **Before implementation:** Reconcile status colours with existing `STATUS_STYLES` (STD-020)
5. **Before implementation:** Assign complexity score and define PR breakdown (STD-018)
6. **Before implementation:** Flesh out mobile responsive section (STD-009)
7. **During implementation:** Use `dateUtils` functions for all date logic (STD-007)
8. **During implementation:** Choose and document API client pattern (STD-006)
