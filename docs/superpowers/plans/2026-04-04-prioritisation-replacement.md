# Prioritisation Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace both legacy priority systems with a section-based containment model (Today/This Week/Backlog/Waiting/Done) plus an independent Ideas entity.

**Architecture:** Five ordered phases — schema migration first, then service layer, then new views, then integration updates, then legacy cleanup. Each phase produces working, deployable code. The app is non-functional between phase 1 (schema change) and phase 2 (service layer update) — these must deploy together.

**Tech Stack:** Next.js 15.3, React 19, Supabase (direct queries via anon key), NextAuth v5, Tailwind CSS 4, Headless UI, @dnd-kit/core + @dnd-kit/sortable (new), date-fns + date-fns-tz (new), Vitest (new)

**Spec:** `docs/superpowers/specs/2026-04-04-prioritisation-replacement-design.md`

---

## Phase 1: Schema & Migration

### Task 1.1: Set up Vitest

**Files:**
- Create: `vitest.config.js`
- Create: `src/lib/__tests__/setup.js`
- Modify: `package.json`

- [ ] **Step 1: Install Vitest and dependencies**

```bash
npm install --save-dev vitest @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 2: Create vitest config**

Create `vitest.config.js`:
```js
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/lib/__tests__/setup.js'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

Create `src/lib/__tests__/setup.js`:
```js
import '@testing-library/jest-dom';
```

- [ ] **Step 3: Add test scripts to package.json**

Add to `scripts`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify Vitest works**

Run: `npm test`
Expected: 0 tests found, no errors

- [ ] **Step 5: Commit**

```bash
git add vitest.config.js src/lib/__tests__/setup.js package.json package-lock.json
git commit -m "chore: add Vitest test infrastructure"
```

---

### Task 1.2: Update constants

**Files:**
- Modify: `src/lib/constants.js`
- Create: `src/lib/__tests__/constants.test.js`

- [ ] **Step 1: Write test for new constants**

Create `src/lib/__tests__/constants.test.js`:
```js
import { describe, it, expect } from 'vitest';
import {
  STATE, TODAY_SECTION, TODAY_SECTION_ORDER, IDEA_STATE_ORDER,
  TASK_TYPE, CHIP_VALUES, IDEA_STATE, SOFT_CAPS
} from '../constants';

describe('constants', () => {
  it('STATE has all 5 values', () => {
    expect(Object.values(STATE)).toEqual(['today', 'this_week', 'backlog', 'waiting', 'done']);
  });

  it('TODAY_SECTION has 3 values', () => {
    expect(Object.values(TODAY_SECTION)).toEqual(['must_do', 'good_to_do', 'quick_wins']);
  });

  it('TODAY_SECTION_ORDER matches TODAY_SECTION values in display order', () => {
    expect(TODAY_SECTION_ORDER).toEqual(['must_do', 'good_to_do', 'quick_wins']);
  });

  it('CHIP_VALUES has 5 cross-cutting chips (no quick_win or deep_work)', () => {
    const values = Object.values(CHIP_VALUES);
    expect(values).toHaveLength(5);
    expect(values).not.toContain('quick_win');
    expect(values).not.toContain('deep_work');
  });

  it('TASK_TYPE has 7 values', () => {
    expect(Object.values(TASK_TYPE)).toHaveLength(7);
  });

  it('SOFT_CAPS are correct', () => {
    expect(SOFT_CAPS.MUST_DO).toBe(5);
    expect(SOFT_CAPS.GOOD_TO_DO).toBe(5);
    expect(SOFT_CAPS.QUICK_WINS).toBe(8);
    expect(SOFT_CAPS.THIS_WEEK).toBe(15);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/constants.test.js`
Expected: FAIL — STATE, TODAY_SECTION etc. not exported

- [ ] **Step 3: Update constants.js**

Open `src/lib/constants.js`. Remove `PRIORITY`, `PRIORITY_VALUES`. Add all new constants exactly as defined in the spec's Constants section. Keep all non-priority constants (VALIDATION, PROJECT_STATUS, NOTE_TYPE, DRAG_DATA_TYPES, etc.) unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/constants.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/constants.js src/lib/__tests__/constants.test.js
git commit -m "feat: replace priority constants with state/section/chip constants"
```

---

### Task 1.3: Update validators

**Files:**
- Modify: `src/lib/validators.js`
- Create: `src/lib/__tests__/validators.test.js`

- [ ] **Step 1: Write tests for updated validators**

Create `src/lib/__tests__/validators.test.js`. Test cases:
- `validateTask`: accepts null `project_id`, rejects invalid `state`, requires `today_section` when state is `today`, validates `chips` against allowlist with max 5 and no duplicates, validates `task_type` enum, validates `area` max 100 chars
- `validateProject`: no longer validates `priority`
- `validateNote`: accepts `idea_id` as valid parent
- `validateIdea`: validates title required (1-255), idea_state enum, area max 100

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/validators.test.js`
Expected: FAIL

- [ ] **Step 3: Update validators.js**

