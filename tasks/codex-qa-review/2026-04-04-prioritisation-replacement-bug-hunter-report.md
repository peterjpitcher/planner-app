# Bug Hunter Report: Prioritisation Replacement Design Spec

**Date**: 2026-04-04
**Spec reviewed**: `docs/superpowers/specs/2026-04-04-prioritisation-replacement-design.md`
**Reviewer**: Bug Hunter (QA Specialist)

---

## Summary

21 bugs identified across the design spec. 3 Critical, 6 High, 8 Medium, 4 Low.

The most dangerous issues are: (1) the migration runs as a single transaction with no partial-failure handling across 5 dependent steps, (2) the `check_today_section` constraint makes bulk operations and drag-and-drop two-field updates order-dependent and race-prone, and (3) the "Completed today" filter uses server-side timezone logic but `dateUtils.js` currently uses client-local `new Date()` with no Europe/London awareness.

---

## Bugs

### BUG-001: Migration step 2 partial failure leaves data in inconsistent state
- **Spec Section:** Migration > Single Migration File
- **Severity:** Critical
- **Category:** Migration / Data Integrity
- **Description:** The migration is described as 5 sequential steps in a "single migration file", but there is no explicit statement that it runs inside a single transaction. If step 2 (seed existing data) fails partway through -- e.g. after setting `state = 'backlog'` on some tasks but before copying `job` to `area` -- the database is left with a mix of migrated and unmigrated rows. Step 4 (drop old columns) would then destroy data that was never copied. Even within a single Supabase migration file, individual statements can fail independently if not wrapped in `BEGIN/COMMIT`.
- **Impact:** Permanent data loss. Tasks could lose their `job` values if the column is dropped before the copy completes. Partial state seeding means some tasks have `state` set and others have the default `'backlog'` but no `sort_order` or `state_changed_at`.
- **Suggested fix:** Explicitly wrap all 5 steps in a single `BEGIN...COMMIT` transaction block. Add a verification query between step 2 and step 4: `SELECT count(*) FROM tasks WHERE state IS NULL` -- if non-zero, `RAISE EXCEPTION`. Consider making step 4 a separate migration file that is only applied after verifying step 2 succeeded.

### BUG-002: check_today_section constraint breaks atomic state transitions via drag-and-drop
- **Spec Section:** Data Model > Tasks Table; Interactions > Drag and Drop
- **Severity:** Critical
- **Category:** State / Logic
- **Description:** The constraint `(state = 'today' AND today_section IS NOT NULL) OR (state != 'today' AND today_section IS NULL)` is enforced at the row level on every UPDATE. When dragging a task FROM `state = 'today'` TO `state = 'this_week'`, the application must set `state = 'this_week'` AND `today_section = NULL` in a single UPDATE. If the ORM or application code sets them in two separate statements, the intermediate state violates the constraint. Conversely, dragging INTO today requires setting both `state = 'today'` and `today_section = 'good_to_do'` atomically. The spec says "defaults to Good to Do" but does not specify WHERE this default is enforced -- application code, a database trigger, or a default value. If the application forgets to set `today_section` when setting `state = 'today'`, the INSERT/UPDATE fails silently.
- **Impact:** Drag-and-drop operations fail with constraint violations. Optimistic UI shows the card in the new position, but the database rejects the write. The card snaps back confusingly.
- **Suggested fix:** (a) Document explicitly that state and today_section MUST always be updated in a single UPDATE statement. (b) Add a database trigger `BEFORE INSERT OR UPDATE` that auto-sets `today_section = 'good_to_do'` when `state = 'today'` and `today_section IS NULL`, and auto-nulls `today_section` when `state != 'today'`. This makes the constraint self-healing. (c) Add this trigger to the spec's data model section.

