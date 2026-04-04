# Prioritisation Replacement Design

**Date**: 2026-04-04
**Working title**: From capture to calm execution
**Approach**: Big bang replacement — remove all legacy priority mechanics, replace with section-based containment model
**QA Reviewed**: 2026-04-04 — 5-specialist review, all critical/high findings addressed
**User Review**: 2026-04-04 — 10 issues fixed, design refinements applied

---

## Problem Statement

The current app has two overlapping prioritisation systems (static High/Medium/Low enum and numeric importance/urgency scoring) that create cognitive overhead without helping the user distinguish what actually matters today. Too many things carry equal emotional weight, and there is no structural separation between "what exists", "what matters this week", "what matters today", "what is blocked", and "what is just an idea".

## Success Criteria

- User feels less overwhelmed by the same volume of tasks
- Today view is realistic and executable (not a flat, stressful pile)
- Ideas are captured without becoming obligations
- Blocked items stay visible without clogging active lists
- The app reduces stress instead of creating management burden
- All legacy priority code is removed — no dual systems

---

## Decisions Log

| Decision | Choice | Alternatives Considered |
|----------|--------|------------------------|
| Projects to Tasks | Optional association (project_id nullable) | Keep mandatory FK; Remove projects entirely |
| Priority system | Remove both old systems. Section placement + chips | Keep scoring hidden/automatic; Keep as-is alongside sections |
| Area + Type | Rename `job` to `area`, add separate `task_type` enum | Replace job with task types only; Merge into tags |
| Today sections | Fixed three: Must Do, Good to Do, Quick Wins | Two sections (Focus + Batch); Configurable names |
| Waiting follow-ups | Stay in Waiting, surface visual flag when overdue | Auto-promote to This Week; User chooses per task |
| Ideas | Fully separate entity with own table and lifecycle | Ideas as tasks with special state |
| Migration seeding | All active tasks start in Backlog | Map from existing due dates; Start in This Week |
| Layout model | Hybrid — Today Focus for execution, Board for planning | Pure kanban; Pure stacked lists |
| Migration strategy | Big bang replacement (user override of complexity rule — implementation plan will decompose into ordered PRs) | Incremental migration; Parallel app |

---

## Data Model

### Tasks Table (replacing current)

```sql
tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,  -- NOW NULLABLE, SET NULL on project delete
  name            text NOT NULL,
  description     text,
  state           text NOT NULL DEFAULT 'backlog'
                  CHECK (state IN ('today', 'this_week', 'backlog', 'waiting', 'done')),
  today_section   text
                  CHECK (today_section IN ('must_do', 'good_to_do', 'quick_wins')),
  sort_order      integer NOT NULL DEFAULT 0,
  area            text,
  task_type       text
                  CHECK (task_type IN ('admin', 'reply_chase', 'fix', 'planning',
                                       'content', 'deep_work', 'personal')),
  chips           text[],
  due_date        date,
  waiting_reason  text,
  follow_up_date  date,
  source_idea_id  UUID REFERENCES ideas(id),  -- back-reference when promoted from idea
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  entered_state_at timestamptz NOT NULL DEFAULT now()
);

-- Constraint: today_section required when state = 'today', null otherwise
ALTER TABLE tasks ADD CONSTRAINT check_today_section
  CHECK (
    (state = 'today' AND today_section IS NOT NULL) OR
    (state != 'today' AND today_section IS NULL)
  );

-- Cleanup trigger: handles side-effects of state changes.
-- Does NOT silently default today_section — a bad write should fail loudly.
-- The service layer is responsible for setting today_section explicitly when moving to today.
CREATE OR REPLACE FUNCTION fn_task_state_cleanup()
RETURNS TRIGGER AS $$
BEGIN
  -- Clear today_section when leaving today state
  IF NEW.state != 'today' AND NEW.today_section IS NOT NULL THEN
    NEW.today_section := NULL;
  END IF;
  -- Auto-set completed_at when moving to done
  IF NEW.state = 'done' AND (OLD IS NULL OR OLD.state != 'done') THEN
    NEW.completed_at := now();
  END IF;
  -- Auto-clear completed_at when moving out of done
  IF OLD IS NOT NULL AND NEW.state != 'done' AND OLD.state = 'done' THEN
    NEW.completed_at := NULL;
  END IF;
  -- Track state changes
  IF OLD IS NULL OR NEW.state != OLD.state THEN
    NEW.entered_state_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_task_state_cleanup
  BEFORE INSERT OR UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION fn_task_state_cleanup();
```

**Existing fields kept**: `description` (already exists on tasks, no migration needed)

**Removed fields**: `priority`, `importance_score`, `urgency_score`, `is_completed`, `job`

**Chip values**: `high_impact`, `urgent`, `blocks_others`, `stress_relief`, `only_i_can`

Chips are cross-cutting properties only — they do not duplicate what `today_section` (Quick Wins) or `task_type` (deep_work) already express.

**Chips validation**: Application-level allowlist check in taskService before write. Max 5 values (one of each type), no duplicates, values must be in `CHIP_VALUES` constant. No database CHECK constraint — keeps chips extensible without migrations.

