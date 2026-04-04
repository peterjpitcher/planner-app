# Security Audit: Prioritisation Replacement Design Spec

**Date**: 2026-04-04
**Auditor**: Security Auditor (Codex QA Review)
**Spec**: `docs/superpowers/specs/2026-04-04-prioritisation-replacement-design.md`
**Scope**: Pre-implementation security review of the proposed data model, routes, interactions, and migration

---

## Summary

The design spec is well-structured and covers a significant refactor. However, it introduces several security-relevant changes without explicitly addressing their security implications. The most concerning gaps are: (1) the new Ideas table has no API-level auth specification, (2) client-side drag-and-drop state transitions lack documented server-side validation, and (3) the chips array has no defined validation boundary. No critical vulnerabilities exist in the spec itself, but implementation without addressing these findings would create exploitable gaps.

**Findings**: 10 total -- 0 Critical, 3 High, 5 Medium, 2 Low

---

### SEC-001: New routes /today, /plan, /ideas have no explicit auth protection specified

- **Spec Section:** Routing & Existing Pages (lines 349-369)
- **Severity:** High
- **Category:** Auth
- **Description:** The spec defines three new page routes (`/today`, `/plan`, `/ideas`) and states that `/dashboard` becomes a redirect to `/today`. However, the spec does not mention authentication requirements for these new routes. The existing middleware at `src/middleware.js` uses a catch-all matcher that protects all routes except an explicit exclusion list (`login`, `api/auth`, `api/cron`, etc.), so the new routes *will* be protected by default. However, the spec should explicitly state this, because: (a) a developer unfamiliar with the middleware may add API routes for ideas without the same protection, and (b) the middleware matcher regex could be inadvertently modified during the refactor.
- **Impact:** If middleware is misconfigured during the big-bang refactor, unauthenticated users could access `/today`, `/plan`, or `/ideas` pages and any associated API routes.
- **Suggested fix:** Add a "Security" section to the spec that explicitly states: "All new routes (`/today`, `/plan`, `/ideas`) and their API endpoints require authenticated sessions. The existing NextAuth middleware matcher covers these by default. New API routes for ideas must include `getAuthContext()` session checks identical to the existing `/api/tasks/route.js` pattern."

---

### SEC-002: Ideas table -- no API route or service layer auth pattern specified

- **Spec Section:** Data Model > Ideas Table (lines 87-103), Idea Vault View (lines 197-218)
- **Severity:** High
- **Category:** Auth / Data Exposure
- **Description:** The spec defines a new `ideas` table with `user_id` scoping but does not specify an API route, service layer, or data access pattern for ideas. The existing task API (`/api/tasks/route.js`) enforces user scoping via `session.user.id` in both the route handler and the service layer (`taskService.js`). Without explicit guidance, the ideas implementation could omit the `user_id` filter, use the service-role client without scoping, or skip ownership verification on update/delete -- all patterns that would let one user read or modify another user's ideas. Since this app has **no RLS enforcement** (per CLAUDE.md), the only data isolation is application-level `user_id` filtering.
- **Impact:** Cross-user data leakage. User A could read, modify, or delete User B's ideas. Given the personal nature of ideas (captured thoughts, "why it matters"), this is a privacy violation.
- **Suggested fix:** The spec should mandate: (1) a new `/api/ideas/route.js` following the exact same auth pattern as `/api/tasks/route.js` (getAuthContext + session check + user_id filtering), (2) a new `ideaService.js` with ownership verification on all CRUD operations identical to `taskService.js`, and (3) all queries must include `.eq('user_id', session.user.id)`.

---

### SEC-003: Drag-and-drop state transitions lack server-side validation spec