### BUG-003: Existing dateUtils.js uses client-local time, not Europe/London -- "Completed today" boundary is wrong
- **Spec Section:** Interactions > "Completed Today" Day Boundary
- **Severity:** Critical
- **Category:** Edge Case / Logic
- **Description:** The spec states the "Completed today" section filters by `completed_at >= start of today (Europe/London)`. However, the existing `dateUtils.js` uses `new Date()` throughout (which is browser-local time) and `date-fns` functions like `isToday()` that also use client-local time. There is no `Europe/London` timezone handling anywhere in the codebase. During BST (British Summer Time, UTC+1), a task completed at 23:30 UTC on April 3rd would be 00:30 BST on April 4th. Whether this shows as "completed today" depends on whether the filter uses UTC or Europe/London. The spec says Europe/London but the codebase has no mechanism to implement this.
- **Impact:** Tasks completed near midnight show up in the wrong day's "Completed today" section. During DST transitions (last Sunday of March, last Sunday of October), the boundary shifts by an hour, causing tasks to appear/disappear unexpectedly.
- **Suggested fix:** (a) Specify that the `completed_at >= start of today` computation must use `date-fns-tz` or `Intl.DateTimeFormat` with `timeZone: 'Europe/London'`. (b) Add a utility function to `dateUtils.js` like `getStartOfTodayLondon()` that returns a proper timezone-aware timestamp. (c) Consider doing this filter server-side in the Supabase query using `AT TIME ZONE 'Europe/London'` for consistency.

### BUG-004: sort_order collision when two tasks inserted at same position simultaneously
- **Spec Section:** Interactions > Sort Order Mechanics
- **Severity:** High
- **Category:** Edge Case / Data Integrity
- **Description:** The gap-based integer algorithm (`floor((above + below) / 2)`) is deterministic -- two concurrent drag operations targeting the same gap will compute the same `sort_order` value. There is no UNIQUE constraint on `(user_id, state, today_section, sort_order)`. The spec does not define what happens when two tasks share the same `sort_order`. This is not just theoretical: if a user quickly drags two tasks to the same position, or if optimistic UI sends two reorder requests before the first returns, both will compute identical values.
- **Impact:** Tasks with identical sort_order render in undefined/arbitrary order. Each page load may show them in a different sequence, confusing the user.
- **Suggested fix:** (a) Add a tiebreaker to the ORDER BY: `ORDER BY sort_order ASC, created_at ASC` (or `updated_at DESC`). Document this in the spec. (b) Consider using `sort_order` as a float or bigint to reduce collision probability. (c) Add a note that the lazy reindex should also de-duplicate sort_order values.

### BUG-005: Promoting idea to task creates no back-reference from task to idea
- **Spec Section:** Views > Idea Vault View
- **Severity:** High
- **Category:** Data Integrity
- **Description:** The spec says "Promote to task creates a task in Backlog and sets the idea's `idea_state = 'promoted'`". The idea knows it was promoted (via its state), but the created task has no `idea_id` field or any reference back to the idea it came from. The `ideas` table has no `task_id` field either. There is no way to navigate from the promoted task back to the idea's notes, `why_it_matters`, or `smallest_step` context.
- **Impact:** Loss of context. User promotes an idea with rich notes, then cannot find that context from the task. If the user wants to revisit the original idea reasoning, they must manually search the Ideas vault for promoted items. No audit trail connecting the two entities.
- **Suggested fix:** Add `promoted_to_task_id UUID REFERENCES tasks(id)` to the ideas table, OR add `source_idea_id UUID REFERENCES ideas(id)` to the tasks table. The latter is cleaner because it allows the task detail drawer to show the originating idea context.

### BUG-006: Notes on done tasks become invisible, lifecycle undefined
- **Spec Section:** Data Model > Notes Table; Interactions > Completion Behaviour
- **Severity:** High
- **Category:** Data Integrity
- **Description:** The notes constraint ensures every note is attached to exactly one of (project, task, idea). The spec says done tasks are "hidden from Plan board (viewable via toggle)". But notes attached to done tasks become effectively buried. The spec does not define what happens to notes when a task moves to done state, whether they remain accessible, or how they surface in the completed-report view. If done tasks are later bulk-purged or archived (not described), their notes are lost via CASCADE delete.
- **Impact:** Users may add important notes to tasks (e.g. resolution notes, lessons learned) that become invisible once the task is completed. No way to search or browse notes across done tasks.
- **Suggested fix:** Add a section to the spec defining note visibility for done tasks. Options: (a) notes remain on the task, viewable when "Show completed" is toggled on; (b) notes are surfaced in the completed-report view; (c) notes can be reassigned to the parent project when a task completes.