### Ideas Table (new)

```sql
ideas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  title           text NOT NULL,
  notes           text,
  area            text,
  idea_state      text NOT NULL DEFAULT 'captured'
                  CHECK (idea_state IN ('captured', 'exploring', 'ready_later', 'promoted')),
  why_it_matters  text,
  smallest_step   text,
  review_date     date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
```

**No RLS on ideas.** The app authenticates via NextAuth, not Supabase Auth. `auth.uid()` in Postgres is tied to Supabase Auth sessions, which this app does not use — enabling RLS with `auth.uid()` policies would break reads/writes, not protect them. All data isolation is enforced in the service/API layer via `user_id` filtering from the NextAuth session. Every query must include `.eq('user_id', session.user.id)`. This matches the existing pattern on tasks, projects, and notes.

### Database Indexes

```sql
-- New indexes for state-based query patterns
CREATE INDEX idx_tasks_user_state_sort
  ON tasks (user_id, state, sort_order);

CREATE INDEX idx_tasks_user_today_section_sort
  ON tasks (user_id, today_section, sort_order)
  WHERE state = 'today';

CREATE INDEX idx_tasks_user_completed_at
  ON tasks (user_id, completed_at DESC)
  WHERE state = 'done';

CREATE INDEX idx_tasks_user_area
  ON tasks (user_id, area)
  WHERE area IS NOT NULL;

CREATE INDEX idx_tasks_user_followup
  ON tasks (user_id, follow_up_date)
  WHERE state = 'waiting' AND follow_up_date IS NOT NULL;

CREATE INDEX idx_ideas_user_state
  ON ideas (user_id, idea_state);

-- Drop legacy indexes (reference dropped columns)
DROP INDEX IF EXISTS idx_tasks_user_completed_due_priority;
DROP INDEX IF EXISTS idx_tasks_user_scores;
```

### Projects Table (modified)

- **Remove**: `priority` field
- **Rename**: `job` to `area`
- **Keep**: everything else (name, description, due_date, status, stakeholders, timestamps, completed_at)

### Notes Table (modified)

- **Add**: `idea_id` UUID FK (nullable)
- **Update constraint**: exactly one of (project_id, task_id, idea_id) is NOT NULL
- **Existing data**: Current notes already satisfy this (they have exactly one of project_id or task_id set). Migration adds the column and updates the constraint in one step:

```sql
ALTER TABLE notes ADD COLUMN idea_id UUID REFERENCES ideas(id);

-- PRE-MIGRATION MANUAL STEP (run before deploying):
-- Check for orphan notes and review them manually.
-- SELECT id, content, created_at, user_id FROM notes WHERE project_id IS NULL AND task_id IS NULL;
-- This is a single-user app — manual review is completely reasonable.
-- Decide per-note: assign to a project, or delete.
-- Only proceed with the constraint change once orphan count is zero.

ALTER TABLE notes DROP CONSTRAINT IF EXISTS check_note_parent;
ALTER TABLE notes ADD CONSTRAINT check_note_parent CHECK (
  (project_id IS NOT NULL)::int +
  (task_id IS NOT NULL)::int +
  (idea_id IS NOT NULL)::int = 1
);
```

**Notes on done tasks**: Notes remain attached to their task when it moves to done. They are visible when viewing the task via the "Show completed" toggle or the completed-report view. Notes are never auto-deleted or reassigned on task completion.

### Constants

```js
export const STATE = {
  TODAY: 'today',
  THIS_WEEK: 'this_week',
  BACKLOG: 'backlog',
  WAITING: 'waiting',
  DONE: 'done'
};

export const TODAY_SECTION = {
  MUST_DO: 'must_do',
  GOOD_TO_DO: 'good_to_do',
  QUICK_WINS: 'quick_wins'
};

// Explicit display ordering — do not rely on text sort (must_do, good_to_do, quick_wins
// do not sort alphabetically in the right order)
export const TODAY_SECTION_ORDER = ['must_do', 'good_to_do', 'quick_wins'];
export const IDEA_STATE_ORDER = ['captured', 'exploring', 'ready_later'];

export const TASK_TYPE = {
  ADMIN: 'admin',
  REPLY_CHASE: 'reply_chase',
  FIX: 'fix',
  PLANNING: 'planning',
  CONTENT: 'content',
  DEEP_WORK: 'deep_work',
  PERSONAL: 'personal'
};

// Chips are cross-cutting properties only. They do not duplicate what
// today_section or task_type already express:
//   - "quick win" is expressed by the Quick Wins today section
//   - "deep work" is expressed by the deep_work task type
// Chips answer: "what makes this task special across any section or type?"
export const CHIP_VALUES = {
  HIGH_IMPACT: 'high_impact',
  URGENT: 'urgent',
  BLOCKS_OTHERS: 'blocks_others',
  STRESS_RELIEF: 'stress_relief',
  ONLY_I_CAN: 'only_i_can'
};

export const IDEA_STATE = {
  CAPTURED: 'captured',
  EXPLORING: 'exploring',
  READY_LATER: 'ready_later',
  PROMOTED: 'promoted'
};

export const SOFT_CAPS = {
  MUST_DO: 5,
  GOOD_TO_DO: 5,
  QUICK_WINS: 8,
  THIS_WEEK: 15
};
```

