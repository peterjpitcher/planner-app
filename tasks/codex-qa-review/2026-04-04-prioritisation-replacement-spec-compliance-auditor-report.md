# Spec Compliance Audit Report

**Spec**: `docs/superpowers/specs/2026-04-04-prioritisation-replacement-design.md`
**Auditor**: QA Spec Compliance Agent
**Date**: 2026-04-04
**Scope**: Verify the spec correctly accounts for all existing code that must change

---

## Summary

The spec is thorough and covers the majority of files that reference priority, importance_score, urgency_score, is_completed, and job. However, there are **19 gaps** ranging from missing files to incomplete field accounting and ambiguous migration steps. The most critical gaps involve files the spec does not mention at all, incomplete handling of the Office 365 sync service's two-way priority/completion mapping, and the apiClient layer that bridges the frontend to the API.

---

## Findings

### SPEC-001: TargetProjectContext file extension mismatch
- **Spec Reference:** Removals > Files Removed Entirely
- **Requirement:** Spec lists `src/contexts/TargetProjectContext.tsx` for removal
- **Code Reference:** `src/contexts/TargetProjectContext.js:1` (file is `.js`, not `.tsx`)
- **Status:** Deviated
- **Severity:** Low
- **Description:** The spec references the file as `.tsx` but the actual file on disk is `src/contexts/TargetProjectContext.js`. This is a cosmetic error in the spec, but could cause confusion during implementation if someone looks for a `.tsx` file that does not exist.
- **Impact:** Implementer may not find the file to delete or may create a deletion script that misses it.
- **Suggested Resolution:** Correct the spec to reference `src/contexts/TargetProjectContext.js`.

---

### SPEC-002: TargetProjectProvider in layout.js not accounted for
- **Spec Reference:** Removals > Files Removed Entirely (TargetProjectContext)
- **Requirement:** Spec says to remove `TargetProjectContext`. It does not mention updating consumers.
- **Code Reference:** `src/app/layout.js` (imports and wraps app with `TargetProjectProvider`)
- **Status:** Missing
- **Severity:** High
- **Description:** `src/app/layout.js` imports `TargetProjectProvider` from the context and wraps the application in it. Deleting the context file without updating `layout.js` will cause a build failure. The spec's "Code Modified in Surviving Files" table does not mention `layout.js`.
- **Impact:** Build breakage. The app will not compile after migration if this is not addressed.
- **Suggested Resolution:** Add `src/app/layout.js` to the "Code Modified in Surviving Files" table with the instruction to remove the `TargetProjectProvider` import and wrapper.

---

### SPEC-003: apiClient layer not mentioned
- **Spec Reference:** Code Modified in Surviving Files
- **Requirement:** The spec lists API routes and services that change, but does not mention the client-side API abstraction layer.
- **Code Reference:** `src/lib/apiClient.js` or equivalent (used by nearly every component)
- **Status:** Missing
- **Severity:** Critical
- **Description:** Every component that creates or updates tasks calls `apiClient.createTask()`, `apiClient.updateTask()`, etc., passing fields like `is_completed`, `priority`, `job`, and `importance_score`. These methods likely construct request payloads and parse responses. The apiClient must be updated to:
  1. Stop sending `priority`, `importance_score`, `urgency_score`, `is_completed`, `job`
  2. Start sending `state`, `today_section`, `sort_order`, `chips`, `area`, `task_type`, `waiting_reason`, `follow_up_date`
  3. Update response parsing for new fields

  The spec does not mention this file at all.
- **Impact:** Even if the API routes and services are updated, the frontend will continue sending old field names and fail to send new ones, causing silent data loss or errors.
- **Suggested Resolution:** Add `src/lib/apiClient.js` (or equivalent) to the "Code Modified in Surviving Files" table with explicit field mapping changes.

---