### BUG-007: Area dropdown case sensitivity causes duplicate entries
- **Spec Section:** Routing > Area Field Behaviour
- **Severity:** High
- **Category:** Data Integrity
- **Description:** The area dropdown is populated by `SELECT DISTINCT area FROM tasks WHERE area IS NOT NULL AND user_id = $1 UNION SELECT DISTINCT area FROM projects WHERE area IS NOT NULL AND user_id = $1`. SQL `DISTINCT` is case-sensitive by default in PostgreSQL. A user typing "Admin" once and "admin" another time creates two distinct area values in the dropdown. Over time, the dropdown accumulates case-variant duplicates.
- **Impact:** Filtering by area misses items with different casing. The dropdown becomes cluttered with near-duplicates. User frustration.
- **Suggested fix:** (a) Normalise area values on write: `area = area.trim().toLowerCase()` or use title-case normalisation. Add this to the spec. (b) Alternatively, use `SELECT DISTINCT LOWER(area)` in the dropdown query and store a display version. (c) Document the normalisation rule in the Area Field Behaviour section.

### BUG-008: Quick capture `!` prefix has no escape mechanism
- **Spec Section:** Interactions > Quick Capture
- **Severity:** High
- **Category:** Edge Case
- **Description:** The spec says "`!` prefix = create as Idea in vault". There is no way to create a task whose name legitimately starts with `!`. For example, "!important: call client" would be captured as an idea with title "important: call client" (presumably stripping the `!`). The spec does not say whether the `!` is stripped or kept, nor how to escape it.
- **Impact:** Users who habitually prefix urgent items with `!` will accidentally create ideas instead of tasks. No obvious way to work around this without knowing the feature exists.
- **Suggested fix:** (a) Specify that only `! ` (exclamation + space) triggers idea creation, reducing false positives. (b) Add an escape: `\!` creates a task starting with `!`. (c) Specify whether the `!` prefix is stripped from the idea title or kept. (d) Document this clearly in the quick capture UI with a hint.

### BUG-009: Waiting state allows null waiting_reason and null follow_up_date -- tasks rot silently
- **Spec Section:** Data Model > Tasks Table; Interactions > Waiting Mechanics
- **Severity:** High
- **Category:** State / Logic
- **Description:** The database schema has no constraint requiring `waiting_reason` or `follow_up_date` when `state = 'waiting'`. The Waiting Mechanics section says the inline prompt for reason is "optional free text" and follow-up date has quick picks but no "required" indicator. This means a task can be in Waiting state with both fields null -- providing no information about why it is blocked or when to follow up. The staleness detection section says "Waiting items with overdue follow_up_date -> amber flag", but if `follow_up_date` is null, these items never get flagged and rot silently.
- **Impact:** Tasks moved to Waiting with no reason or follow-up date become forgotten. The overdue follow-up detection does not catch them. The Waiting column accumulates mystery items.
- **Suggested fix:** (a) Make `follow_up_date` required when `state = 'waiting'` (add a CHECK constraint similar to `check_today_section`). (b) Alternatively, add staleness detection for Waiting items with null `follow_up_date` after N days (e.g. 7 days with no follow-up date = amber flag). (c) At minimum, spec the prompt as "recommended" with a default of +7 days if skipped.

### BUG-010: Migration sets sort_order = 0 for ALL tasks, making initial ordering undefined
- **Spec Section:** Migration > Step 2
- **Severity:** Medium
- **Category:** Migration / Data Integrity
- **Description:** Step 2 says "Set sort_order = 0 ... on all tasks". Since all migrated tasks go to `state = 'backlog'` with `sort_order = 0`, there is no defined ordering within the backlog. The sort order mechanics section assumes items have distinct sort_order values with gaps of 1000. After migration, every task has sort_order = 0, and the first reorder operation will trigger a lazy reindex of the entire backlog.
- **Impact:** The initial backlog view after migration shows tasks in arbitrary order (probably `created_at` order from the DB, but not guaranteed). The first drag operation triggers a reindex of potentially hundreds of tasks, causing a slow write.
- **Suggested fix:** Seed sort_order with incremental values during migration: `UPDATE tasks SET sort_order = (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at ASC)) * 1000`. This gives each task a distinct sort_order with proper gaps from day one.