---

## Views & Navigation

### Authentication

All new routes (`/today`, `/plan`, `/ideas`) require active NextAuth sessions. The existing middleware matcher covers these by default. New API routes for ideas must include `getAuthContext()` session checks identical to the existing `/api/tasks/route.js` pattern.

### Tab Bar

Three primary tabs (top on desktop, bottom on mobile):

| Tab | Purpose | Default |
|-----|---------|---------|
| **Today** | Daily execution view | Default landing page |
| **Plan** | Board view for weekly planning/triage | |
| **Ideas** | Idea Vault — separate from tasks | |

### View States

Every view must handle all three states per ui-patterns.md:

| View | Loading | Error | Empty |
|------|---------|-------|-------|
| **Today** | Skeleton cards in three sections | Error banner with retry | "No tasks for today yet. Pull from This Week?" with link to Plan |
| **Plan** | Skeleton columns | Error banner with retry | "Capture your first task" with inline input |
| **Ideas** | Skeleton cards | Error banner with retry | "Got an idea? Capture it here" with inline input |

### Today Focus View

Stacked vertical layout with three fixed sections:

```
+-----------------------------+
| MUST DO TODAY        (2/5)  |  <- soft cap indicator
| [task cards, draggable]     |
+-----------------------------+
| GOOD TO DO TODAY     (3/5)  |
| [task cards, draggable]     |
+-----------------------------+
| QUICK WINS           (4/8)  |
| [task cards, draggable]     |
+-----------------------------+
| Completed today        (3)  |  <- collapsible
+-----------------------------+
```

- Drag-and-drop to reorder within sections and move between sections
- Soft cap warnings: section header turns amber when count exceeds cap (5/5/8)
- Completing a task moves it to "Completed today" at the bottom
- Quick actions per card: complete, move to This Week, move to Waiting

**Data fetching**: Two queries:
1. `WHERE user_id = $1 AND state = 'today' ORDER BY today_section, sort_order` — populates three active sections
2. `WHERE user_id = $1 AND state = 'done' AND completed_at >= $start_of_today_london ORDER BY completed_at DESC` — populates Completed today section

The `$start_of_today_london` boundary must be computed server-side using `date-fns-tz` with `timeZone: 'Europe/London'` to handle BST/GMT transitions correctly. Add a `getStartOfTodayLondon()` utility to `dateUtils.js`.

### Plan Board View

Horizontal kanban columns:

```
+----------+----------+----------+----------+
| TODAY    |THIS WEEK | BACKLOG  | WAITING  |
|  (9)    |  (12)    |  (24)    |  (5)     |
| [cards]  | [cards]  | [cards]  | [cards]  |
|          |          | + Add    |          |
+----------+----------+----------+----------+
```

- Drag between columns to change state
- Today column shows three sections collapsed (expandable)
- This Week shows amber warning if >15 items
- Backlog is searchable/filterable by area and task_type
- Waiting items show follow-up date and flag if overdue
- Quick capture button on Backlog column

**Data fetching**: Load Today and This Week eagerly (bounded by soft caps). Load Backlog and Waiting with pagination/virtual scrolling (these can be large). Separate API calls per state so the default Today view loads fast.

### Mobile Plan View

Board becomes swipeable tabs (Today | This Week | Backlog | Waiting). Drag-and-drop replaced with quick action buttons per card.

### Idea Vault View

Three sections matching idea states:

```
+-----------------------------+
| CAPTURED              (6)   |
| [idea cards - title only]   |
+-----------------------------+
| EXPLORING             (2)   |
| [idea cards - with prompts] |
+-----------------------------+
| READY LATER           (3)   |
| [idea cards - with review]  |
+-----------------------------+
```

- Capture is lightweight: just a title into "Captured"
- Moving to "Exploring" surfaces prompts (why it matters, area, smallest step)
- "Promote to task" creates a task in Backlog with `source_idea_id` set, and sets the idea's `idea_state = 'promoted'` (idea retained for history, hidden from active views). Navigation from idea → task is derived by querying `tasks WHERE source_idea_id = idea.id`. One canonical link, no synchronisation drift.
- Ideas never appear in Today/Plan views

### Component Architecture

Given the project's existing pattern of heavy client-side data fetching (`'use client'` components with direct Supabase queries), the new views follow the same pattern:
- Page-level components (`/today/page.js`, `/plan/page.js`, `/ideas/page.js`) are client components
- The layout shell and tab navigation can be a server component that wraps client children
- All data fetching happens via API routes called from client components

---

## Task Card Design

Compact card showing:
- Task name (primary text)
- Chips as small coloured pills (e.g. "High impact", "Quick win")
- Area as subtle text label if set
- Due date badge using `getDueDateStatus()` from `dateUtils.js` (red = overdue/today, amber = tomorrow, blue = this week, grey = future)
- Drag handle on left
- Checkbox on right (complete)

