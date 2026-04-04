# Standards Enforcer Report: Prioritisation Replacement Design Spec

**Date**: 2026-04-04
**Spec reviewed**: `docs/superpowers/specs/2026-04-04-prioritisation-replacement-design.md`
**Reviewer**: Standards Enforcement Specialist (Codex QA)

---

## Findings

### STD-001 | CRITICAL | Complexity score >= 4 but spec chooses "Big Bang" — violates incremental dev rule

**Rule**: `complexity-and-incremental-dev.md` states: "Score >= 4: MUST be broken into smaller PRs with dependencies mapped."

**Issue**: The spec explicitly selects "Big bang replacement" over "Incremental migration" or "Parallel app". By the scoring rubric:
- Files touched: 30+ (score +3)
- Schema changes: new tables + drop columns + rename columns (score +3)
- External integrations: Office 365, daily email (score +2)
- Breaking changes: routes removed, API contracts changed (score +2)

This is a clear **score 5 (XL)**. The workspace rules mandate decomposition into smaller PRs with dependency mapping. The spec should define at minimum:
1. Migration-only PR (schema changes, data seeding)
2. Service layer PR (taskService, validators, constants)
3. New views PR (Today, Plan, Ideas)
4. Cleanup PR (remove old files, redirect old routes)
5. External services PR (Office 365 sync, daily email)

Each must be independently deployable with no broken intermediate state.

**Recommendation**: Rewrite the implementation plan as a multi-PR feature with dependency ordering. The "Big Bang" decision in the Decisions Log should be reconsidered or explicitly justified with a risk mitigation plan that addresses the workspace rule.

---

### STD-002 | HIGH | Validator requires project_id but spec makes it nullable

**Rule**: Existing code convention in `src/lib/validators.js`.

**Issue**: The current `validateTask()` function (line 112-114) returns an error if `project_id` is falsy:
```js
if (!task.project_id) {
  errors.project_id = 'Task must be associated with a project';
}
```
The spec makes `project_id` nullable and removes the "Unassigned project" pattern, but does not mention updating the validator to allow null `project_id`. The spec's "Code Modified in Surviving Files" table mentions updating `validators.js` for state/section/type/chips but does not call out removing the `project_id` required check.

If this validator is not updated, every task created without a project will fail validation.

**Recommendation**: Add explicit mention of removing the `project_id` required validation in `validators.js` to the spec's modification table.

---

### STD-003 | HIGH | No loading/error/empty states specified for new views

**Rule**: `ui-patterns.md` requires: "Every data-driven UI must handle all three states: Loading, Error, Empty."

**Issue**: The spec describes three new views (Today Focus, Plan Board, Idea Vault) with detailed card layouts and interactions, but none of them specify:
- **Loading states**: No skeleton loaders or spinners defined for initial data fetch
- **Error states**: No error handling UI for failed data loads or failed drag-and-drop writes
- **Empty states**: The "Daily Planning Nudges" section partially addresses empty Today ("No tasks for today yet. Pull from This Week?") but there is no empty state for Plan Board (new user with zero tasks), Idea Vault (no ideas yet), or individual columns/sections

**Recommendation**: Add a "States" subsection to each view specifying loading skeleton, error fallback, and empty state content with CTAs.

---

### STD-004 | HIGH | No auth session checks specified for new routes

**Rule**: Project CLAUDE.md states auth is NextAuth.js; `ui-patterns.md` requires "Every authenticated page must check permissions"; `definition-of-done.md` requires "Auth checks in place."

**Issue**: The spec introduces three new routes (`/today`, `/plan`, `/ideas`) but does not mention:
- NextAuth session checks on page load
- Redirect to `/login` if unauthenticated
- Session verification for any new API endpoints that may be needed (e.g., ideas CRUD)

The existing pattern uses `getAuthContext()` in API routes and session checks in pages. The spec should explicitly state these routes follow the existing auth pattern.

**Recommendation**: Add an "Authentication" section confirming all new routes require active NextAuth session and specifying which existing auth patterns to follow. Also specify whether the Ideas table needs new API routes (it almost certainly does) and their auth requirements.

---

### STD-005 | HIGH | Ideas table has no API routes or service layer specified

**Rule**: Existing patterns show API routes at `/api/tasks/route.js` and service layer at `src/services/taskService.js` for all CRUD operations.

