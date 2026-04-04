# Performance Analyst Report: Prioritisation Replacement Design

**Date**: 2026-04-04
**Spec**: `docs/superpowers/specs/2026-04-04-prioritisation-replacement-design.md`
**Analyst**: Performance Specialist (Codex QA)

---

## Summary

The spec introduces a section-based containment model with drag-and-drop reordering, multiple new views (Today Focus, Plan Board, Idea Vault), and an ideas table. The existing app does all data fetching client-side via direct Supabase queries through API routes using a service-role client. This review identifies eight performance concerns ordered by severity.

---

## Findings

### PERF-001: Missing Database Indexes for New Query Patterns (Severity: HIGH)

**What**: The new model fundamentally changes every task query. The primary access patterns become:
1. Today view: `WHERE user_id = $1 AND state = 'today' ORDER BY today_section, sort_order`
2. Plan Board: `WHERE user_id = $1 AND state IN ('today','this_week','backlog','waiting') ORDER BY sort_order`
3. Completed today: `WHERE user_id = $1 AND state = 'done' AND completed_at >= $2`
4. Area dropdown: `SELECT DISTINCT area FROM tasks WHERE user_id = $1 AND area IS NOT NULL`

The existing index `idx_tasks_user_completed_due_priority ON (user_id, is_completed, due_date, priority DESC)` becomes completely useless after the migration drops `is_completed` and `priority`. None of the new query patterns have covering indexes.

**Impact**: Every view loads via a sequential scan on `tasks` filtered by `user_id`. For a user with hundreds of tasks this is noticeable latency on every page load and every drag operation.

**Recommendation**: The migration MUST include these indexes:

```sql
-- Primary view index (covers Today, Plan Board, and state-filtered queries)
CREATE INDEX idx_tasks_user_state_sort
ON tasks (user_id, state, sort_order);

-- Today view with section ordering
CREATE INDEX idx_tasks_user_today_section_sort
ON tasks (user_id, today_section, sort_order)
WHERE state = 'today';

-- Completed today filter (timestamptz range scan)
CREATE INDEX idx_tasks_user_completed_at
ON tasks (user_id, completed_at DESC)
WHERE state = 'done';

-- Area dropdown distinct query
CREATE INDEX idx_tasks_user_area
ON tasks (user_id, area)
WHERE area IS NOT NULL;

-- Waiting follow-up date for overdue detection
CREATE INDEX idx_tasks_user_followup
ON tasks (user_id, follow_up_date)
WHERE state = 'waiting' AND follow_up_date IS NOT NULL;

-- Ideas table
CREATE INDEX idx_ideas_user_state
ON ideas (user_id, idea_state);
```

Also drop the now-useless legacy indexes in the same migration:
- `idx_tasks_user_completed_due_priority`
- `idx_tasks_user_scores`

---

### PERF-002: Drag-and-Drop Sort Order Updates Cause N+1 Writes (Severity: HIGH)

**What**: The spec says "Optimistic UI -- card moves instantly, database write in background." But it does not specify the write strategy. A single drag-and-drop reorder within a section requires:
1. Update the moved card's `sort_order` (1 write)
2. If the gap-based approach exhausts gaps (gap < 1), a lazy reindex updates ALL items in that state+section

The current `updateTask` in `taskService.js` performs a full ownership check, validation pass, project lookup, and Office 365 sync per call. A reindex of 20 items through `updateTask` would be 20 sequential round trips, each with auth checks and O365 sync attempts.

**Impact**: A single drag in a large section could trigger 20+ sequential DB writes, each taking 50-100ms. Total latency: 1-2 seconds of background writes, during which the optimistic UI is out of sync with the DB. If the user navigates away or drags again before writes complete, data can be lost or corrupted.

**Recommendation**:
- Add a dedicated `updateSortOrder` function in `taskService.js` that accepts an array of `{id, sort_order, state, today_section}` and performs a single batch UPDATE via Supabase's `.upsert()` or a raw SQL `UPDATE ... FROM (VALUES ...)` statement.
- Skip validation, project lookup, and Office 365 sync for sort-order-only updates -- these are positional changes, not content changes.
- The batch endpoint should accept up to 50 items and execute in a single round trip.
- Add `skipOffice365Sync: true` and `skipProjectTouch: true` for sort-order updates.