No priority colour borders. Visual hierarchy comes from which section the card is in.

Task `description` is not shown on the card — it is viewable and editable in the item detail drawer (side panel opened by clicking the task name). This keeps cards compact.

---

## Interactions

### Drag and Drop

| Action | Gesture |
|--------|---------|
| Reorder within section | Drag vertically |
| Move between Today sections | Drag between Must Do / Good to Do / Quick Wins |
| Promote to Today | Drag from This Week/Backlog to Today (defaults to Good to Do) |
| Demote from Today | Drag to This Week or Backlog |
| Send to Waiting | Drag to Waiting — card moves optimistically, then popover appears anchored to card asking for reason and follow-up date. If dismissed, task stays in Waiting with null fields |
| Move within Plan board | Drag between any columns |

Optimistic UI — card moves instantly, database write in background. On write failure, revert optimistic state and show error toast.

### Drag-and-Drop Library

Use **@dnd-kit/core** + **@dnd-kit/sortable**. The current native HTML drag-and-drop is insufficient for multi-container sortable lists with sort order persistence. @dnd-kit provides:
- Multi-container sortable (items between Today sections and Board columns)
- Touch support for mobile
- Keyboard accessibility (arrow keys to move between items/containers, Enter to confirm)
- Collision detection strategies for kanban
- Active development and React 19 compatible

**Accessibility**: @dnd-kit provides keyboard navigation out of the box. Additionally:
- ARIA live regions announce state changes ("Task moved to This Week")
- Focus returns to the moved card after drag completes
- Mobile swipe gestures have equivalent button alternatives

### Sort Order Mechanics

**Algorithm**: Gap-based integers with lazy reindex.

- When inserting at position between two items: `sort_order = floor((above + below) / 2)`
- When inserting at top: `sort_order = first_item.sort_order - 1000`
- When inserting at bottom: `sort_order = last_item.sort_order + 1000`
- Initial gap: 1000 between items
- **Tiebreaker**: `ORDER BY sort_order ASC, created_at ASC` — prevents undefined ordering when two tasks have the same sort_order
- **Lazy reindex**: When a gap becomes < 1 (after many insertions between the same two items), reindex all items in that state+section with gaps of 1000. Use the batch `updateSortOrder` endpoint (see Service Layer section).
- When a task moves between sections/states: it gets `sort_order = max(sort_order in target) + 1000` (appended to bottom of target, except drag to Today defaults to Good to Do section bottom)
- **Sort order is server-computed**: The client sends a "position" (before/after a sibling task ID), and the service layer computes the `sort_order` value. The client never sends raw `sort_order` integers.

**Write queue for rapid drags**: Sort-order mutations are enqueued client-side and processed sequentially with 300ms debounce. If the user drags multiple items quickly, only the final state of each item is persisted. Prevents optimistic UI divergence.

### Quick Actions (per card, via action menu or swipe)

| Action | Effect |
|--------|--------|
| Complete | state = 'done', completed_at set (via trigger) |
| Move to... | Quick picker: Today (which section?) / This Week / Backlog / Waiting |
| Set chips | Toggle chips on/off (pill-style multi-select) |
| Set due date | Inline picker with quick picks (Tomorrow, Friday, Next Monday) |
| Set area | Dropdown of existing areas + free text |
| Set type | Dropdown of task types |

### Quick Capture

Available from every view via persistent floating input:
- Enter = create in Backlog
- Shift+Enter = create in Today > Good to Do
- `! ` (exclamation + space) prefix = create as Idea in vault. Bare `!` without a following space is treated as a normal task character.
- The `! ` prefix is stripped from the idea title before storage
- Minimal fields on capture: just the name
- All input sanitised via `sanitizeInput()` before write. Max 255 characters.

### Waiting Mechanics

When moving to Waiting (via drag popover or quick action):
- Inline prompt: "Who/what are you waiting on?" (optional free text)
- "Follow-up date?" with quick picks: +3 days, +1 week, +2 weeks. Fully optional — no default applied if skipped.
- Card shows reason and follow-up date (if set)
- Overdue follow-ups get amber visual flag
- **Waiting items with no follow-up date**: flagged as stale after 7 days in Waiting (uses `entered_state_at`). This prevents tasks from rotting silently.

### Completion Behaviour

- Complete in Today → moves to "Completed today" section
- Complete elsewhere → state = 'done'
- Completed tasks hidden from Plan board (viewable via toggle)

### "Completed Today" Day Boundary

The "Completed today" section filters by `completed_at >= start of today (Europe/London)`. Computed server-side using `getStartOfTodayLondon()` (new utility in `dateUtils.js` using `date-fns-tz`). When the user opens the app the next morning, yesterday's completions are no longer shown — they are in the `done` state and visible only via the "Show completed" toggle in the Plan board. No manual reset needed.

### Staleness Detection