### BUG-011: Constraint ordering ambiguous between Steps 1 and 5
- **Spec Section:** Migration > Steps 1 and 5
- **Severity:** Medium
- **Category:** Migration / Logic
- **Description:** Step 5 says "Add constraints: All CHECK constraints on new enums, today_section required when state = 'today'". But the Data Model section shows constraints inline in the CREATE TABLE DDL (the `CHECK (state IN (...))` and `check_today_section`). If Step 1 creates the columns with inline CHECK constraints, Step 5 is redundant. If Step 1 creates columns WITHOUT constraints (to allow Step 2 seeding), Step 5 must add them -- but this is not explicit. The spec contradicts itself about WHEN constraints are added.
- **Impact:** Implementer confusion. If constraints are added in Step 1, everything works but Step 5 is misleading. If deferred to Step 5, the migration must use `ALTER TABLE ADD CONSTRAINT` syntax, not inline DDL. Could cause migration script errors.
- **Suggested fix:** Clarify: Step 1 adds columns WITHOUT constraints (to allow seeding). Step 5 adds all constraints AFTER seeding. Remove the inline CHECK syntax from the Data Model section or mark it as "final state" reference only, not migration DDL.

### BUG-012: ON DELETE CASCADE on project_id destroys independent tasks when project deleted
- **Spec Section:** Data Model > Tasks Table
- **Severity:** Medium
- **Category:** Data Integrity
- **Description:** The spec makes `project_id` nullable (tasks can exist without a project), but the existing FK has `ON DELETE CASCADE`. If a project is deleted, all its tasks are cascade-deleted -- even though tasks can now exist independently. The spec does not mention changing the FK's ON DELETE behaviour. With the new model where tasks are first-class entities (not subordinate to projects), cascade deletion is likely wrong.
- **Impact:** Deleting a project silently destroys all associated tasks. This is catastrophic data loss in the new model where tasks are meant to be independent.
- **Suggested fix:** Change the FK to `ON DELETE SET NULL`: `ALTER TABLE tasks DROP CONSTRAINT tasks_project_id_fkey; ALTER TABLE tasks ADD CONSTRAINT tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;`. Add this to the migration spec.

### BUG-013: No RLS policies defined for the new ideas table
- **Spec Section:** Data Model > Ideas Table
- **Severity:** Medium
- **Category:** Data Integrity / Security
- **Description:** The spec defines the ideas table schema but does not mention RLS policies. The existing codebase has RLS enabled on all tables (notes, projects, tasks). The CLAUDE.md says "RLS is always on". Without RLS policies on the ideas table, authenticated users could read/write any user's ideas.
- **Impact:** Any authenticated user can see and modify any other user's ideas. Security violation.
- **Suggested fix:** Add RLS policy definitions for the ideas table to the spec: `ALTER TABLE ideas ENABLE ROW LEVEL SECURITY; CREATE POLICY "users_own_ideas" ON ideas FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());`

### BUG-014: Completed-report page component not listed in code changes
- **Spec Section:** Routing > Existing Pages; Removals > Code Modified
- **Severity:** Medium
- **Category:** Logic
- **Description:** The spec says the completed-report route is "Kept -- update queries to use `state = 'done'` instead of `is_completed`". The "Code Modified" table lists `src/app/api/completed-items/route.js` but not the completed-report page component itself. That page likely references `priority` for display/grouping, and `is_completed` for filtering. Both are being removed.
- **Impact:** The completed-report page renders with errors or missing data after migration. Priority-based grouping/sorting in the report breaks.
- **Suggested fix:** Add `src/app/completed-report/` to the "Code Modified" table. Specify what replaces priority in the report display -- likely group by area or today_section.