### SPEC-004: Office 365 inbound sync writes `priority` and `is_completed` to local DB
- **Spec Reference:** External Services Impact > Office 365 Sync Service
- **Requirement:** Spec says "Replace `is_completed` check with `state === 'done'`" and "Remove `priority` to Graph `importance` mapping entirely".
- **Code Reference:** `src/services/office365SyncService.js:658-659` (inbound sync: `priority: toLocalPriority(remoteTask?.importance)`, `is_completed: remoteTask?.status === 'completed'`) and lines 795-800 (update path)
- **Status:** Partial
- **Severity:** Critical
- **Description:** The spec only describes outbound changes (local-to-Graph mapping). The Office 365 sync also has an **inbound** path where it writes `priority` and `is_completed` back to the local database when pulling changes from Microsoft Graph. After migration, these columns will not exist. The inbound sync must be updated to:
  1. Map Graph `status === 'completed'` to local `state = 'done'` (and set `completed_at`)
  2. Map Graph `status !== 'completed'` to preserve existing `state` (not reset it)
  3. Stop writing `priority` entirely (or map `importance` to a chip like `high_impact`)
  4. The `buildTodoTaskPayload` function (line 203-213) also uses `task.priority` and `task.is_completed` for outbound writes
- **Impact:** Post-migration, the inbound sync will attempt to write to columns that no longer exist, causing database errors and sync failures.
- **Suggested Resolution:** Expand the Office 365 spec section to cover both inbound and outbound field mapping, including the `normalizeLocalTask`, `buildTodoTaskPayload`, and inbound update logic.

---

### SPEC-005: Office 365 `normalizeLocalTask` function uses both `priority` and `is_completed`
- **Spec Reference:** External Services Impact > Office 365 Sync Service
- **Requirement:** Replace is_completed with state check, remove priority mapping
- **Code Reference:** `src/services/office365SyncService.js:77-85` (`normalizeLocalTask` function)
- **Status:** Partial
- **Severity:** High
- **Description:** The `normalizeLocalTask` function at line 77-85 constructs a normalized representation of a local task for comparison purposes. It reads `task?.priority` and `task?.is_completed`. The `tasksMatch` function at line 116-123 uses this to determine if a sync is needed. Both must be updated to use `state` instead of `is_completed` and remove priority comparison.
- **Impact:** Sync comparison logic will break, causing either unnecessary syncs or missed syncs.
- **Suggested Resolution:** Add `normalizeLocalTask` and `tasksMatch` to the list of functions requiring update in the Office 365 section.

---

### SPEC-006: Daily task email queries `is_completed` and `priority` in select clause
- **Spec Reference:** External Services Impact > Daily Task Email Service
- **Requirement:** Filter by `state = 'today'` instead of `is_completed = false`
- **Code Reference:** `src/services/dailyTaskEmailService.js:103` (`.eq('is_completed', false)`) and line 103 (`.select('id, name, due_date, priority, ...')`)
- **Status:** Partial
- **Severity:** High
- **Description:** The spec correctly identifies that `is_completed = false` must change. However, it does not mention that the `select` clause at line 103 explicitly selects `priority`, which will no longer exist. The `formatTaskLineText` and `formatTaskLineHtml` functions at lines 149-165 also format `task.priority` into the email output (e.g., `[High]`). The spec says "Replace priority formatting with today_section labels" but does not account for the fact that the `fetchOutstandingTasks` function's query will also fail if `priority` is still in the select clause after the column is dropped.
- **Impact:** The daily email cron will throw a database error because the `priority` column no longer exists.
- **Suggested Resolution:** Explicitly note that the `select()` clause in `fetchOutstandingTasks` must be updated to remove `priority` and add `state, today_section`.

---