**"Stale" means "has been in this state too long."** Computed once on data arrival (not on every render), stored as a derived `isStale` boolean on the client-side task object:
- This Week items with `entered_state_at` >14 days ago → subtle "stale" badge
- Backlog items never flagged as stale
- Waiting items with overdue `follow_up_date` → amber flag
- Waiting items with no `follow_up_date` and `entered_state_at` >7 days ago → amber flag

---

## Planning Rituals & Soft Caps

### Daily Planning Nudges

| Condition | Prompt |
|-----------|--------|
| Today is empty | "No tasks for today yet. Pull from This Week?" |
| Must Do > 5 items | Amber header warning |
| Good to Do > 5 items | Amber header warning |
| Quick Wins > 8 items | Amber header warning |
| Overdue follow-ups in Waiting | Banner: "N items need follow-up" |

Visual nudges only. Never blocking, never modal, never punishing. Dismissable via localStorage with daily TTL (reset each morning).

### First-Run Triage (post-migration only)

After migration, all active tasks land in Backlog. On first load, show a one-off prompt:

> "You have X overdue items and Y due this week in Backlog. Review now?"

Links to the Plan board filtered to overdue/this-week items. Dismissed via localStorage (shown once, never again). This prevents genuinely urgent work from being buried in the initial Backlog dump.

### Weekly Planning Support

- This Week amber warning at >15 items
- Stale badges on items untouched 14+ days
- Backlog searchable/filterable for scanning
- Waiting shows overdue follow-ups prominently

### What the App Does NOT Do

- No forced review screens
- No streak tracking or gamification
- No push notifications (future opt-in consideration)
- No shame for Backlog items
- No automatic prioritisation or AI suggestions (future consideration)
- No "you didn't finish today" messaging

---

## Ideas Service Layer

### API Routes

