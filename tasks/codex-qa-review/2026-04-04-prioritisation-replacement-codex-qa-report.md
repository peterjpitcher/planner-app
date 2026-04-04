# QA Review Report

**Scope:** `docs/superpowers/specs/2026-04-04-prioritisation-replacement-design.md` — design spec for replacing all prioritisation mechanics
**Date:** 2026-04-04
**Mode:** Spec Compliance Review
**Engines:** Claude-only (Codex CLI auth expired — all 5 specialists ran as Claude subagents)
**Spec:** The design spec itself is the subject, reviewed against the existing codebase

## Executive Summary

Five specialists reviewed the prioritisation replacement spec against the existing codebase, project conventions, and security/performance best practices. **72 findings total** across all specialists (after deduplication: **48 unique issues**). The spec's core design is sound — section-based containment, ideas entity, and chip-based differentiation are well-conceived. The primary gaps are: incomplete file impact analysis (the apiClient layer and O365 inbound sync are missing), undefined implementation details for critical mechanics (indexes, batch sort operations, state transition validation), and missing backend specification for the Ideas entity.

**By severity after deduplication: 6 Critical, 11 High, 20 Medium, 11 Low**

---

## Critical Findings

### CRIT-001: Migration has no transaction wrapping — partial failure causes data loss
- **Sources:** Bug Hunter (BUG-001), Security Auditor (SEC-010)
- **Description:** The 5-step migration has no explicit `BEGIN/COMMIT`. A failure at step 2 (seed data) followed by step 4 (drop columns) destroys data that was never copied. Supabase migrations are not automatically transactional for multi-statement files.
- **Fix:** Wrap all 5 steps in `BEGIN...COMMIT`. Add verification queries between seeding and dropping. Consider splitting into two migrations: add+seed first, drop columns second after verification.

### CRIT-002: apiClient layer entirely absent from spec
- **Sources:** Spec Compliance (SPEC-003)
- **Description:** Every frontend component calls `apiClient.createTask()`, `apiClient.updateTask()` etc., passing `is_completed`, `priority`, `job`, `importance_score`. This bridge between frontend and API is not mentioned anywhere in the spec. Without updating it, the frontend sends stale field names and fails to send new ones.
- **Fix:** Add `src/lib/apiClient.js` to the "Code Modified" table with explicit field mapping changes for all CRUD operations.

### CRIT-003: Office 365 inbound sync writes `priority` and `is_completed` to database
- **Sources:** Spec Compliance (SPEC-004, SPEC-005)
- **Description:** The spec only covers outbound O365 sync. The inbound path (`normalizeLocalTask`, `buildTodoTaskPayload`, and the update handler) writes `priority` and `is_completed` directly to the database. After migration, these columns won't exist.
- **Fix:** Expand the O365 section to cover inbound sync: map Graph `status === 'completed'` to `state = 'done'`, stop writing `priority`, update `normalizeLocalTask` and `tasksMatch` comparison functions.

### CRIT-004: `check_today_section` constraint breaks non-atomic state transitions
- **Sources:** Bug Hunter (BUG-002)
- **Description:** The constraint requires `state` and `today_section` to always be updated atomically. Drag-and-drop from `today` to `this_week` must set `state = 'this_week'` AND `today_section = NULL` in a single UPDATE. If the ORM or application code sets them separately, the intermediate state violates the constraint and the write fails silently.
- **Fix:** Add a `BEFORE INSERT OR UPDATE` trigger that auto-sets `today_section = 'good_to_do'` when `state = 'today'` and `today_section IS NULL`, and auto-nulls it when `state != 'today'`. Document that both fields must always be updated in a single statement.

### CRIT-005: `validateTask()` requires `project_id` — blocks core new behaviour
- **Sources:** Spec Compliance (SPEC-012), Standards Enforcer (STD-002)
- **Description:** The validator at `validators.js:112-114` rejects tasks without `project_id`. The spec makes `project_id` nullable but doesn't mention updating this validator. Creating standalone tasks (the core new behaviour) will always fail.
- **Fix:** Explicitly add "Remove mandatory project_id validation" to the validators.js entry.