### SPEC-007: Completed-items API uses `job` in project join which will be renamed
- **Spec Reference:** Code Modified in Surviving Files
- **Requirement:** Spec says "Replace is_completed=true filter with state='done'"
- **Code Reference:** `src/app/api/completed-items/route.js:28-29` (`.select('*, project:project_id(id, name, stakeholders, job)')` and `.eq('is_completed', true)`)
- **Status:** Partial
- **Severity:** High
- **Description:** The spec correctly identifies the `is_completed` change but the existing code also selects `job` in the join at line 28. After migration, `job` on projects will be renamed to `area`. This select clause will fail silently (returning null for `job`) or error depending on Supabase behavior.
- **Impact:** The completed-items report page will lose area/job data or return errors after migration.
- **Suggested Resolution:** Add a note that the completed-items route's project join must also rename `job` to `area`.

---

### SPEC-008: Tasks API GET route selects `job` from projects join
- **Spec Reference:** Code Modified in Surviving Files > `src/app/api/tasks/route.js`
- **Requirement:** "Update query fields to match new schema"
- **Code Reference:** `src/app/api/tasks/route.js:73` (`.select('*, projects(id, name, job)')`) and line 131 (`project_job: task.projects?.job`)
- **Status:** Partial
- **Severity:** High
- **Description:** The spec says to "update query fields" but does not explicitly call out that the join references `projects.job` (renamed to `area`), and the response transformation at line 131 maps `task.projects?.job` to `project_job`. Both must change.
- **Impact:** API will return null for the area field and break frontend area filtering.
- **Suggested Resolution:** Explicitly list the select clause and response transformation changes needed in the tasks API route.

---

### SPEC-009: Tasks API GET route filters by `is_completed`
- **Spec Reference:** Code Modified in Surviving Files > `src/app/api/tasks/route.js`
- **Requirement:** Update to new schema
- **Code Reference:** `src/app/api/tasks/route.js:83` (`.eq('is_completed', false)`)
- **Status:** Partial
- **Severity:** High
- **Description:** The spec says to update the tasks route but does not explicitly mention the `is_completed` filter at line 83 that controls whether completed tasks are included. This must change to a state-based filter (e.g., `.neq('state', 'done')`) or equivalent.
- **Impact:** The primary task listing endpoint will fail after the `is_completed` column is dropped.
- **Suggested Resolution:** Add explicit mention of the `is_completed` filter change in the tasks route spec entry.

---

### SPEC-010: Task update service `TASK_UPDATE_FIELDS` whitelist contains removed fields
- **Spec Reference:** Code Modified in Surviving Files > `src/services/taskService.js`
- **Requirement:** Remove priority/importance_score/urgency_score fields, add state/today_section/sort_order/chips fields, rename job to area
- **Code Reference:** `src/services/taskService.js:6-18` (`TASK_UPDATE_FIELDS` set)
- **Status:** Partial
- **Severity:** High
- **Description:** The `TASK_UPDATE_FIELDS` whitelist at lines 6-18 is the gatekeeper for what fields can be updated via the API. It currently includes `priority`, `is_completed`, `job`, `importance_score`, `urgency_score`. The spec should explicitly call out that this whitelist must be replaced with the new field set including: `state`, `today_section`, `sort_order`, `area`, `task_type`, `chips`, `waiting_reason`, `follow_up_date`, `description`, `due_date`, `name`, `project_id`, `completed_at`, `updated_at`.
- **Impact:** If the whitelist is not updated, no new fields can be written through the update endpoint.
- **Suggested Resolution:** Add explicit detail about the `TASK_UPDATE_FIELDS` whitelist replacement.

---