- Remove `PRIORITY` import
- Remove `priority` validation from `validateProject`
- Remove `importance_score`, `urgency_score` validation from `validateTask`
- Remove mandatory `project_id` check from `validateTask`
- Add `state` validation (must be in STATE values)
- Add `today_section` validation (must be in TODAY_SECTION when state='today')
- Add `chips` validation (array, max 5, each in CHIP_VALUES, no duplicates)
- Add `task_type` validation (must be in TASK_TYPE if provided)
- Add `area` validation (max 100 chars)
- Add `waiting_reason` validation (max 500 chars)
- Update `validateNote` to accept `idea_id` as valid parent
- Add `validateIdea` function

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/validators.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/validators.js src/lib/__tests__/validators.test.js
git commit -m "feat: update validators for state-based model, add idea validation"
```

---

### Task 1.4: Add date-fns-tz and getStartOfTodayLondon

**Files:**
- Modify: `src/lib/dateUtils.js`
- Create: `src/lib/__tests__/dateUtils.test.js`

- [ ] **Step 1: Install date-fns-tz**

```bash
npm install date-fns-tz
```

- [ ] **Step 2: Write test for getStartOfTodayLondon**

Create `src/lib/__tests__/dateUtils.test.js`:
```js
import { describe, it, expect, vi } from 'vitest';
import { getStartOfTodayLondon } from '../dateUtils';