### CRIT-006: No database indexes defined for new query patterns
- **Sources:** Performance Analyst (PERF-001), Bug Hunter (BUG-016)
- **Description:** The migration drops the existing index on `(user_id, is_completed, due_date, priority)` but defines no replacement indexes. Every view will sequential scan.
- **Fix:** Add 6 new indexes and drop 2 legacy ones in the migration (full list in Performance Analyst report).

---

## High Findings

### HIGH-001: Ideas table has no API routes, service layer, or auth pattern
- **Sources:** Standards Enforcer (STD-005), Security Auditor (SEC-002)
- **Description:** The spec defines the ideas schema and UI but no backend. No API routes, no service layer, no validation, no auth checks. Since the app has no RLS, application-level `user_id` filtering is the only data isolation — and it's unspecified for ideas.
- **Fix:** Add Ideas service layer section: API routes, CRUD functions, ownership verification, validation rules, promote-to-task workflow.

### HIGH-002: Drag-and-drop sort order writes cause N+1 sequential DB calls
- **Sources:** Performance Analyst (PERF-002)
- **Description:** A lazy reindex of 20 items through the existing `updateTask` (which does auth checks, validation, O365 sync per call) means 20 sequential round trips at 50-100ms each.
- **Fix:** Add a dedicated `updateSortOrder` batch endpoint that skips validation/sync for positional-only updates.

### HIGH-003: Server-side validation for drag state transitions unspecified
- **Sources:** Security Auditor (SEC-003)
- **Description:** Optimistic UI sends `state`, `today_section`, `sort_order`, `chips` from the client. No server-side validation rules are defined. A crafted request could set arbitrary state values.
- **Fix:** Define server-side validation: state transitions must be valid, `today_section` enforced when `state = 'today'`, chips validated against allowlist, `sort_order` bounded.

### HIGH-004: `layout.js` imports deleted `TargetProjectProvider`
- **Sources:** Spec Compliance (SPEC-002)
- **Description:** `src/app/layout.js` wraps the app in `TargetProjectProvider` from the context being deleted. Build failure if not addressed.
- **Fix:** Add `src/app/layout.js` to "Code Modified" table — remove provider import and wrapper.

### HIGH-005: `TASK_UPDATE_FIELDS` whitelist contains removed fields
- **Sources:** Spec Compliance (SPEC-010)
- **Description:** The field whitelist in `taskService.js` gates all updates. It still contains `priority`, `is_completed`, `job`, `importance_score`, `urgency_score`. Without replacement, no new fields can be written.
- **Fix:** Explicitly list the new whitelist in the spec.

### HIGH-006: No loading/error/empty states for new views
- **Sources:** Standards Enforcer (STD-003)
- **Description:** Three new views (Today, Plan, Ideas) have no loading skeletons, error fallbacks, or empty state CTAs defined. Violates ui-patterns.md.
- **Fix:** Add a "States" subsection to each view.

### HIGH-007: ON DELETE CASCADE on project_id destroys independent tasks
- **Sources:** Bug Hunter (BUG-012)
- **Description:** With tasks now independent entities, cascade-deleting them when a project is deleted is catastrophic data loss.
- **Fix:** Change FK to `ON DELETE SET NULL`. Add to migration.

### HIGH-008: `dateUtils.js` uses client-local time, not Europe/London
- **Sources:** Bug Hunter (BUG-003)
- **Description:** The "Completed today" boundary needs Europe/London timezone, but no timezone-aware utility exists. DST transitions shift the boundary by an hour.
- **Fix:** Add `getStartOfTodayLondon()` utility. Compute boundary server-side.

### HIGH-009: Waiting tasks with null follow-up date rot silently
- **Sources:** Bug Hunter (BUG-009)
- **Description:** Both `waiting_reason` and `follow_up_date` are optional. Tasks in Waiting with both null get no staleness detection and are forgotten.
- **Fix:** Add staleness detection for Waiting items with null `follow_up_date` (e.g., flag after 7 days).

### HIGH-010: Area dropdown case sensitivity creates duplicates
- **Sources:** Bug Hunter (BUG-007)
- **Description:** `SELECT DISTINCT area` is case-sensitive. "Admin" and "admin" are different values.
- **Fix:** Normalise area on write (trim + lowercase or title-case).