### SPEC-011: `ensureUnassignedProject` creates projects with `priority: PRIORITY.MEDIUM`
- **Spec Reference:** Routing & Existing Pages > Project Association
- **Requirement:** The "Unassigned" project pattern is removed. `ensureUnassignedProject` is removed.
- **Code Reference:** `src/services/taskService.js:54-103` (function body) and line 76 (`priority: PRIORITY.MEDIUM`)
- **Status:** Partial
- **Severity:** Medium
- **Description:** The spec says `ensureUnassignedProject` is removed and tasks without a project get `project_id = null`. However, the spec does not explicitly list `ensureUnassignedProject` in the "Code Modified" table for taskService.js. It is mentioned in the routing section but the `taskService.js` entry just says "Update all queries". The function also references `PRIORITY.MEDIUM` which will no longer exist as a constant.
- **Impact:** If the function is not removed, tasks will still try to create "Unassigned" projects with the dropped `priority` field.
- **Suggested Resolution:** Explicitly note that `ensureUnassignedProject`, `isUnassignedProject`, and related logic in `taskService.js` must be removed.

---

### SPEC-012: Validator `validateTask` requires `project_id` (non-nullable)
- **Spec Reference:** Data Model > Tasks Table
- **Requirement:** `project_id` is now nullable (optional association)
- **Code Reference:** `src/lib/validators.js:112-114` (`if (!task.project_id) { errors.project_id = 'Task must be associated with a project'; }`)
- **Status:** Missing
- **Severity:** Critical
- **Description:** The spec makes `project_id` nullable on tasks, but the validator currently rejects any task without a `project_id`. This validation is called by `taskService.createTask()` and `taskService.updateTask()`. If not updated, creating standalone tasks (the core new behavior) will always fail validation.
- **Impact:** The entire "tasks without projects" feature will be blocked by validation.
- **Suggested Resolution:** The spec's validators.js entry says "Remove importance_score, urgency_score validation. Add state, today_section, task_type, chips validation." It must also explicitly say "Remove mandatory project_id validation" since this is a critical behavioral change.

---

### SPEC-013: Validator `validateProject` validates `priority` field
- **Spec Reference:** Code Modified in Surviving Files > `src/lib/validators.js`
- **Requirement:** Remove priority validation
- **Code Reference:** `src/lib/validators.js:21-23` (priority validation in `validateProject`) and line 3 (`import { PRIORITY } from './constants'`)
- **Status:** Partial
- **Severity:** Medium
- **Description:** The spec mentions updating `validators.js` to remove `importance_score` and `urgency_score` validation but does not explicitly mention removing the `priority` validation from `validateProject()` at lines 21-23. It imports `PRIORITY` from constants (line 3) which will be removed.
- **Impact:** Project creation/update validation will crash when `PRIORITY` constant is removed.
- **Suggested Resolution:** Add explicit mention of removing priority validation from `validateProject` and the `PRIORITY` import.

---

### SPEC-014: Validator `validateNote` does not account for `idea_id`
- **Spec Reference:** Data Model > Notes Table
- **Requirement:** Notes can now have `idea_id` as a parent, with an exclusive-or constraint
- **Code Reference:** `src/lib/validators.js:138-139` (`if (!note.project_id && !note.task_id)`)
- **Status:** Missing
- **Severity:** Medium
- **Description:** The spec adds `idea_id` as a valid parent for notes, but the `validateNote` function only checks for `project_id` or `task_id`. This validator must be updated to accept `idea_id` as the third valid parent option.
- **Impact:** Creating notes on ideas will always fail client-side validation.
- **Suggested Resolution:** Add `validateNote` update to the spec's validators.js entry to accept `idea_id` as a valid parent.

---

### SPEC-015: Projects API route `PROJECT_UPDATE_FIELDS` includes `priority` and `job`
- **Spec Reference:** Code Modified in Surviving Files > `src/app/api/projects/route.js` and `src/app/api/projects/[id]/route.js`
- **Requirement:** Remove priority, rename job to area
- **Code Reference:** `src/app/api/projects/route.js:9-17` and `src/app/api/projects/[id]/route.js:9-17` (both define `PROJECT_UPDATE_FIELDS` with `'priority'` and `'job'`)
- **Status:** Partial
- **Severity:** High
- **Description:** Both project API routes define a `PROJECT_UPDATE_FIELDS` whitelist containing `'priority'` and `'job'`. The spec correctly identifies these files need changes but does not explicitly note that the field whitelists must be updated. The PATCH handler's ownership verification query also selects `priority` and `job` which will need updating.
- **Impact:** After migration, the project update endpoint will silently accept `priority` (which no longer exists) and reject `area` (the new field).
- **Suggested Resolution:** Explicitly list the `PROJECT_UPDATE_FIELDS` whitelist changes and verification query select changes for both project routes.