describe('getStartOfTodayLondon', () => {
  it('returns a Date object', () => {
    const result = getStartOfTodayLondon();
    expect(result).toBeInstanceOf(Date);
  });

  it('returns start of day (hours/minutes/seconds are 0 in London time)', () => {
    const result = getStartOfTodayLondon();
    // The result is a UTC timestamp representing midnight London time
    expect(result.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/dateUtils.test.js`
Expected: FAIL — function not exported

- [ ] **Step 4: Add getStartOfTodayLondon to dateUtils.js**

Add to `src/lib/dateUtils.js`:
```js
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { startOfDay } from 'date-fns';

export function getStartOfTodayLondon() {
  const now = new Date();
  const londonNow = toZonedTime(now, 'Europe/London');
  const londonMidnight = startOfDay(londonNow);
  return fromZonedTime(londonMidnight, 'Europe/London');
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/dateUtils.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/dateUtils.js src/lib/__tests__/dateUtils.test.js package.json package-lock.json
git commit -m "feat: add getStartOfTodayLondon timezone utility"
```

---

### Task 1.5: Write and dry-run migration

**Files:**
- Create: `supabase/migrations/20260404000001_prioritisation_replacement.sql`

- [ ] **Step 1: Manually review orphan notes**

Run against Supabase:
```sql
SELECT id, content, created_at, user_id FROM notes WHERE project_id IS NULL AND task_id IS NULL;
```
If any exist, decide per-note: assign to a project or delete. Do not proceed until orphan count is zero.

- [ ] **Step 2: Write the migration file**

Create `supabase/migrations/20260404000001_prioritisation_replacement.sql` with the full transaction-wrapped migration from the spec. All 6 steps inside `BEGIN...COMMIT`:

1. Structural changes (create ideas table, add new columns, alter project_id nullable, recreate FK with ON DELETE SET NULL, add idea_id to notes, add area to projects, drop priority CHECK constraints)
2. Seed data (state from is_completed, copy job to area, incremental sort_order, entered_state_at from COALESCE(updated_at, created_at), null out Unassigned project tasks)
3. Verify seeding (SELECT count queries)
4. Handle orphan notes (update notes constraint — orphans already resolved in step 1)
5. Audit and update PL/pgSQL functions referencing dropped columns
6. Drop old columns (priority, importance_score, urgency_score, is_completed, job on tasks; priority, job on projects)
7. Add constraints, trigger, and indexes

Ref: spec section "Migration > Transaction-Wrapped Migration" for exact SQL.

- [ ] **Step 3: Dry-run the migration**

```bash
npx supabase db push --dry-run
```
Expected: Migration plan shows all changes, no errors.

- [ ] **Step 4: Commit migration file (do NOT apply yet)**

```bash
git add supabase/migrations/20260404000001_prioritisation_replacement.sql
git commit -m "feat: add prioritisation replacement migration (not yet applied)"
```

---

## Phase 2: Service Layer

### Task 2.1: Update taskService — field whitelist and remove ensureUnassignedProject

**Files:**
- Modify: `src/services/taskService.js`

- [ ] **Step 1: Replace TASK_UPDATE_FIELDS whitelist**

In `src/services/taskService.js`, replace the `TASK_UPDATE_FIELDS` Set (lines 6-18) with:
```js
const TASK_UPDATE_FIELDS = new Set([
  'name',
  'description',
  'due_date',
  'state',
  'today_section',
  'area',
  'task_type',
  'chips',
  'waiting_reason',
  'follow_up_date',
  'project_id',
  'completed_at',
  'updated_at',
]);
```

Note: `sort_order` is deliberately excluded — it's computed server-side, never accepted from client.

- [ ] **Step 2: Remove ensureUnassignedProject and isUnassignedProject**

Delete both functions. Remove all calls to `ensureUnassignedProject` from `createTask`.

- [ ] **Step 3: Update createTask**

- Remove the `ensureUnassignedProject` call at the start
- Remove `priority`, `importance_score`, `urgency_score`, `is_completed` from the insert payload
- Add `state` (default 'backlog'), `today_section`, `sort_order`, `area`, `task_type`, `chips`, `waiting_reason`, `follow_up_date`, `entered_state_at`
- When `state = 'today'` and no `today_section` provided, set `today_section = 'good_to_do'` in the service layer (NOT the database trigger)
- Rename `job` to `area` in the insert

- [ ] **Step 4: Update updateTask**

- Remove `priority`, `importance_score`, `urgency_score`, `is_completed`, `job` handling
- Add handling for new fields
- When `state` changes to 'today', ensure `today_section` is set (default 'good_to_do' if not provided)
- When `state` changes away from 'today', do NOT send `today_section` (trigger clears it)
- When `state` changes to 'done', `completed_at` is set by trigger — do not set in service
- Update ownership validation: when `project_id` is null, skip project ownership check but ensure `user_id` matches session

- [ ] **Step 5: Add updateSortOrder batch function**

Add new function. Uses a Supabase RPC call for a true single-query batch update (spec requires "single batch UPDATE, not N individual updates"):

```js
async function updateSortOrder({ supabase, userId, items }) {
  // items = [{id, sort_order}, ...], max 50
  if (!items || items.length === 0 || items.length > 50) {
    return { error: 'Invalid batch size' };
  }
  // Verify ownership of all task IDs
  const ids = items.map(i => i.id);
  const { data: owned } = await supabase
    .from('tasks')
    .select('id')
    .in('id', ids)
    .eq('user_id', userId);
  if (!owned || owned.length !== ids.length) {
    return { error: 'Ownership verification failed' };
  }
  // True batch update via RPC — calls the fn_batch_update_sort_order function
  // created in the migration (see Task 1.5)
  const { error } = await supabase.rpc('fn_batch_update_sort_order', {
    p_user_id: userId,
    p_items: JSON.stringify(items),
  });
  if (error) return { error };
  return { success: true };
}
```

The corresponding database function must be added to the migration:
```sql
CREATE OR REPLACE FUNCTION fn_batch_update_sort_order(p_user_id UUID, p_items JSONB)
RETURNS void AS $$
BEGIN
  UPDATE tasks SET
    sort_order = (item->>'sort_order')::integer,
    updated_at = now()
  FROM jsonb_array_elements(p_items) AS item
  WHERE tasks.id = (item->>'id')::uuid
    AND tasks.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

- [ ] **Step 6: Update all select/query clauses**

Search taskService.js for all `.select()` calls. Remove `priority`, `importance_score`, `urgency_score`, `is_completed`. Add `state`, `today_section`, `sort_order`, `area`, `task_type`, `chips`, `waiting_reason`, `follow_up_date`, `entered_state_at`, `source_idea_id`. Replace `job` with `area`.

- [ ] **Step 7: Commit**

```bash
git add src/services/taskService.js
git commit -m "feat: update taskService for state-based model, add batch sort order"
```

---

### Task 2.2: Create ideaService

**Files:**
- Create: `src/services/ideaService.js`

- [ ] **Step 1: Create ideaService.js**

Create `src/services/ideaService.js` following the same patterns as `taskService.js`:

```js
import { validateIdea } from '@/lib/validators';

const IDEA_UPDATE_FIELDS = new Set([
  'title', 'notes', 'area', 'idea_state',
  'why_it_matters', 'smallest_step', 'review_date', 'updated_at',
]);

export async function listIdeas({ supabase, userId, filters = {} }) {
  let query = supabase
    .from('ideas')
    .select('*')
    .eq('user_id', userId)
    .neq('idea_state', 'promoted')
    .order('created_at', { ascending: false });

  if (filters.idea_state) {
    query = query.eq('idea_state', filters.idea_state);
  }
  const { data, error } = await query;
  return { data, error };
}

export async function createIdea({ supabase, userId, payload }) {
  const { isValid, errors } = validateIdea(payload);
  if (!isValid) return { error: errors };

  const area = payload.area?.trim() || null;
  const { data, error } = await supabase
    .from('ideas')
    .insert({
      user_id: userId,
      title: payload.title.trim(),
      notes: payload.notes || null,
      area,
      idea_state: 'captured',
      why_it_matters: payload.why_it_matters || null,
      smallest_step: payload.smallest_step || null,
      review_date: payload.review_date || null,
    })
    .select()
    .single();
  return { data, error };
}

export async function updateIdea({ supabase, userId, ideaId, updates }) {
  // Verify ownership
  const { data: existing } = await supabase
    .from('ideas')
    .select('id, user_id')
    .eq('id', ideaId)
    .single();
  if (!existing || existing.user_id !== userId) {
    return { error: 'Not found or unauthorized' };
  }

  const filtered = {};
  for (const [key, val] of Object.entries(updates)) {
    if (IDEA_UPDATE_FIELDS.has(key)) filtered[key] = val;
  }
  filtered.updated_at = new Date().toISOString();
  if (filtered.area !== undefined) {
    filtered.area = filtered.area?.trim() || null;
  }

  const { data, error } = await supabase
    .from('ideas')
    .update(filtered)
    .eq('id', ideaId)
    .select()
    .single();
  return { data, error };
}

export async function deleteIdea({ supabase, userId, ideaId }) {
  const { data: existing } = await supabase
    .from('ideas')
    .select('id, user_id')
    .eq('id', ideaId)
    .single();
  if (!existing || existing.user_id !== userId) {
    return { error: 'Not found or unauthorized' };
  }
  const { error } = await supabase.from('ideas').delete().eq('id', ideaId);
  return { error };
}

export async function promoteIdea({ supabase, userId, ideaId }) {
  const { data: idea } = await supabase
    .from('ideas')
    .select('*')
    .eq('id', ideaId)
    .eq('user_id', userId)
    .single();
  if (!idea) return { error: 'Not found or unauthorized' };
  if (idea.idea_state === 'promoted') return { error: 'Already promoted' };

  // Create task in backlog
  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .insert({
      user_id: userId,
      name: idea.title,
      description: [idea.why_it_matters, idea.smallest_step, idea.notes]
        .filter(Boolean).join('\n\n'),
      state: 'backlog',
      area: idea.area,
      source_idea_id: idea.id,
      sort_order: 0, // will be at bottom
    })
    .select()
    .single();
  if (taskError) return { error: taskError };

  // Mark idea as promoted
  await supabase
    .from('ideas')
    .update({ idea_state: 'promoted', updated_at: new Date().toISOString() })
    .eq('id', ideaId);

  return { data: task };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/ideaService.js
git commit -m "feat: add ideaService with CRUD and promote-to-task"
```

---

### Task 2.3: Update apiClient

**Files:**
- Modify: `src/lib/apiClient.js`

- [ ] **Step 1: Update task methods**

In `src/lib/apiClient.js`:
- `getTasks`: Replace `includeCompleted` param with `state` filter. Update URL params.
- `createTask`: Remove `priority`, `is_completed`, `importance_score`, `urgency_score`, `job` from payload. Add `state`, `today_section`, `area`, `task_type`, `chips`.
- `updateTask`: Same field changes as createTask.
- Add `updateSortOrder(items)` method that POSTs to `/api/tasks/sort-order`.
- Add `getTasksByState(state)` convenience method.

- [ ] **Step 2: Add ideas methods**

Add to apiClient:
```js
getIdeas(filters = {}) — GET /api/ideas with query params
createIdea(data) — POST /api/ideas
updateIdea(id, updates) — PATCH /api/ideas/${id} with updates in body
deleteIdea(id) — DELETE /api/ideas/${id}
promoteIdea(id) — POST /api/ideas/${id}/promote
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/apiClient.js
git commit -m "feat: update apiClient for state-based tasks and ideas"
```

---

### Task 2.4: Update API routes — tasks

**Files:**
- Modify: `src/app/api/tasks/route.js`
- Create: `src/app/api/tasks/sort-order/route.js`

- [ ] **Step 1: Update GET handler**

Replace `includeCompleted` logic with state-based filtering:
- Accept `state` query param (filter by specific state)
- Accept `states` query param (comma-separated for Plan board: `today,this_week,backlog,waiting`)
- Accept `completedSince` param (ISO timestamp for "completed today" query)
- Remove `.eq('is_completed', false)` filter
- Update `.select()` to remove `priority`, `importance_score`, `urgency_score`, `is_completed`, add new fields
- Update project join from `job` to `area`
- Add `ORDER BY sort_order ASC, created_at ASC` (tiebreaker)

- [ ] **Step 2: Update POST handler**

Update `createTask` call to pass new fields.

- [ ] **Step 3: Update PATCH handler**

Update to pass new fields through to `updateTask`.

- [ ] **Step 4: Create sort-order batch endpoint**

Create `src/app/api/tasks/sort-order/route.js`:
```js
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth';
import { getDb } from '@/lib/supabaseClient';
import { updateSortOrder } from '@/services/taskService';

export async function POST(request) {
  const { userId } = await getAuthContext();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { items } = await request.json();
  const supabase = await getDb();
  const result = await updateSortOrder({ supabase, userId, items });
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/tasks/route.js src/app/api/tasks/sort-order/route.js
git commit -m "feat: update tasks API for state-based model, add sort-order endpoint"
```

---

### Task 2.5: Create API routes — ideas

**Files:**
- Create: `src/app/api/ideas/route.js` (GET list, POST create)
- Create: `src/app/api/ideas/[id]/route.js` (PATCH update, DELETE)
- Create: `src/app/api/ideas/[id]/promote/route.js` (POST promote)

- [ ] **Step 1: Create ideas list + create route**

Create `src/app/api/ideas/route.js` with:
- GET: list ideas (filter by idea_state query param), calls `ideaService.listIdeas`
- POST: create idea, calls `ideaService.createIdea`

Follow exact auth pattern from `src/app/api/tasks/route.js`.

- [ ] **Step 2: Create ideas [id] route**

Create `src/app/api/ideas/[id]/route.js` with:
- PATCH: update idea by ID from URL path, calls `ideaService.updateIdea`
- DELETE: delete idea by ID from URL path, calls `ideaService.deleteIdea`

- [ ] **Step 3: Create promote route**

Create `src/app/api/ideas/[id]/promote/route.js` with:
- POST: promote idea by ID from URL path, calls `ideaService.promoteIdea`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/ideas/
git commit -m "feat: add ideas API routes — RESTful [id] paths with promote endpoint"
```

---

### Task 2.6: Create areas endpoint and sort order utility

**Files:**
- Create: `src/app/api/areas/route.js`
- Create: `src/lib/sortOrder.js`
- Create: `src/lib/__tests__/sortOrder.test.js`

- [ ] **Step 1: Create areas API endpoint**

Create `src/app/api/areas/route.js`:
```js
// GET /api/areas — returns deduplicated area values (case-insensitive)
// Used by area dropdown in TaskCard quick actions
// Spec: SELECT DISTINCT ON (LOWER(area)) area FROM tasks WHERE area IS NOT NULL AND user_id = $1
//        UNION SELECT DISTINCT ON (LOWER(area)) area FROM projects WHERE area IS NOT NULL AND user_id = $1
```

Auth check via `getAuthContext()`. Returns `{ data: ['General Mills', 'AIStudio', ...] }`.

- [ ] **Step 2: Write sort order tests**

Create `src/lib/__tests__/sortOrder.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { computeSortOrder, needsReindex, reindex } from '../sortOrder';

describe('computeSortOrder', () => {
  it('inserts between two items at midpoint', () => {
    expect(computeSortOrder(1000, 3000)).toBe(2000);
  });
  it('inserts at top with -1000 offset', () => {
    expect(computeSortOrder(null, 1000)).toBe(0);
  });
  it('inserts at bottom with +1000 offset', () => {
    expect(computeSortOrder(5000, null)).toBe(6000);
  });
  it('inserts into empty list at 1000', () => {
    expect(computeSortOrder(null, null)).toBe(1000);
  });
});

describe('needsReindex', () => {
  it('returns true when gap is less than 1', () => {
    expect(needsReindex(1000, 1001)).toBe(true);
  });
  it('returns false when gap is sufficient', () => {
    expect(needsReindex(1000, 3000)).toBe(false);
  });
});

describe('reindex', () => {
  it('redistributes items with 1000 gaps', () => {
    const items = [{id: 'a'}, {id: 'b'}, {id: 'c'}];
    const result = reindex(items);
    expect(result).toEqual([
      {id: 'a', sort_order: 1000},
      {id: 'b', sort_order: 2000},
      {id: 'c', sort_order: 3000},
    ]);
  });
});
```

- [ ] **Step 3: Implement sort order utility**

Create `src/lib/sortOrder.js`:
- `computeSortOrder(above, below)` — gap-based midpoint, handles null (top/bottom/empty)
- `needsReindex(above, below)` — returns true if gap < 1
- `reindex(items)` — returns items array with redistributed sort_order values (gaps of 1000)

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/lib/__tests__/sortOrder.test.js
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/areas/ src/lib/sortOrder.js src/lib/__tests__/sortOrder.test.js
git commit -m "feat: add areas endpoint and sort order computation utility"
```

---

### Task 2.7: Update project API routes (was 2.6)

**Files:**
- Modify: `src/app/api/projects/route.js`
- Modify: `src/app/api/projects/[id]/route.js`

- [ ] **Step 1: Update PROJECT_UPDATE_FIELDS in both files**

Remove `'priority'` and `'job'`. Add `'area'`.

- [ ] **Step 2: Update select clauses and response transformations**

In both files, update any `.select()` calls to remove `priority` and replace `job` with `area`. Update response mapping from `job` to `area`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/projects/
git commit -m "fix: update project API routes — remove priority, rename job to area"
```

---

### Task 2.8: Update completed-items API route (was 2.7)

**Files:**
- Modify: `src/app/api/completed-items/route.js`

- [ ] **Step 1: Update query**

Replace `.eq('is_completed', true)` with `.eq('state', 'done')`. Update project join from `job` to `area`.

- [ ] **Step 2: Commit**

```bash
git add src/app/api/completed-items/route.js
git commit -m "fix: update completed-items API to use state='done'"
```

---

### Task 2.9: Update utility files (was 2.8)

**Files:**
- Modify: `src/lib/styleUtils.js`
- Modify: `src/lib/projectHelpers.js`
- Modify: `src/lib/taskSort.js`

- [ ] **Step 1: Update styleUtils.js**

Remove `getPriorityStyles()`, `getPriorityBadgeStyles()`, and all priority colour mapping. Add helpers for state/section badge styling if needed (or defer to component-level Tailwind classes).

- [ ] **Step 2: Update projectHelpers.js**

Remove all priority styling functions (the fire/warning/check icons, shadow glows, `getPriorityConfig`). Replace `job` references with `area`.

- [ ] **Step 3: Update taskSort.js**

Remove any priority references. Ensure sort includes tiebreaker: when comparing by sort_order, fall back to `created_at ASC`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/styleUtils.js src/lib/projectHelpers.js src/lib/taskSort.js
git commit -m "fix: remove priority from style utils, project helpers, and task sort"
```

---

## Phase 3: New Views

### Task 3.1: Install @dnd-kit and create shared layout

**Files:**
- Modify: `src/app/layout.js`
- Create: `src/components/layout/AppShell.jsx`
- Create: `src/components/layout/TabBar.jsx`

- [ ] **Step 1: Install @dnd-kit**

```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

- [ ] **Step 2: Remove TargetProjectProvider from layout.js**

Open `src/app/layout.js`. Remove the `TargetProjectProvider` import and the wrapping `<TargetProjectProvider>` component. Keep `NextAuthProvider` and `SupabaseProvider`.

- [ ] **Step 3: Create TabBar component**

Create `src/components/layout/TabBar.jsx`:
- Three tabs: Today, Plan, Ideas
- Uses `usePathname()` from `next/navigation` for active state
- Desktop: horizontal tabs at top of main content area
- Mobile: fixed bottom tab bar
- Links to `/today`, `/plan`, `/ideas`

- [ ] **Step 4: Create AppShell component**

Create `src/components/layout/AppShell.jsx`:
- Wraps children with `TabBar` and main content area
- Includes the QuickCapture floating input (implement in Task 3.2)

- [ ] **Step 5: Update layout.js to use AppShell**

Replace the removed `TargetProjectProvider` wrapper with `AppShell`.

- [ ] **Step 6: Commit**

```bash
git add src/app/layout.js src/components/layout/
git commit -m "feat: add TabBar navigation and AppShell layout"
```

---

### Task 3.2: Build QuickCapture component

**Files:**
- Create: `src/components/shared/QuickCapture.jsx`

- [ ] **Step 1: Create QuickCapture component**

Create `src/components/shared/QuickCapture.jsx`:
- Floating input fixed to bottom-right (above mobile tab bar)
- Enter = create task in Backlog via `apiClient.createTask({ name, state: 'backlog' })`
- Shift+Enter = create in Today > Good to Do via `apiClient.createTask({ name, state: 'today', today_section: 'good_to_do' })`
- `! ` (exclamation + space) prefix = create idea via `apiClient.createIdea({ title: name.slice(2) })`
- Sanitise input, max 255 chars
- Show toast on success ("Task captured" / "Idea captured")
- Clear input after creation

- [ ] **Step 2: Commit**

```bash
git add src/components/shared/QuickCapture.jsx
git commit -m "feat: add QuickCapture floating input component"
```

---

### Task 3.3: Build TaskCard component

**Files:**
- Create: `src/components/shared/TaskCard.jsx`
- Create: `src/components/shared/ChipBadge.jsx`

- [ ] **Step 1: Create ChipBadge component**

Create `src/components/shared/ChipBadge.jsx`:
- Renders a single chip as a small coloured pill
- Map chip values to colours: `high_impact` → red, `urgent` → orange, `blocks_others` → purple, `stress_relief` → teal, `only_i_can` → indigo

- [ ] **Step 2: Create TaskCard component**

Create `src/components/shared/TaskCard.jsx`:
- Compact card with: drag handle (left), task name, chip badges, area label, due date badge (using `getDueDateStatus()`), checkbox (right)
- `isStale` derived prop → subtle "stale" badge
- Quick action menu (three dots): Complete, Move to..., Set chips, Set due date, Set area, Set type
- `onClick` name → opens detail drawer (Task 3.8 below)
- `isStale` computation: derive on data arrival, not render. This Week: `entered_state_at` >14 days. Waiting with no follow-up: `entered_state_at` >7 days. Waiting with follow-up: `follow_up_date` < today. See spec "Staleness Detection" section.
- Uses `@dnd-kit/sortable` `useSortable` hook for drag behaviour
- Accepts `onComplete`, `onMove`, `onUpdate` callbacks

- [ ] **Step 3: Commit**

```bash
git add src/components/shared/TaskCard.jsx src/components/shared/ChipBadge.jsx
git commit -m "feat: add TaskCard and ChipBadge components"
```

---

### Task 3.4: Build Today Focus view

**Files:**
- Create: `src/app/today/page.js`
- Create: `src/components/today/TodayView.jsx`
- Create: `src/components/today/TodaySection.jsx`

- [ ] **Step 1: Create TodaySection component**

Create `src/components/today/TodaySection.jsx`:
- Renders a single section (Must Do / Good to Do / Quick Wins)
- Section header with name, count, and soft cap indicator (amber when over cap)
- `@dnd-kit/sortable` `SortableContext` for reordering within section
- Accepts tasks array, section key, softCap number

- [ ] **Step 2: Create TodayView component**

Create `src/components/today/TodayView.jsx`:
- `'use client'`
- Fetches tasks with `state = 'today'` and completed today
- Groups tasks by `today_section` using `TODAY_SECTION_ORDER`
- Renders three TodaySection components
- Collapsible "Completed today" section at bottom
- `DndContext` from @dnd-kit wrapping all sections for cross-section drag
- Handles `onDragEnd`: update task's `today_section` and `sort_order` via API
- Loading skeleton, error banner, empty state per spec
- First-run triage prompt (check localStorage, show once if overdue/due-this-week items exist in Backlog)
- Daily planning nudges (soft cap warnings, overdue follow-ups banner)

- [ ] **Step 3: Create page route**

Create `src/app/today/page.js`:
```js
import TodayView from '@/components/today/TodayView';
export default function TodayPage() {
  return <TodayView />;
}
```

- [ ] **Step 4: Verify the view renders**

Run `npm run dev`, navigate to `/today`. Should show loading state, then empty state if no tasks in today state.

- [ ] **Step 5: Commit**

```bash
git add src/app/today/ src/components/today/
git commit -m "feat: add Today Focus view with three sections and drag-and-drop"
```

---

### Task 3.5: Build Plan Board view

**Files:**
- Create: `src/app/plan/page.js`
- Create: `src/components/plan/PlanBoard.jsx`
- Create: `src/components/plan/BoardColumn.jsx`

- [ ] **Step 1: Create BoardColumn component**

Create `src/components/plan/BoardColumn.jsx`:
- Renders a single kanban column (Today, This Week, Backlog, Waiting)
- Column header with name and count
- `@dnd-kit` droppable area
- Today column: shows three sub-sections collapsed/expandable
- This Week: amber warning if >15 items
- Backlog: search bar + area/type filter dropdowns, pagination/virtual scroll
- Waiting: shows follow-up date and overdue/stale flags per card

- [ ] **Step 2: Create PlanBoard component**

Create `src/components/plan/PlanBoard.jsx`:
- `'use client'`
- Fetches all non-done tasks (separate calls per state for performance)
- 4-column horizontal layout (responsive: stack on mobile with swipeable tabs)
- `DndContext` wrapping all columns for cross-column drag
- Handles `onDragEnd`: update task's `state` (and `today_section` if target is Today column — default `good_to_do`)
- Drag to Waiting: show popover for reason + follow-up date after card moves
- Write queue with 300ms debounce for sort order mutations
- Loading/error/empty states

- [ ] **Step 3: Create page route**

Create `src/app/plan/page.js`:
```js
import PlanBoard from '@/components/plan/PlanBoard';
export default function PlanPage() {
  return <PlanBoard />;
}
```

- [ ] **Step 4: Verify the view renders**

Run dev server, navigate to `/plan`. Should show 4 columns with tasks distributed by state.

- [ ] **Step 5: Commit**

```bash
git add src/app/plan/ src/components/plan/
git commit -m "feat: add Plan Board view with kanban columns and cross-column drag"
```

---

### Task 3.6: Build Idea Vault view

**Files:**
- Create: `src/app/ideas/page.js`
- Create: `src/components/ideas/IdeaVault.jsx`
- Create: `src/components/ideas/IdeaCard.jsx`

- [ ] **Step 1: Create IdeaCard component**

Create `src/components/ideas/IdeaCard.jsx`:
- Compact card: title, area label, review date if set
- Exploring state: shows why_it_matters and smallest_step inline
- Action menu: Move to Exploring/Ready Later, Promote to Task, Delete
- Promote action calls `apiClient.promoteIdea(id)` and shows toast

- [ ] **Step 2: Create IdeaVault component**

Create `src/components/ideas/IdeaVault.jsx`:
- `'use client'`
- Fetches ideas via `apiClient.getIdeas()`
- Three sections using `IDEA_STATE_ORDER`: Captured, Exploring, Ready Later
- Inline capture at top (just a title input → creates in Captured)
- Moving to Exploring surfaces prompt fields (why_it_matters, area, smallest_step)
- Loading/error/empty states

- [ ] **Step 3: Create page route**

Create `src/app/ideas/page.js`:
```js
import IdeaVault from '@/components/ideas/IdeaVault';
export default function IdeasPage() {
  return <IdeaVault />;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/ideas/ src/components/ideas/
git commit -m "feat: add Idea Vault view with capture, explore, and promote"
```

---

### Task 3.7: Redirect dashboard and update completed-report

**Files:**
- Modify: `src/app/dashboard/page.js`
- Modify: `src/app/completed-report/` (page component)

- [ ] **Step 1: Replace dashboard with redirect**

Replace the entire content of `src/app/dashboard/page.js` with:
```js
import { redirect } from 'next/navigation';
export default function DashboardPage() {
  redirect('/today');
}
```

- [ ] **Step 2: Update completed-report**

Update the completed-report page component:
- Replace `is_completed` queries with `state = 'done'`
- Remove priority-based grouping, replace with area or today_section grouping
- Replace `job` with `area` in display

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/page.js src/app/completed-report/
git commit -m "feat: redirect dashboard to /today, update completed-report queries"
```

---

### Task 3.8: Build task detail drawer

**Files:**
- Create: `src/components/shared/TaskDetailDrawer.jsx`

- [ ] **Step 1: Create TaskDetailDrawer component**

Create `src/components/shared/TaskDetailDrawer.jsx`:
- Headless UI `Dialog` as a side panel (slides in from right)
- Shows and edits: name, description, area, task_type, chips, due_date, waiting_reason, follow_up_date, project association
- Saves on field blur via `apiClient.updateTask`
- Shows `source_idea_id` link if task was promoted from an idea
- Shows notes section (existing notes functionality, plus ability to add notes)
- Accessible: focus trap, close on Escape, proper ARIA labels

- [ ] **Step 2: Wire into TaskCard**

Update `TaskCard.jsx` to open `TaskDetailDrawer` when task name is clicked.

- [ ] **Step 3: Commit**

```bash
git add src/components/shared/TaskDetailDrawer.jsx src/components/shared/TaskCard.jsx
git commit -m "feat: add task detail drawer for viewing/editing task fields"
```

---

### Task 3.9: Accessibility for drag-and-drop

**Files:**
- Modify: `src/components/today/TodayView.jsx`
- Modify: `src/components/plan/PlanBoard.jsx`

- [ ] **Step 1: Add ARIA live regions**

In both TodayView and PlanBoard, add an `aria-live="polite"` region that announces drag outcomes:
- "Task moved to This Week"
- "Task moved to Must Do Today"
- "Task reordered"

- [ ] **Step 2: Verify keyboard navigation**

@dnd-kit provides keyboard support by default. Verify:
- Tab to drag handle, Space/Enter to pick up, Arrow keys to move, Space/Enter to drop
- Focus returns to moved card after drop

- [ ] **Step 3: Commit**

```bash
git add src/components/today/TodayView.jsx src/components/plan/PlanBoard.jsx
git commit -m "feat: add ARIA live regions for drag-and-drop announcements"
```

---

## Phase 4: Integration Updates

### Task 4.1: Update Office 365 sync service

**Files:**
- Modify: `src/services/office365SyncService.js`

- [ ] **Step 1: Update outbound sync**

- Replace `is_completed` checks with `state === 'done'`
- Update `buildTodoTaskPayload`: remove priority → importance mapping, use `importance: 'normal'`
- Replace `job` with `area` throughout

- [ ] **Step 2: Update inbound sync**

- In `normalizeLocalTask`: replace `task.priority` and `task.is_completed` with `task.state`
- In `tasksMatch`: compare using `state` instead of `is_completed` and `priority`
- Map Graph `status === 'completed'` → `state = 'done'`
- Map Graph `status !== 'completed'` → preserve existing `state`
- Stop writing `priority` on inbound

- [ ] **Step 3: Commit**

```bash
git add src/services/office365SyncService.js
git commit -m "fix: update Office 365 sync for state-based model (inbound + outbound)"
```

---

### Task 4.2: Update daily task email service

**Files:**
- Modify: `src/services/dailyTaskEmailService.js`
- Modify: `src/app/api/cron/daily-task-email/route.js`

- [ ] **Step 1: Update dailyTaskEmailService**

- Update `fetchOutstandingTasks` select clause: remove `priority`, add `state, today_section`
- Replace `.eq('is_completed', false)` with `.eq('state', 'today')`
- Update `formatTaskLineText` and `formatTaskLineHtml`: replace priority labels with today_section labels (Must Do / Good to Do / Quick Wins)
- Group tasks by today_section in email output
- Replace `job` with `area`

- [ ] **Step 2: Update cron route if needed**

Check `src/app/api/cron/daily-task-email/route.js` for any direct field references and update.

- [ ] **Step 3: Commit**

```bash
git add src/services/dailyTaskEmailService.js src/app/api/cron/daily-task-email/route.js
git commit -m "fix: update daily task email for state-based model"
```

---

### Task 4.3: Update remaining surviving files

**Files:**
- Modify: `src/components/Projects/ProjectItem.js`
- Modify: `src/components/Projects/ProjectHeader.jsx`
- Modify: `src/components/Projects/AddProjectForm.js`
- Modify: `src/components/dashboard/SidebarFilters.jsx`
- Modify: `src/components/Notes/ProjectNoteWorkspaceModal.js`
- Modify: `src/app/api/admin/migrate/route.js`

- [ ] **Step 1: Update ProjectItem.js**

Remove priority sidebar strip, shadow glow, QuickTaskForm import. Update `job` to `area`. Remove drag-to-project logic.

- [ ] **Step 2: Update ProjectHeader.jsx**

Remove priority display, update `job` to `area`.

- [ ] **Step 3: Update AddProjectForm.js**

Remove priority dropdown, update `job` to `area`.

- [ ] **Step 4: Update SidebarFilters.jsx**

Remove priority filter checkboxes. Keep project-health filters (rename section from "Priority Filters" to "Filters"). Rename job props/labels to area.

- [ ] **Step 5: Update ProjectNoteWorkspaceModal.js**

Remove `QuickTaskForm` and `TaskScoreBadge` imports. Replace with inline task creation or link to QuickCapture.

- [ ] **Step 6: Update admin migrate route**

Remove priority/is_completed references from migration indexes.

- [ ] **Step 7: Commit**

```bash
git add src/components/Projects/ src/components/dashboard/ src/components/Notes/ src/app/api/admin/
git commit -m "fix: update surviving components — remove priority, rename job to area"
```

---

## Phase 5: Legacy Cleanup

### Task 5.1: Delete legacy files

**Files:**
- Delete: `src/lib/taskScoring.js`
- Delete: `src/components/Tasks/TaskScoreBadge.jsx`
- Delete: `src/components/Tasks/ChaseTaskModal.js`
- Delete: `src/components/Tasks/StandaloneTaskList.js`
- Delete: `src/components/Tasks/QuickTaskForm.jsx`
- Delete: `src/components/Tasks/AddTaskForm.js`
- Delete: `src/components/Tasks/AddTaskModal.js`
- Delete: `src/components/Tasks/TaskList.js`
- Delete: `src/components/dashboard/TasksPanel.jsx`
- Delete: `src/contexts/TargetProjectContext.js`
- Delete: `src/components/Projects/ProjectList.js`
- Delete: `src/app/prioritise/` (entire directory)
- Delete: `src/app/capture/` (entire directory)
- Delete: `src/app/tasks/` (entire directory — the page, not the API)

- [ ] **Step 1: Delete all legacy files**

```bash
rm src/lib/taskScoring.js
rm src/components/Tasks/TaskScoreBadge.jsx
rm src/components/Tasks/ChaseTaskModal.js
rm src/components/Tasks/StandaloneTaskList.js
rm src/components/Tasks/QuickTaskForm.jsx
rm src/components/Tasks/AddTaskForm.js
rm src/components/Tasks/AddTaskModal.js
rm src/components/Tasks/TaskList.js
rm src/components/dashboard/TasksPanel.jsx
rm src/contexts/TargetProjectContext.js
rm src/components/Projects/ProjectList.js
rm -rf src/app/prioritise/
rm -rf src/app/capture/
rm -rf src/app/tasks/page.js
```

- [ ] **Step 2: Search for broken imports**

```bash
grep -r "taskScoring\|TaskScoreBadge\|ChaseTaskModal\|StandaloneTaskList\|QuickTaskForm\|AddTaskForm\|AddTaskModal\|TaskList\|TasksPanel\|TargetProjectContext\|ProjectList\|PRIORITY\|PRIORITY_VALUES\|importance_score\|urgency_score\|is_completed" src/ --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx" -l
```

Fix any remaining references.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: delete all legacy priority files and remove broken imports"
```

---

### Task 5.2: Build verification

- [ ] **Step 1: Run lint**

```bash
npm run lint
```
Fix any errors.

- [ ] **Step 2: Run type check (if applicable)**

```bash
npx tsc --noEmit 2>/dev/null || echo "No TypeScript config — skip"
```

- [ ] **Step 3: Run tests**

```bash
npm test
```
All tests must pass.

- [ ] **Step 4: Run build**

```bash
npm run build
```
Must complete with zero errors.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve lint and build errors from legacy cleanup"
```

---

### Task 5.3: Apply migration and deploy

Follow the deployment checklist from the spec:

- [ ] **Step 1: Pause cron jobs** — disable daily task email cron in Vercel dashboard
- [ ] **Step 2: Pause Office 365 sync** — disable the sync webhook/cron trigger
- [ ] **Step 3: Take database backup** — full backup via Supabase dashboard
- [ ] **Step 4: Run migration** — `npx supabase db push`
- [ ] **Step 5: Deploy app** — push to main or `vercel deploy --prod`
- [ ] **Step 6: Smoke test** — verify /today loads, drag-and-drop works, ideas create, /plan shows columns, completed-report works
- [ ] **Step 7: Re-enable cron** — daily task email
- [ ] **Step 8: Re-enable Office 365 sync**
- [ ] **Step 9: Final commit tag**

```bash
git tag v2.0.0-prioritisation-replacement
```