**Issue**: The spec defines a new `ideas` table with full schema but does not specify:
- API routes for CRUD operations on ideas
- Service layer functions (createIdea, updateIdea, promoteIdea, etc.)
- Validation functions for idea data
- Auth checks for idea operations
- The "promote to task" flow's implementation (which API calls, which service functions)

The spec only describes UI interactions. Without backend specifications, implementers must guess at the API contract.

**Recommendation**: Add an "Ideas Service Layer" section specifying API routes, service functions, validation rules, and the promote-to-task workflow.

---

### STD-006 | MEDIUM | No fromDb conversion mentioned — project uses direct queries

**Rule**: Workspace `supabase.md` states: "Always wrap DB results with a conversion helper (e.g. fromDb<T>())."

**Issue**: The project CLAUDE.md clarifies this project uses "Direct Supabase queries in components (not server actions)" and the codebase uses plain JS (not TypeScript). The existing code in `taskService.js` and `TaskItem.js` does not use `fromDb()` — it accesses snake_case fields directly (`task.is_completed`, `task.due_date`, `task.project_id`).

The spec correctly uses `snake_case` for all new DB columns (`today_section`, `sort_order`, `task_type`, `waiting_reason`, `follow_up_date`, `state_changed_at`), which is consistent with the existing pattern of directly accessing snake_case fields in JS.

**Status**: The spec follows the **project's actual pattern** (direct snake_case access) rather than the workspace convention (fromDb conversion). This is acceptable per the Source of Truth Hierarchy (project patterns override workspace CLAUDE.md), but should be noted.

**Recommendation**: No change needed, but document this deliberate deviation if it comes up in review.

---

### STD-007 | MEDIUM | Date handling uses raw new Date() rather than dateUtils

**Rule**: Workspace CLAUDE.md states: "Never use raw new Date() or .toISOString() for user-facing dates. Default timezone: Europe/London."

**Issue**: The spec mentions "Completed today" filters by `completed_at >= start of today (Europe/London)` which is correct. However, the existing codebase (`TaskItem.js` lines 43, 197, 222-223, 270) already uses `new Date()` extensively without timezone conversion. The spec does not address whether the new views will use `dateUtils.getDueDateStatus()` (which exists and handles date classification) or re-implement date logic.

The spec's due date badge description ("red = overdue/today, amber = tomorrow, blue = this week, grey = future") maps exactly to the existing `getDueDateStatus()` return types (OVERDUE, TODAY, TOMORROW, THIS_WEEK, FUTURE).

**Recommendation**: Explicitly state that the new TaskCard component should use `getDueDateStatus()` from `dateUtils.js` for due date badge rendering, and that the "Completed today" boundary calculation must use Europe/London timezone.

---

### STD-008 | MEDIUM | Accessibility gaps in drag-and-drop and new interactions

**Rule**: `definition-of-done.md` requires keyboard navigation, focus styles, proper ARIA markup. `ui-patterns.md` requires accessible interactive elements.

**Issue**: The spec mentions @dnd-kit provides "keyboard accessibility" but does not specify:
- Keyboard shortcuts for drag-and-drop operations (how does a keyboard user move a task between sections?)
- ARIA roles for the kanban board columns and sortable lists
- Focus management when tasks move between sections
- Screen reader announcements for state changes (task completed, task moved)
- The Quick Capture floating input's keyboard interaction beyond Enter/Shift+Enter
- Whether swipe gestures on mobile have accessible alternatives

**Recommendation**: Add an "Accessibility" section specifying keyboard alternatives for all drag operations, ARIA live regions for state change announcements, and focus management strategy.

---

### STD-009 | MEDIUM | No testing strategy for new components

**Rule**: `testing.md` requires "Minimum per feature: happy path + at least 1 error/edge case." `definition-of-done.md` requires "New tests written for business logic."

**Issue**: The project CLAUDE.md notes "No test suite — zero test coverage, noted as tech debt." The spec does not mention testing at all. Given the scale of this change (new data model, new service layer, new views, migration), this is a significant omission. Even without an existing test suite, the spec should define:
- Which components/services are highest priority for testing
- Whether Vitest should be set up as part of this work
- At minimum: unit tests for sort order algorithm, state transition validation, chip validation, promote-to-task logic