---

### PERF-003: Plan Board Fetches All Active Tasks in One Query (Severity: MEDIUM)

**What**: The Plan Board shows four columns (Today, This Week, Backlog, Waiting) simultaneously. The current API route (`GET /api/tasks`) fetches all tasks with pagination (default limit 100). The new Plan Board needs ALL active tasks (state != 'done') to populate all four columns.

For a user with 200+ active tasks, a single unbounded query returns all of them. The current pagination cap is 200 rows per request.

**Impact**:
- Payload size: 200 tasks with all fields, chips arrays, and joined project data could be 100-200KB of JSON.
- Supabase query time: Without proper indexes (see PERF-001), this is a full table scan.
- Client-side: React must render and maintain state for 200+ draggable card components across 4 columns.

**Recommendation**:
- Keep pagination. Load Today and This Week eagerly (these are small, bounded by soft caps). Load Backlog and Waiting lazily or with virtual scrolling.
- Consider separate API calls per state, so the Today view (which is the default landing page) loads fast without waiting for the full Backlog.
- Add `{ count: 'exact' }` only when pagination controls are visible -- it doubles query cost on large tables.

---

### PERF-004: Optimistic UI Race Conditions on Rapid Drag Sequences (Severity: MEDIUM)

**What**: The spec says "Optimistic UI -- card moves instantly, database write in background." If a user drags card A to position 3, then immediately drags card B to position 2 (before A's write completes), the client state diverges from the server. The second write may use stale sort_order values.

**Impact**: Tasks appear in wrong order after page refresh. The more actively a user drags (which is the whole point of the new UX), the more likely this becomes.

**Recommendation**:
- Implement a write queue that serialises sort-order mutations. Each drag enqueues a write; the queue processes them sequentially.
- Alternatively, debounce sort-order writes: wait 300ms after the last drag before writing. If the user drags multiple items in quick succession, only the final state is persisted.
- On write failure, revert the optimistic state and show a toast. The current pattern of `console.warn` on sync failure is insufficient -- the user sees a moved card but the DB disagrees.

---

### PERF-005: SELECT DISTINCT Area Query on Every Dropdown Open (Severity: MEDIUM)

**What**: The area dropdown is populated by:
```sql
SELECT DISTINCT area FROM tasks WHERE area IS NOT NULL AND user_id = $1
UNION
SELECT DISTINCT area FROM projects WHERE area IS NOT NULL AND user_id = $1
```

This runs two `DISTINCT` scans (one on tasks, one on projects) and a `UNION` dedup every time the user opens the area dropdown on any card.

**Impact**: For a user with 500+ tasks, this is a sequential scan without the index from PERF-001. Even with the index, it runs on every dropdown open across every card in every view.

**Recommendation**:
- Cache area values in React state at view load time. Refresh only on task/project create/update that changes the area field.
- Alternatively, fetch areas once via a dedicated `GET /api/areas` endpoint and cache client-side with a 60-second TTL.
- With the `idx_tasks_user_area` partial index from PERF-001, the query itself will be fast, but avoiding repeated calls is still worthwhile.

---

### PERF-006: Completed Today Filter Requires Timezone Calculation (Severity: LOW)

**What**: The "Completed today" section filters by `completed_at >= start of today (Europe/London)`. The spec correctly identifies Europe/London as the timezone. However, the boundary calculation (`start of today in Europe/London converted to UTC`) must happen either:
- On every render (client-side), or
- On every API call (server-side)

The existing `dateUtils.js` has London timezone utilities, but the start-of-day boundary must account for BST/GMT transitions (clocks change in March and October).

**Impact**: Low -- this is a simple computation. But if implemented as a client-side filter over all done tasks (rather than a server-side WHERE clause), it fetches unnecessary data.

**Recommendation**:
- Compute the boundary server-side in the API route using `date-fns-tz` or the existing `dateUtils.js` London helpers.
- Pass it as a `completed_at >= $boundary` filter in the Supabase query, not as a client-side `.filter()` over all done tasks.
- The `idx_tasks_user_completed_at` index from PERF-001 makes this a fast range scan.

---

### PERF-007: Staleness Detection on Every Render (Severity: LOW)

**What**: "This Week items with state_changed_at > 14 days old get a subtle stale badge." This comparison runs for every This Week card on every render.

**Impact**: Negligible for computation -- comparing two dates is O(1) per card. But if `state_changed_at` is fetched as a string and parsed into a Date object on every render for every card, there is minor GC pressure with many cards.

**Recommendation**:
- Compute `isStale` once when the task data arrives (in the data transformation layer), not in the render function.
- Store as a derived boolean on the client-side task object. Example:
  ```js
  task.isStale = task.state === 'this_week' &&
    (Date.now() - new Date(task.state_changed_at).getTime()) > 14 * 86400000;
  ```
- This avoids repeated Date construction in React render cycles.

---

### PERF-008: Sort Order Gap Exhaustion and Lazy Reindex Timing (Severity: LOW)

**What**: The gap-based integer approach starts with gaps of 1000. Inserting between two adjacent items halves the gap each time. After ~10 insertions between the same two items, the gap approaches 1 and triggers a full reindex of the state+section.

**Impact**: The reindex itself is bounded -- a section like "Must Do" has a soft cap of 5 items. Even the Backlog reindex is bounded by the user's total task count (likely < 500). The concern is that the reindex happens synchronously during a drag operation, adding latency to what should be an instant interaction.

**Recommendation**:
- The lazy reindex should be a batch operation (see PERF-002 recommendation) -- a single SQL UPDATE with computed sort_order values, not N individual updates.
- Detect gap exhaustion client-side and reindex optimistically (reassign sort_order values with 1000 gaps in the local state), then persist the full reindex in one batch write.
- For the expected dataset sizes in this app (single user, < 500 active tasks, sections of 5-20 items), gap exhaustion will be rare and the reindex fast. This is low severity but should still use the batch write path.

---

## Index Migration Checklist

The migration file should include all of the following in a single transaction:

| Action | Index Name | Columns |
|--------|-----------|---------|
| CREATE | `idx_tasks_user_state_sort` | `(user_id, state, sort_order)` |
| CREATE | `idx_tasks_user_today_section_sort` | `(user_id, today_section, sort_order) WHERE state = 'today'` |
| CREATE | `idx_tasks_user_completed_at` | `(user_id, completed_at DESC) WHERE state = 'done'` |
| CREATE | `idx_tasks_user_area` | `(user_id, area) WHERE area IS NOT NULL` |
| CREATE | `idx_tasks_user_followup` | `(user_id, follow_up_date) WHERE state = 'waiting' AND follow_up_date IS NOT NULL` |
| CREATE | `idx_ideas_user_state` | `(user_id, idea_state)` |
| DROP | `idx_tasks_user_completed_due_priority` | Legacy -- references dropped columns |
| DROP | `idx_tasks_user_scores` | Legacy -- references dropped columns |

---

## Summary Table

| ID | Severity | Area | One-Line Summary |
|----|----------|------|-----------------|
| PERF-001 | HIGH | Database | No indexes for new state/section/sort_order query patterns |
| PERF-002 | HIGH | Database | Drag reorder triggers N sequential writes through heavyweight update path |
| PERF-003 | MEDIUM | Network | Plan Board loads all active tasks in one unbounded query |
| PERF-004 | MEDIUM | Client | Rapid drag sequences cause optimistic UI / DB state divergence |
| PERF-005 | MEDIUM | Database | DISTINCT area query runs on every dropdown open |
| PERF-006 | LOW | Compute | Timezone boundary for completed-today should be server-side, not client filter |
| PERF-007 | LOW | Client | Staleness check should be computed once, not on every render |
| PERF-008 | LOW | Database | Lazy reindex should use batch write, not N individual updates |