---

### SPEC-016: Dashboard page fate is ambiguous
- **Spec Reference:** Code Modified in Surviving Files > `src/app/dashboard/page.js`
- **Requirement:** "Redirect to /today or replace with new navigation shell"
- **Code Reference:** `src/app/dashboard/page.js:21-39` (`getPriorityValue`, `sortProjectsByPriorityThenDateDesc`) and throughout (lines 252, 390, 435, 439 reference `is_completed`)
- **Status:** Ambiguous
- **Severity:** Medium
- **Description:** The spec says the dashboard page should "redirect to /today or replace with new navigation shell" but it is ambiguous about which. The current file is 600+ lines with deep priority and `is_completed` integration. If the page is fully replaced with a redirect, the spec should say so explicitly. If it becomes the new navigation shell, it needs extensive changes listed. The word "or" leaves this as a design decision that should have been made in the spec.
- **Impact:** If the page is not fully replaced, leftover priority and is_completed references will cause runtime errors. If it is replaced, no changes needed but the spec should be clear.
- **Suggested Resolution:** Make a firm decision: redirect or rewrite. If redirect, state explicitly: "Replace entire file with a redirect to /today". If rewrite, enumerate all changes needed.

---

### SPEC-017: Admin migrate route index references `is_completed` (not just `priority`)
- **Spec Reference:** Code Modified in Surviving Files > `src/app/api/admin/migrate/route.js`
- **Requirement:** "Remove priority references from migration indexes"
- **Code Reference:** `src/app/api/admin/migrate/route.js:37` (`idx_tasks_user_completed_due_priority ON public.tasks (user_id, is_completed, due_date, priority DESC)`)
- **Status:** Partial
- **Severity:** Medium
- **Description:** The spec says "Remove priority references from migration indexes." The index at line 37 references both `is_completed` AND `priority DESC`. The spec should note that `is_completed` must also be removed, and new indexes for the state-based model should be specified (e.g., on `(user_id, state, sort_order)`).
- **Impact:** The migration route will attempt to create indexes on dropped columns if re-run.
- **Suggested Resolution:** Expand the spec entry to cover both `priority` and `is_completed` removal from indexes, and suggest replacement indexes.

---

### SPEC-018: `ProjectNoteWorkspaceModal` imports `TaskScoreBadge` (slated for removal)
- **Spec Reference:** Code Modified in Surviving Files > `src/components/Notes/ProjectNoteWorkspaceModal.js`
- **Requirement:** "Remove QuickTaskForm import, replace with new Quick Capture or inline task creation"
- **Code Reference:** `src/components/Notes/ProjectNoteWorkspaceModal.js:9` (`import { TaskScoreBadge } from '@/components/Tasks/TaskScoreBadge'`)
- **Status:** Missing
- **Severity:** Medium
- **Description:** The spec notes that `QuickTaskForm` must be replaced in this file, but does not mention that `TaskScoreBadge` is also imported (line 9). Since `TaskScoreBadge.jsx` is listed for full removal, this import will break the build.
- **Impact:** Build failure. The workspace modal will crash on import resolution.
- **Suggested Resolution:** Add `TaskScoreBadge` import removal to the spec entry for `ProjectNoteWorkspaceModal.js`.

---