### HIGH-011: Quick capture `!` prefix has no escape mechanism
- **Sources:** Bug Hunter (BUG-008)
- **Description:** No way to create a task starting with `!`. Users who prefix urgent items with `!` accidentally create ideas.
- **Fix:** Use `! ` (exclamation + space) as the trigger, not bare `!`.

---

## Medium Findings (20)

| ID | Summary | Sources |
|----|---------|---------|
| MED-001 | Plan Board fetches all active tasks unbounded | PERF-003 |
| MED-002 | Rapid drag sequences cause optimistic UI divergence | PERF-004 |
| MED-003 | Area DISTINCT query runs on every dropdown open | PERF-005 |
| MED-004 | Promoted idea has no back-reference to created task | BUG-005 |
| MED-005 | Notes on done tasks become invisible, lifecycle undefined | BUG-006 |
| MED-006 | Migration seeds sort_order=0 for all tasks, initial ordering undefined | BUG-010 |
| MED-007 | Constraint timing ambiguous between migration Steps 1 and 5 | BUG-011 |
| MED-008 | No RLS policies for ideas table | BUG-013 |
| MED-009 | Completed-report page component not in code changes list | BUG-014 |
| MED-010 | Optimistic drag contradicts inline prompt for Waiting | BUG-015 |
| MED-011 | Today view needs dual query (state=today + completed today) not specified | BUG-017 |
| MED-012 | Chips array has no length limit, dedup, or allowlist enforcement defined | SEC-004 |
| MED-013 | Orphan notes deleted without logging or backup | SEC-005, STD-011 |
| MED-014 | Quick capture input sanitisation unspecified | SEC-006 |
| MED-015 | Nullable project_id removes defence-in-depth ownership check | SEC-007 |
| MED-016 | Area field has no length limit | SEC-008 |
| MED-017 | Date handling — spec should mandate getDueDateStatus() reuse | STD-007 |
| MED-018 | Accessibility gaps in drag-and-drop interactions | STD-008 |
| MED-019 | No testing strategy for new components | STD-009 |
| MED-020 | Server vs client component strategy not addressed | STD-010 |

---

## Low Findings (11)

| ID | Summary | Sources |
|----|---------|---------|
| LOW-001 | TargetProjectContext file extension mismatch (.tsx vs .js) | SPEC-001 |
| LOW-002 | Completed-today timezone should be computed server-side | PERF-006 |
| LOW-003 | Staleness check should be computed once, not on render | PERF-007 |
| LOW-004 | Lazy reindex should use batch write path | PERF-008 |
| LOW-005 | No bulk operations for weekly triage | BUG-018 |
| LOW-006 | CHECK constraints must be dropped before columns | BUG-020 |
| LOW-007 | project_id NOT NULL must be altered before nullable seeding | BUG-021 |
| LOW-008 | Sort order has no bounds check | SEC-009 |
| LOW-009 | Note validator needs idea_id support | STD-012 |
| LOW-010 | New constants exact shapes not defined | STD-013 |
| LOW-011 | Nudge dismissal persistence unspecified | STD-014 |

---

## Standards Override Note

**STD-001 (Big Bang vs Incremental):** The user explicitly chose "Big Bang" after being presented with all three approaches. While this conflicts with the workspace complexity rule (score >= 4 must decompose), the user's explicit instruction takes precedence per the Source of Truth Hierarchy. The implementation plan should still decompose the work into ordered phases/PRs to manage risk — the "Big Bang" decision means no dual-state intermediate code, not that all work lands in a single commit.

---

## Recommendations — Priority Order

### Must fix before implementation (6 items)
1. **CRIT-001**: Wrap migration in transaction + add verification
2. **CRIT-002**: Add apiClient to change list
3. **CRIT-003**: Expand O365 inbound sync coverage
4. **CRIT-004**: Add auto-healing trigger for today_section constraint
5. **CRIT-005**: Remove mandatory project_id validation
6. **CRIT-006**: Define all database indexes in migration

### Should fix before implementation (11 items)
All HIGH findings — particularly HIGH-001 (Ideas backend), HIGH-002 (batch sort endpoint), and HIGH-007 (ON DELETE SET NULL).

### Can address during implementation (31 items)
Medium and Low findings can be resolved as each component is built, with the implementation plan calling out which findings apply to which phase.