- **Spec Section:** Interactions > Drag and Drop (lines 239-250), Sort Order Mechanics (lines 263-271)
- **Severity:** High
- **Category:** Input Validation
- **Description:** The spec states "Optimistic UI -- card moves instantly, database write in background" but does not specify what server-side validation occurs on the background write. Drag-and-drop allows changing `state`, `today_section`, and `sort_order` values. A malicious client (or tampered fetch request) could send arbitrary values for these fields. The current `taskService.js` uses a `TASK_UPDATE_FIELDS` allowlist, but the spec says this will be updated to include `state`, `today_section`, `sort_order`, and `chips` without specifying validation rules. The database CHECK constraints (`state IN (...)`, `today_section IN (...)`) provide a safety net for enum values, but `sort_order` is an unconstrained integer and `chips` is an unconstrained text array.
- **Impact:** A crafted PATCH request could: set `state` to any CHECK-valid value (e.g., move a task to `done` without proper `completed_at`), set `sort_order` to extreme values (see SEC-009), or inject arbitrary chip values (see SEC-004).
- **Suggested fix:** The spec should mandate: (1) `state` transitions must be validated server-side (e.g., cannot go from `done` back to `today` without clearing `completed_at`), (2) `today_section` must be enforced as null when `state != 'today'` (the DB constraint handles this, but the service layer should validate before write to return a meaningful error), (3) `sort_order` should be bounded (e.g., -10,000,000 to 10,000,000), and (4) `chips` values must be validated against the allowed set before write.

---

### SEC-004: Chips text[] array -- validation location and injection risk unspecified

- **Spec Section:** Data Model > Chips validation (line 84)
- **Severity:** Medium
- **Category:** Input Validation
- **Description:** The spec states "Application-level only (validate in taskService before write). No database CHECK constraint on the array -- this keeps chips extensible without migrations." This is a reasonable trade-off, but the spec does not define: (a) the exact validation logic (allowlist check against `CHIP_VALUES`?), (b) maximum array length, (c) whether duplicate values are rejected, or (d) whether the existing `sanitizeInput()` utility (in `validators.js`) should be applied to chip values. Since chips are stored as `text[]` and presumably rendered as coloured pills in the UI, unsanitized values could carry XSS payloads if rendered with `dangerouslySetInnerHTML` or similar.
- **Impact:** Without length limits, a user could store thousands of chip values per task, causing performance degradation. Without allowlist validation, arbitrary strings stored as chips could carry stored XSS payloads if the rendering layer is not defensive. Without duplicate rejection, UI confusion.
- **Suggested fix:** The spec should define: (1) chips must be validated against `CHIP_VALUES` constant -- reject any value not in the set, (2) maximum array length (7 values, matching the 7 defined chip types), (3) duplicates rejected, (4) the `validators.js` update section should include explicit chip validation logic.

---

### SEC-005: Migration deletes orphan notes without user confirmation

- **Spec Section:** Data Model > Notes Table (lines 114-133), Migration (lines 493-522)
- **Severity:** Medium
- **Category:** Migration
- **Description:** The migration includes `DELETE FROM notes WHERE project_id IS NULL AND task_id IS NULL;` to clean up orphan notes before applying the new constraint. The spec includes an audit comment (`SELECT count(*) FROM notes WHERE project_id IS NULL AND task_id IS NULL;`) but the actual migration unconditionally deletes these rows. If orphan notes exist and contain meaningful user data, this is irreversible data loss. The spec's rollback strategy mentions "full database backup before migration" but does not make the delete conditional or logged.
- **Impact:** Permanent loss of user-created notes that happen to be orphaned (e.g., due to a previous bug deleting a project/task without cascading). Users would have no indication their notes were deleted.
- **Suggested fix:** (1) The migration should log deleted notes to a `_migration_deleted_notes` table or export them before deletion. (2) Alternatively, assign orphan notes to a sentinel project/task rather than deleting them. (3) The dry-run step should report the count of orphan notes and require manual confirmation if count > 0.

---

### SEC-006: Quick Capture floating input -- XSS via unsanitized text fields