Create `src/app/api/ideas/route.js` following the exact same auth pattern as `/api/tasks/route.js`:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/ideas` | List user's ideas (filter by idea_state, exclude 'promoted') |
| POST | `/api/ideas` | Create idea (title required, everything else optional) |
| PATCH | `/api/ideas/[id]` | Update idea fields |
| DELETE | `/api/ideas/[id]` | Delete idea |
| POST | `/api/ideas/[id]/promote` | Promote idea to task |

### Service Functions

Create `src/services/ideaService.js`:

- `listIdeas(userId, filters)` — query with `.eq('user_id', userId)`, exclude promoted
- `createIdea(userId, data)` — validate, set user_id from session (never from request body)
- `updateIdea(userId, id, data)` — verify ownership, validate, update
- `deleteIdea(userId, id)` — verify ownership, delete
- `promoteIdea(userId, id)` — verify ownership, create task in Backlog with `source_idea_id` pointing back to the idea, set idea `idea_state = 'promoted'`, return created task. Navigation from idea → task is derived by querying `tasks WHERE source_idea_id = idea.id` — one canonical link, no dual FKs.

### Validation

`validateIdea()` in `validators.js`:
- `title`: required, 1-255 characters, sanitised
- `idea_state`: must be in IDEA_STATE values
- `area`: optional, max 100 characters, trimmed, sanitised
- `why_it_matters`: optional, max 1000 characters
- `smallest_step`: optional, max 1000 characters
- `notes`: optional, max 1000 characters

---

## Server-Side Validation

All state transitions and field updates are validated in the service layer before database write:

### State Transition Rules

| From | Allowed To | Notes |
|------|-----------|-------|
| backlog | today, this_week, waiting, done | Service layer MUST set today_section explicitly when moving to today (trigger does NOT default it — constraint will reject the write if missing) |
| this_week | today, backlog, waiting, done | Same: today_section required when target is today |
| today | this_week, backlog, waiting, done | Trigger auto-nulls today_section when leaving today |
| waiting | today, this_week, backlog, done | Same: today_section required when target is today |
| done | today, this_week, backlog | Trigger auto-clears completed_at. Today requires today_section |

### Field Validation (taskService)

| Field | Rules |
|-------|-------|
| state | Must be in STATE values |
| today_section | Must be in TODAY_SECTION values. Required when state = 'today' — service layer must set explicitly (trigger does NOT auto-default, constraint rejects if missing). Defaults to 'good_to_do' when user drags into Today without choosing a section — but this default lives in the service layer, not the database. |
| chips | Array, max 5 items, each must be in CHIP_VALUES, no duplicates |
| area | Optional, max 100 chars, trimmed (case preserved), empty string → null |
| task_type | Optional, must be in TASK_TYPE values |
| waiting_reason | Optional, max 500 chars, sanitised |
| follow_up_date | Optional, any valid date (past dates allowed — overdue is a feature, not invalid data) |
| sort_order | Not accepted from client — computed server-side from position |
| user_id | Never accepted from client — always set from session |

### Batch Sort Order Endpoint

Create a dedicated `updateSortOrder` function in `taskService.js`:
- Accepts array of `{id, sort_order}` (max 50 items)
- Single batch UPDATE (not N individual updates)
- Skips validation, project lookup, and Office 365 sync (positional-only change)
- Verifies ownership of all task IDs in batch before executing
- Used by drag-and-drop reorder and lazy reindex operations

---

## Routing & Existing Pages

The new navigation model replaces the current page structure:

| Current Route | Fate | New Route |
|---------------|------|-----------|
| `/dashboard` | **Replaced** — redirect to `/today` (entire file replaced with redirect, not modified) | `/today` |
| `/login` | **Kept** — unchanged | `/login` |
| `/completed-report` | **Kept** — update queries to use `state = 'done'` instead of `is_completed`, replace priority grouping with area or today_section | `/completed-report` |
| `/prioritise` | **Removed entirely** — scoring system gone | N/A |
| `/capture` | **Removed** — replaced by Quick Capture floating input on all views | N/A |
| `/tasks` | **Removed** — replaced by Plan board view | N/A |

**New routes:**

| Route | View |
|-------|------|
| `/today` | Today Focus view (default landing) |
| `/plan` | Plan Board view (kanban) |
| `/ideas` | Idea Vault view |

### Project Association & "Unassigned" Project

Making `project_id` nullable means tasks can exist without a project. The existing `ensureUnassignedProject` and `isUnassignedProject` functions in `taskService.js` are **removed**. Tasks without a project simply have `project_id = null`. Existing tasks in the "Unassigned" project get `project_id` set to null during migration.

**Ownership validation when project_id is null**: Skip the project ownership check, but ensure `user_id` is set from the session (never from the request body). When `project_id` is non-null, the existing project ownership check is preserved.

### Area Field Behaviour

`area` is free text, max 100 characters, with no database constraint. Values are **trimmed on write** but **case is preserved** — "General Mills", "AIStudio", "Old El Paso" display as the user typed them. Empty strings normalised to null.

**Deduplication**: The dropdown compares case-insensitively when suggesting matches. The query uses `SELECT DISTINCT ON (LOWER(area)) area FROM tasks WHERE area IS NOT NULL AND user_id = $1 UNION SELECT DISTINCT ON (LOWER(area)) area FROM projects WHERE area IS NOT NULL AND user_id = $1`. This keeps one display value per case-insensitive group (the first one inserted wins). Cached client-side at view load time with 60-second TTL — not re-fetched on every dropdown open.

---

## External Services Impact

### Office 365 Sync Service

`src/services/office365SyncService.js` currently maps `priority` to Microsoft Graph's `importance` field and uses `is_completed` to set Graph task status. The sync has both outbound (local → Graph) and inbound (Graph → local) paths.

**Outbound changes:**
- Replace `is_completed` check with `state === 'done'`
- Remove `priority` → Graph `importance` mapping (Graph tasks use `importance: 'normal'` as default)
- Update `buildTodoTaskPayload` function to use `state` instead of `is_completed`
- Update any `job` references to `area`

**Inbound changes:**
- In `normalizeLocalTask`: replace `task.priority` and `task.is_completed` with `task.state`
- In `tasksMatch`: update comparison to use `state` instead of `is_completed` and `priority`
- Inbound sync: map Graph `status === 'completed'` to `state = 'done'` + set `completed_at`
- Inbound sync: map Graph `status !== 'completed'` → preserve existing `state` (do not reset it)
- Stop writing `priority` on inbound sync entirely

### Daily Task Email Service

`src/services/dailyTaskEmailService.js` currently queries by `priority` and filters `is_completed = false`.

**Changes required:**
- Update `fetchOutstandingTasks` select clause: remove `priority` from select, add `state, today_section`
- Replace `.eq('is_completed', false)` with `.eq('state', 'today')`
- Replace priority formatting in `formatTaskLineText` and `formatTaskLineHtml` with today_section labels (Must Do / Good to Do / Quick Wins)
- Group tasks by today_section in the email template
- Update any `job` references to `area`

### Daily Task Email Cron Route

`src/app/api/cron/daily-task-email/route.js` — update to match new service query shape.

---

## Removals

### Database Fields Removed

| Table | Field | Reason |
|-------|-------|--------|
| tasks | priority | Replaced by section placement + chips |
| tasks | importance_score | Scoring system removed |
| tasks | urgency_score | Scoring system removed |
| tasks | is_completed | Replaced by state = 'done' |
| projects | priority | No longer needed |

### Database Fields Renamed

| Table | Old | New |
|-------|-----|-----|
| tasks | job | area |
| projects | job | area |

### Files Removed Entirely

| File | Reason |
|------|--------|
| src/lib/taskScoring.js | Scoring system gone |
| src/components/Tasks/TaskScoreBadge.jsx | No more computed priority |
| src/components/Tasks/ChaseTaskModal.js | Chase feature retired (replaced by Waiting + follow-up) |
| src/components/Tasks/StandaloneTaskList.js | Dashboard task panel — replaced by Today/Plan views |
| src/components/Tasks/QuickTaskForm.jsx | Priority-based quick form — replaced by new Quick Capture |
| src/components/Tasks/AddTaskForm.js | Priority dropdown form — replaced by new task creation flow |
| src/components/Tasks/AddTaskModal.js | Wraps AddTaskForm — removed with it |
| src/components/dashboard/TasksPanel.jsx | Dashboard tasks panel — replaced by Today view |
| src/components/Tasks/TaskList.js | Uses is_completed for sorting/filtering — replaced by new views |
| src/contexts/TargetProjectContext.js | Project selection context — remove (projects no longer primary navigation organiser) |
| src/components/Projects/ProjectList.js | Priority-ordered project list — replaced by Plan board |
| src/app/prioritise/page.js | Scoring matrix page — entire feature removed |
| src/app/capture/page.js | Replaced by Quick Capture floating input |
| src/app/tasks/page.js | Replaced by Plan board view |

### Code Modified in Surviving Files

| File | What Changes |
|------|-------------|
| src/lib/constants.js | Remove PRIORITY, PRIORITY_VALUES. Add STATE, TODAY_SECTION, TASK_TYPE, CHIP_VALUES, IDEA_STATE, SOFT_CAPS constants |
| src/lib/styleUtils.js | Remove getPriorityStyles(), getPriorityBadgeStyles(). Add state/section styling helpers |
| src/lib/projectHelpers.js | Remove priority styling functions, shadow glows. Update any `job` references to `area` |
| src/lib/validators.js | Remove `priority` validation from `validateProject`. Remove `importance_score`, `urgency_score` validation from `validateTask`. **Remove mandatory `project_id` check** from `validateTask` (now nullable). Add `state`, `today_section`, `task_type`, `chips` validation to `validateTask`. Add `validateIdea` function. Update `validateNote` to accept `idea_id` as valid parent |
| src/lib/dateUtils.js | Add `getStartOfTodayLondon()` utility using `date-fns-tz` for timezone-aware day boundary |
| src/lib/apiClient.js | Update all task CRUD methods: stop sending `priority`, `importance_score`, `urgency_score`, `is_completed`, `job`. Start sending `state`, `today_section`, `sort_order`, `chips`, `area`, `task_type`, `waiting_reason`, `follow_up_date`. Update response parsing for new fields. Add ideas CRUD methods. Add batch sort order method |
| src/components/Tasks/TaskItem.js | Remove getTaskPriorityClasses(), priority rendering, ChaseTaskModal import. Rebuild as new TaskCard component |
| src/components/Projects/ProjectItem.js | Remove priority sidebar strip, shadow glow, QuickTaskForm import. Update `job` to `area`. Remove drag-to-project logic (replaced by drag-to-state) |
| src/components/dashboard/SidebarFilters.jsx | Remove priority filter checkboxes (keep project-health filters like overdue, noTasks, untouched, noDueDate — rename section from "Priority Filters"). Rename `uniqueJobs`/`selectedJob`/`onJobChange` props to `uniqueAreas`/`selectedArea`/`onAreaChange`. Rename "Jobs" section label to "Areas" |
| src/services/taskService.js | Replace `TASK_UPDATE_FIELDS` whitelist with new field set. Remove `ensureUnassignedProject`, `isUnassignedProject`. Update all queries: remove priority/importance_score/urgency_score/is_completed fields, add state/today_section/sort_order/chips fields, rename job to area. Add `updateSortOrder` batch function. Update ownership validation for nullable project_id |
| src/services/office365SyncService.js | Update outbound AND inbound sync: replace is_completed with state check, remove priority mapping, update normalizeLocalTask/tasksMatch/buildTodoTaskPayload, rename job to area |
| src/services/dailyTaskEmailService.js | Update fetchOutstandingTasks select clause (remove priority, add state/today_section). Filter by state='today'. Replace priority formatting with today_section labels. Rename job to area |
| src/app/layout.js | Remove `TargetProjectProvider` import and wrapper |
| src/app/api/tasks/route.js | Update query fields, replace `is_completed` filter with state filter, update project join from `job` to `area`, update `TASK_UPDATE_FIELDS` if duplicated here |
| src/app/api/projects/route.js | Remove priority from `PROJECT_UPDATE_FIELDS` whitelist, rename job to area, update select clauses and response transformations |
| src/app/api/projects/[id]/route.js | Same as above — remove priority, rename job to area in whitelist, select, and response |
| src/app/api/completed-items/route.js | Replace `is_completed=true` filter with `state='done'`. Update project join from `job` to `area` |
| src/app/dashboard/page.js | Replace entire file with redirect to `/today` |
| src/app/completed-report/ | Update queries to use `state = 'done'`. Remove priority-based grouping, replace with area or today_section grouping |
| src/components/Projects/ProjectHeader.jsx | Remove priority display, update job to area |
| src/components/Projects/AddProjectForm.js | Remove priority dropdown, update job to area |
| src/components/Notes/ProjectNoteWorkspaceModal.js | Remove QuickTaskForm and TaskScoreBadge imports, replace with new Quick Capture or inline task creation |
| src/app/api/admin/migrate/route.js | Remove priority AND is_completed references from migration indexes, add new state-based indexes |
| src/app/api/cron/daily-task-email/route.js | Update to match new dailyTaskEmailService query shape |
| src/lib/taskSort.js | Keep — due date sort logic still useful in new views. Remove any priority references if present. Add sort_order tiebreaker: `ORDER BY sort_order ASC, created_at ASC` |

### Features Retired

| Feature | Replacement |
|---------|-------------|
| Chase button | Move to Waiting + follow-up date |
| Priority dropdown on forms | Chips + section placement |
| Priority colour-coded borders | Section hierarchy |
| Importance/urgency score inputs | Chips |
| Computed priority label | Gone |

### What Survives Unchanged

- Due date colour coding (red/amber/blue/grey) via `getDueDateStatus()`
- Quick date picker options
- Notes system (extended with idea_id FK)
- Project statuses (Open, In Progress, On Hold, Completed, Cancelled)
- Stakeholder tracking and filtering
- Authentication (NextAuth)
- Supabase client patterns

---

## Migration

### Transaction-Wrapped Migration

The entire migration runs inside a single `BEGIN...COMMIT` transaction. If any step fails, the entire migration rolls back and no data is lost.

```sql
BEGIN;
```

**Step 1 — Structural changes (no constraints yet, to allow seeding):**
- Create ideas table (without CHECK constraints)
- Add new columns to tasks: state (no CHECK yet), today_section (no CHECK yet), sort_order, area, task_type, chips, waiting_reason, follow_up_date, entered_state_at, source_idea_id
- `ALTER TABLE tasks ALTER COLUMN project_id DROP NOT NULL`
- Drop and recreate project_id FK with `ON DELETE SET NULL`: `ALTER TABLE tasks DROP CONSTRAINT tasks_project_id_fkey; ALTER TABLE tasks ADD CONSTRAINT tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;`
- Add idea_id FK to notes
- Add area column to projects
- Drop CHECK constraints on priority: `ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_priority_check; ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_priority_check;`

**Step 2 — Seed existing data:**
- Active tasks (`is_completed = false`): `state = 'backlog'`
- Completed tasks (`is_completed = true`): `state = 'done'`, `completed_at` preserved
- Copy `job` values to `area` on tasks and projects
- Seed `sort_order` with incremental values: `UPDATE tasks SET sort_order = sub.rn * 1000 FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at ASC) AS rn FROM tasks) sub WHERE tasks.id = sub.id`
- Set `entered_state_at = COALESCE(updated_at, created_at)` on all tasks (preserves history — "how long has this been sitting here?" rather than resetting the clock)
- Null out `project_id` on tasks belonging to "Unassigned" projects

**Step 2a — Verify seeding:**
```sql
-- These must all return 0
SELECT count(*) FROM tasks WHERE state IS NULL;
SELECT count(*) FROM tasks WHERE sort_order IS NULL;
```

**Step 3 — Handle orphan notes:**
- Reassign orphan notes to user's oldest project
- Delete remaining unassignable orphans (users with no projects)
- Update notes constraint

**Step 4 — Audit and update functions/triggers:**
- Find all PL/pgSQL functions referencing priority, importance_score, urgency_score, is_completed, job
- Update or drop each in the same migration

**Step 5 — Drop old columns:**
- Tasks: drop priority, importance_score, urgency_score, is_completed, job
- Projects: drop priority, job

**Step 6 — Add constraints and indexes:**
- Add all CHECK constraints on state, today_section, task_type, idea_state
- Add `check_today_section` constraint
- Add cleanup trigger `fn_task_state_cleanup`
- Create all 6 new indexes
- Drop 2 legacy indexes

```sql
COMMIT;
```

### Deployment Checklist

Because this is a big-bang replacement, cron jobs and external sync must be paused during deployment to prevent them hitting half-migrated schema or half-deployed code:

1. **Pause cron jobs** — disable daily task email cron in Vercel dashboard
2. **Pause Office 365 sync** — disable the sync webhook/cron trigger
3. **Take database backup** — full backup via Supabase dashboard
4. **Manually review orphan notes** — run the audit query, resolve before migration
5. **Run migration** — `npx supabase db push` (test with `--dry-run` first)
6. **Deploy app** — `vercel deploy --prod` (new code that expects new schema)
7. **Smoke test** — verify /today loads, drag-and-drop works, ideas create
8. **Re-enable cron** — daily task email
9. **Re-enable Office 365 sync**

### Rollback Strategy

- Full database backup via Supabase dashboard before migration
- Test with `npx supabase db push --dry-run`
- Transaction wrapping means partial failure = full rollback, no inconsistent state
- If migration succeeds but new code has issues: old columns are gone, so rollback requires restoring from backup. This is acceptable for a single-user app.

---

## Testing Considerations

The project currently has no test suite (noted as tech debt). This refactor is an opportunity to add Vitest. Priority test targets:

1. **Sort order algorithm** — gap-based insertion, lazy reindex, tiebreaker ordering
2. **State transition validation** — all valid/invalid transitions, today_section auto-healing
3. **Chips validation** — allowlist check, dedup, max length
4. **Promote idea to task** — bidirectional link, state changes on both entities
5. **Area handling** — trim, case-insensitive dedup in dropdown, empty string → null
6. **`getStartOfTodayLondon()`** — BST/GMT boundary, DST transitions

Adding Vitest setup and these critical tests should be part of the implementation plan.