**Recommendation**: Add a "Testing" section. At minimum, mandate unit tests for the sort order gap algorithm (which has edge cases around lazy reindex) and the state machine transitions (e.g., today_section must be set when state='today'). Consider this the right moment to add Vitest to the project.

---

### STD-010 | MEDIUM | Server vs client component strategy not addressed

**Rule**: `ui-patterns.md` states: "Default to Server Components -- only add 'use client' when you need interactivity."

**Issue**: The project CLAUDE.md notes "Heavy use of client components ('use client')" and "Direct Supabase queries in components." The spec proposes three new views with heavy interactivity (drag-and-drop, inline editing, real-time state changes) that will clearly need `'use client'`. However, the spec does not discuss:
- Whether the page-level components (`/today/page.js`, `/plan/page.js`, `/ideas/page.js`) should be server components that fetch initial data and pass to client children
- Whether there is an opportunity to use server components for the layout shell and navigation

Given the project's existing pattern of client-side everything, this may not change, but the spec should make the decision explicit.

**Recommendation**: Add a brief note on component architecture: whether pages will be server components with client children, or fully client-rendered as per existing patterns.

---

### STD-011 | MEDIUM | Migration deletes orphan notes without user consent

**Rule**: Workspace CLAUDE.md Ethics & Safety: "AI MUST stop and request explicit approval before any operation that could DELETE user data."

**Issue**: The migration SQL (spec lines 125-126) includes:
```sql
DELETE FROM notes WHERE project_id IS NULL AND task_id IS NULL;
```
This deletes orphan notes without any user-facing audit or approval step. While the spec includes a preceding audit comment (`SELECT count(*)`), the actual DELETE is unconditional.

**Recommendation**: Add a pre-migration step that logs or exports orphan notes before deletion. Alternatively, assign orphan notes to a "system" task/project rather than deleting them. At minimum, the migration should fail-safe if orphan count exceeds a threshold.

---

### STD-012 | LOW | Notes validator needs update for idea_id

**Rule**: Existing pattern in `validators.js` lines 138-139.

**Issue**: The current `validateNote()` requires either `project_id` or `task_id`. The spec adds `idea_id` as a valid parent but does not mention updating note validation to accept `idea_id` as an alternative parent.

**Recommendation**: Add `validators.js` note validation update to the "Code Modified in Surviving Files" table.

---

### STD-013 | LOW | New constants not fully specified

**Rule**: Existing pattern in `src/lib/constants.js`.

**Issue**: The spec mentions adding STATE, TODAY_SECTION, TASK_TYPE, CHIP_VALUES constants but does not define the exact shape. For consistency with the existing `PRIORITY` and `PROJECT_STATUS` patterns (object with uppercase keys mapping to database values), the spec should define:
```js
export const STATE = { TODAY: 'today', THIS_WEEK: 'this_week', ... };
export const TODAY_SECTION = { MUST_DO: 'must_do', ... };
```

**Recommendation**: Define the exact constant shapes in the spec to prevent implementation divergence.

---

### STD-014 | LOW | Soft caps and nudges have no dismissal persistence specified

**Rule**: General UX convention -- dismissable UI elements should remember dismissal state.

**Issue**: The spec states nudges are "Dismissable" but does not specify:
- Where dismissal state is stored (localStorage? database column? session?)
- Whether dismissals reset daily (appropriate for "Today is empty" nudge)
- Whether soft cap warnings can be dismissed or are always-visible

**Recommendation**: Clarify dismissal persistence strategy. localStorage with daily TTL would be the simplest approach for nudges.

---

## Summary

| Severity | Count | Key Themes |
|----------|-------|------------|
| CRITICAL | 1 | Big bang approach violates complexity/incremental dev rules |
| HIGH | 4 | Missing validator update, no loading/error/empty states, no auth spec, no ideas API |
| MEDIUM | 6 | Date handling, accessibility, testing, component architecture, data deletion, fromDb |
| LOW | 3 | Note validator, constant shapes, nudge dismissal |

**Overall assessment**: The spec is thorough on data model design, UI layout, and interaction mechanics. Its primary gap is treating this as a single deliverable when workspace rules mandate decomposition at this complexity level. Secondary gaps are missing backend specifications for the Ideas entity, missing UI state handling (loading/error/empty), and no testing plan. The spec should be revised to add a multi-PR implementation plan before proceeding to implementation.