- **Spec Section:** Interactions > Quick Capture (lines 285-290)
- **Severity:** Medium
- **Category:** Input Validation
- **Description:** The Quick Capture input uses a `!` prefix to route input to the Ideas table instead of Tasks. The spec does not mention input sanitization for this input. The existing `sanitizeInput()` function in `validators.js` strips HTML tags and escapes special characters, but it is not called in the current `createTask` flow -- the `validateTask` function only checks length and required fields, not content sanitization. If the new Quick Capture implementation passes raw user input to the database without sanitization, and the Ideas table content is rendered unsafely, this creates a stored XSS vector. The `!` prefix parsing itself is safe (it's just a routing mechanism), but whatever text follows the `!` goes directly into `ideas.title`.
- **Impact:** Stored XSS if the Ideas view renders titles with `dangerouslySetInnerHTML` or as raw HTML. React's default JSX escaping mitigates this for normal rendering, but the risk exists if any rendering path bypasses JSX (e.g., email templates, CSV export, tooltip innerHTML).
- **Suggested fix:** (1) Apply `sanitizeInput()` to all user-provided text fields (task name, idea title, waiting_reason, area) in the service layer before database write. (2) Enforce maximum length on Quick Capture input (e.g., 500 chars). (3) Strip the `!` prefix before storing -- do not store the routing character as part of the title.

---

### SEC-007: Nullable project_id could bypass project-based ownership checks

- **Spec Section:** Data Model > Tasks Table (line 48), Project Association (lines 371-373)
- **Severity:** Medium
- **Category:** Auth
- **Description:** The current `createTask` in `taskService.js` performs a critical ownership check: it verifies `project.user_id === userId` before allowing task creation (line 154). With `project_id` becoming nullable, tasks without a project skip this check entirely. The `user_id` on the task itself provides scoping, but the spec does not address how the service layer should handle the null-project case. Additionally, the current `updateTask` flow (line 240-288) has logic for "Task must be associated with a project" that would need to be removed, but the replacement validation is unspecified.
- **Impact:** If the service layer is updated carelessly, a malicious request could create a task with `project_id` pointing to another user's project (bypassing ownership) or create orphaned tasks that evade project-scoped queries. The `user_id` field on the task mitigates direct data exposure, but the project ownership check is a defense-in-depth layer being removed.
- **Suggested fix:** The spec should state: (1) when `project_id` is null, skip the project ownership check but ensure `user_id` is set from the session (never from the request body), (2) when `project_id` is non-null, the existing project ownership check must be preserved, (3) the `TASK_UPDATE_FIELDS` allowlist must never include `user_id` (it currently does not, which is correct).

---

### SEC-008: Area field free text with no length limit defined

- **Spec Section:** Area Field Behaviour (lines 375-377)
- **Severity:** Medium
- **Category:** Injection
- **Description:** The spec defines the area dropdown as populated by `SELECT DISTINCT area FROM tasks WHERE area IS NOT NULL AND user_id = $1 UNION SELECT DISTINCT area FROM projects WHERE area IS NOT NULL AND user_id = $1`. This query uses a parameterised `$1` for `user_id`, which is correct. However, the `area` field itself is free text with no length limit, character restriction, or sanitization specified. The Supabase JS client uses parameterised queries internally, so direct SQL injection via the `.eq()` / `.insert()` methods is not possible. The risk is minimal but the spec should still define input bounds.
- **Impact:** SQL injection risk is effectively zero due to the Supabase client's parameterised queries. However, without length limits, a user could store extremely long area values (megabytes of text), causing performance issues on the DISTINCT query and UI rendering problems. Without character sanitization, control characters or zero-width characters could create confusing UI states.
- **Suggested fix:** (1) Define a maximum length for `area` (e.g., 100 characters). (2) Normalise empty strings to null (the spec mentions this -- good). (3) Trim whitespace. (4) Add to `validators.js` alongside the existing field validations.

---

### SEC-009: Sort order manipulation -- no bounds on integer value

- **Spec Section:** Sort Order Mechanics (lines 263-271)
- **Severity:** Low
- **Category:** Input Validation
- **Description:** The spec defines `sort_order` as `integer NOT NULL DEFAULT 0` with gap-based insertion logic. Since this is a single-user app (each user sees only their own tasks due to `user_id` scoping), one user cannot disrupt another user's sort order. However, a malicious client could send extreme `sort_order` values (e.g., `2147483647`, the PostgreSQL integer max) via a crafted PATCH request. The lazy reindex logic assumes gaps become < 1, but extreme values could cause integer overflow during the midpoint calculation `floor((above + below) / 2)`.
- **Impact:** Low. Single-user scoping means no cross-user disruption. Worst case: integer overflow causes incorrect sort order for the attacking user's own tasks, or a failed reindex operation.
- **Suggested fix:** (1) Validate `sort_order` in the service layer: reject values outside a reasonable range (e.g., -1,000,000 to 1,000,000). (2) The reindex operation should reset values to a clean sequence (0, 1000, 2000, ...) which inherently bounds the range. (3) The PATCH handler should not accept `sort_order` directly from the client -- instead, accept a "position" (before/after a sibling task ID) and compute `sort_order` server-side.

---

### SEC-010: Column drops in migration -- partial failure could leave inconsistent schema

- **Spec Section:** Migration (lines 493-522), Removals > Database Fields Removed (lines 406-414)
- **Severity:** Low
- **Category:** Migration
- **Description:** The migration drops 5 columns across 2 tables (`tasks.priority`, `tasks.importance_score`, `tasks.urgency_score`, `tasks.is_completed`, `projects.priority`) and renames 2 columns (`tasks.job` -> `area`, `projects.job` -> `area`). The spec correctly sequences this as: add new columns, seed data, audit functions/triggers, drop old columns, add constraints. However, if the migration fails partway through Step 4 (e.g., a function still references `is_completed`), the database could be left with both old and new columns, and the application code (already deployed for the new schema) would fail. The spec mentions "audit and update functions/triggers" in Step 3, which is good, but Supabase migrations are not transactional by default for DDL statements in all cases.
- **Impact:** A partial migration failure could leave the database in an inconsistent state requiring manual intervention. Data loss is unlikely (drops happen after seeding), but application downtime is possible.
- **Suggested fix:** (1) Wrap the entire migration in an explicit `BEGIN; ... COMMIT;` transaction (PostgreSQL DDL is transactional). (2) Add a verification query between Step 3 and Step 4 that confirms no remaining references to dropped columns exist in `information_schema.routines`. (3) Consider splitting into two migrations: one that adds new columns + seeds data (safe to roll back), and a second that drops old columns (only applied after the new code is verified working in production).

---

## Cross-Cutting Recommendations

1. **Add a Security section to the spec.** Every design spec that introduces new tables, routes, or data flows should have an explicit section listing auth requirements, data isolation strategy, and input validation rules.

2. **Mandate service-layer ownership checks for all new entities.** The pattern in `taskService.js` (verify `user_id` match before all CRUD operations) must be replicated for ideas. Consider extracting a shared `verifyOwnership(table, id, userId)` utility.

3. **Define input validation for all new fields in the spec.** The spec introduces `state`, `today_section`, `sort_order`, `area`, `task_type`, `chips`, `waiting_reason`, `follow_up_date`, and all Ideas fields. Each should have explicit validation rules (type, length, allowed values, sanitization) documented before implementation begins.

4. **RLS remains absent.** The CLAUDE.md notes "No RLS enforcement -- uses anon key with direct queries; security relies on NextAuth session checks." This refactor is an opportunity to add RLS policies, at minimum on the new `ideas` table. This is not a spec blocker but should be tracked as security debt.

---

## Risk Matrix

| Finding | Severity | Likelihood | Effort to Fix |
|---------|----------|------------|---------------|
| SEC-001 | High | Low (middleware covers by default) | Low (add spec text) |
| SEC-002 | High | High (new table, no existing pattern) | Medium (define API pattern) |
| SEC-003 | High | Medium (optimistic UI is common gap) | Medium (define validation rules) |
| SEC-004 | Medium | Medium | Low (define allowlist) |
| SEC-005 | Medium | Low (orphans likely rare) | Low (add logging/backup step) |
| SEC-006 | Medium | Low (React escapes by default) | Low (apply sanitizeInput) |
| SEC-007 | Medium | Medium (nullable FK changes auth flow) | Medium (define service layer rules) |
| SEC-008 | Medium | Very Low (Supabase parameterises) | Low (add length limit) |
| SEC-009 | Low | Low (single-user scoping) | Low (add bounds check) |
| SEC-010 | Low | Low (if Step 3 is thorough) | Medium (split migration) |