### BUG-015: Optimistic drag contradicts inline prompt for Waiting state
- **Spec Section:** Interactions > Drag and Drop; Interactions > Waiting Mechanics
- **Severity:** Medium
- **Category:** Logic / UX
- **Description:** The drag-and-drop section says "Optimistic UI -- card moves instantly, database write in background." The Waiting mechanics section says moving to Waiting triggers an "inline prompt" for waiting_reason and follow-up date. These contradict: you cannot both move the card instantly AND prompt the user for additional information. If the card moves first, where does the prompt appear? If the prompt appears first, the move is not optimistic.
- **Impact:** Implementation ambiguity. Developer must choose between truly optimistic drag (card moves, prompt appears after) or blocking prompt (card stays until prompt is answered).
- **Suggested fix:** Clarify the interaction: (a) Card moves optimistically to Waiting column, then a popover appears anchored to the card asking for reason and follow-up date. If dismissed, the task stays in Waiting with null fields. OR (b) Dragging to Waiting opens a prompt first; the card only moves after submission/dismissal. State which approach.

### BUG-016: No index strategy defined for new query patterns
- **Spec Section:** Data Model (missing)
- **Severity:** Medium
- **Category:** Performance
- **Description:** The spec defines the schema but no indexes for the new columns. Common queries will filter by `(user_id, state)`, `(user_id, state, today_section, sort_order)`, and `(user_id, state, completed_at)`. Without composite indexes, these queries will sequential-scan. The existing `idx_tasks_user_job` index becomes obsolete after the `job` column is dropped.
- **Impact:** Performance degrades as task count grows. Every view load does a full table scan.
- **Suggested fix:** Add index definitions to the spec: `CREATE INDEX idx_tasks_user_state ON tasks(user_id, state); CREATE INDEX idx_tasks_user_state_sort ON tasks(user_id, state, today_section, sort_order) WHERE state = 'today'; CREATE INDEX idx_tasks_completed ON tasks(user_id, completed_at) WHERE state = 'done';`

### BUG-017: Today view needs dual query but spec does not make this explicit
- **Spec Section:** Views > Today Focus View; Interactions > Completion Behaviour
- **Severity:** Medium
- **Category:** State / Logic
- **Description:** Completing a task sets `state = 'done'`, but the "Completed today" section appears within the Today Focus View. The Today view presumably queries `state = 'today'` for the three active sections. Done tasks have `state = 'done'`, not `'today'`. So the "Completed today" section must use a different query: `state = 'done' AND completed_at >= start_of_today`. The spec does not make this dual-query requirement explicit.
- **Impact:** If the implementer only queries `state = 'today'`, the "Completed today" section will always be empty.
- **Suggested fix:** Explicitly state that the Today Focus View runs two queries: (1) `WHERE state = 'today'` grouped by `today_section` for the three active sections, and (2) `WHERE state = 'done' AND completed_at >= start_of_today_europe_london` for the Completed today section.

### BUG-018: No bulk operations defined for weekly triage
- **Spec Section:** Interactions (missing)
- **Severity:** Low
- **Category:** Edge Case
- **Description:** The spec describes single-card drag operations and per-card quick actions, but does not address bulk operations. Common planning workflows include "select all stale This Week items and move to Backlog" or "complete all Quick Wins". Bulk moves involving the Today state require setting `today_section` on multiple tasks atomically.
- **Impact:** Users with many tasks have no efficient way to do weekly triage. They must drag tasks one at a time, undermining the "calm execution" goal.
- **Suggested fix:** Add a "Bulk actions" section. At minimum: multi-select checkbox, bulk move to state (with section picker for Today), bulk complete. Note the database UPDATE must set both `state` and `today_section` atomically.