### SPEC-019: `SidebarFilters.jsx` job-related props need renaming to area
- **Spec Reference:** Code Modified in Surviving Files > `src/components/dashboard/SidebarFilters.jsx`
- **Requirement:** "Remove priority filter checkboxes. Update `job` filter to `area`"
- **Code Reference:** `src/components/dashboard/SidebarFilters.jsx:112-113` (`uniqueJobs`, `selectedJob`, `onJobChange` props) and line 132 (section label "Jobs") and line 203 (section label "Priority Filters")
- **Status:** Partial
- **Severity:** Medium
- **Description:** The spec says to remove priority filter checkboxes and update job to area. However:
  1. The section at line 203 is labeled "Priority Filters" but actually contains project-health filters (overdue, noTasks, untouched, noDueDate). These are NOT priority filters and should survive, but the label needs updating.
  2. The `uniqueJobs`, `selectedJob`, and `onJobChange` props need renaming to `uniqueAreas`, `selectedArea`, and `onAreaChange`. The spec does not list these prop renames.
  3. The "Jobs" section label at line 132 needs to become "Areas".
- **Impact:** Confusing labels post-migration, and prop names will be inconsistent if only the database field is renamed.
- **Suggested Resolution:** Expand the spec entry to list the prop renames and label changes needed in SidebarFilters and its parent (dashboard page).

---

## Summary Table

| ID | File | Status | Severity |
|----|------|--------|----------|
| SPEC-001 | `src/contexts/TargetProjectContext.js` | Deviated | Low |
| SPEC-002 | `src/app/layout.js` | Missing | High |
| SPEC-003 | `src/lib/apiClient.js` | Missing | Critical |
| SPEC-004 | `src/services/office365SyncService.js` (inbound) | Partial | Critical |
| SPEC-005 | `src/services/office365SyncService.js` (normalizeLocalTask) | Partial | High |
| SPEC-006 | `src/services/dailyTaskEmailService.js` (select clause) | Partial | High |
| SPEC-007 | `src/app/api/completed-items/route.js` (job in join) | Partial | High |
| SPEC-008 | `src/app/api/tasks/route.js` (job in join) | Partial | High |
| SPEC-009 | `src/app/api/tasks/route.js` (is_completed filter) | Partial | High |
| SPEC-010 | `src/services/taskService.js` (TASK_UPDATE_FIELDS) | Partial | High |
| SPEC-011 | `src/services/taskService.js` (ensureUnassignedProject) | Partial | Medium |
| SPEC-012 | `src/lib/validators.js` (project_id required) | Missing | Critical |
| SPEC-013 | `src/lib/validators.js` (project priority) | Partial | Medium |
| SPEC-014 | `src/lib/validators.js` (note idea_id) | Missing | Medium |
| SPEC-015 | `src/app/api/projects/route.js` + `[id]/route.js` | Partial | High |
| SPEC-016 | `src/app/dashboard/page.js` | Ambiguous | Medium |
| SPEC-017 | `src/app/api/admin/migrate/route.js` | Partial | Medium |
| SPEC-018 | `src/components/Notes/ProjectNoteWorkspaceModal.js` | Missing | Medium |
| SPEC-019 | `src/components/dashboard/SidebarFilters.jsx` | Partial | Medium |

**Critical: 3 | High: 8 | Medium: 7 | Low: 1**

---

## Recommendation

The spec should be updated to address the 3 critical gaps before implementation begins:

1. **SPEC-003**: Add the apiClient layer to the change list. This is the bridge between all frontend components and the API, and omitting it means the entire frontend will send stale field names.

2. **SPEC-004/005**: Expand the Office 365 sync section to cover inbound sync logic (Graph-to-local writes), not just outbound. The inbound path writes `priority` and `is_completed` directly to the database.

3. **SPEC-012**: The `validateTask` function's mandatory `project_id` check directly contradicts the spec's core design change of making `project_id` nullable. This must be explicitly called out.

The 8 high-severity items are all cases where the spec identifies the correct file but misses specific code sites within it. These are lower risk because an implementer working on the file would likely discover them, but they should still be documented to prevent oversight.