### BUG-019: Migration DELETE of orphan notes may destroy valid user data
- **Spec Section:** Data Model > Notes Table (migration SQL)
- **Severity:** Low
- **Category:** Migration / Data Integrity
- **Description:** The current `check_note_parent` constraint allows `project_id IS NULL AND task_id IS NULL` -- orphan notes are valid. The migration SQL includes `DELETE FROM notes WHERE project_id IS NULL AND task_id IS NULL`. These orphan notes may contain valuable user data. The spec comment says "delete them or assign to a default project" but the SQL unconditionally deletes.
- **Impact:** User data loss if orphan notes exist with meaningful content.
- **Suggested fix:** Before the DELETE, reassign orphan notes: `UPDATE notes SET project_id = (SELECT id FROM projects WHERE user_id = notes.user_id ORDER BY created_at LIMIT 1) WHERE project_id IS NULL AND task_id IS NULL;` then delete only those still unassigned (users with zero projects).

### BUG-020: CHECK constraints on priority must be dropped before columns
- **Spec Section:** Migration > Step 4
- **Severity:** Low
- **Category:** Migration
- **Description:** The existing tables have `projects_priority_check` and `tasks_priority_check` constraints. Step 4 says to drop the `priority` columns but does not mention dropping these CHECK constraints first. PostgreSQL will error: "cannot drop column because constraint depends on it".
- **Impact:** Migration fails at Step 4.
- **Suggested fix:** Add to Step 4: `ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_priority_check; ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_priority_check;` before DROP COLUMN. Or use `ALTER TABLE ... DROP COLUMN priority CASCADE`.

### BUG-021: tasks.project_id NOT NULL must be altered before migration seeds null values
- **Spec Section:** Data Model > Tasks Table; Migration
- **Severity:** Low
- **Category:** Migration
- **Description:** The current schema has `project_id UUID NOT NULL` on tasks. The new spec makes it nullable. The migration steps do not explicitly include `ALTER TABLE tasks ALTER COLUMN project_id DROP NOT NULL`. Step 2 says tasks in the "Unassigned" project get `project_id = null`, but this UPDATE will fail if the NOT NULL constraint still exists.
- **Impact:** Migration step 2 fails when setting `project_id = NULL` on Unassigned project tasks.
- **Suggested fix:** Add to Step 1: `ALTER TABLE tasks ALTER COLUMN project_id DROP NOT NULL;`. Also update the FK to `ON DELETE SET NULL` per BUG-012.

---

## Summary Table

| ID | Severity | Category | One-line Summary |
|----|----------|----------|-----------------|
| BUG-001 | Critical | Migration | Partial migration failure leaves data inconsistent, no explicit transaction |
| BUG-002 | Critical | State | check_today_section constraint breaks non-atomic state transitions |
| BUG-003 | Critical | Edge Case | dateUtils uses client-local time, not Europe/London for day boundary |
| BUG-004 | High | Data Integrity | sort_order collisions from concurrent drag operations undefined |
| BUG-005 | High | Data Integrity | Promoted idea has no back-reference to created task |
| BUG-006 | High | Data Integrity | Notes on done tasks become invisible, lifecycle undefined |
| BUG-007 | High | Data Integrity | Area dropdown DISTINCT is case-sensitive, creates duplicates |
| BUG-008 | High | Edge Case | Quick capture ! prefix has no escape for legitimate task names |
| BUG-009 | High | State | Waiting state allows null reason AND null follow-up, tasks rot silently |
| BUG-010 | Medium | Migration | All tasks seeded with sort_order=0, initial ordering undefined |
| BUG-011 | Medium | Migration | Constraint timing ambiguous between Steps 1 and 5 |
| BUG-012 | Medium | Data Integrity | ON DELETE CASCADE destroys independent tasks on project deletion |
| BUG-013 | Medium | Security | No RLS policies for new ideas table |
| BUG-014 | Medium | Logic | Completed-report page component not listed in code changes |
| BUG-015 | Medium | Logic | Optimistic drag contradicts inline prompt for Waiting state |
| BUG-016 | Medium | Performance | No index strategy for new query patterns |
| BUG-017 | Medium | State | Today view needs dual query but spec does not make this explicit |
| BUG-018 | Low | Edge Case | No bulk operations defined for weekly triage |
| BUG-019 | Low | Migration | Orphan notes unconditionally deleted, may contain user data |
| BUG-020 | Low | Migration | CHECK constraints on priority must be dropped before columns |
| BUG-021 | Low | Migration | project_id NOT NULL must be altered before nullable seeding |
