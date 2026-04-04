# Prioritisation Replacement Design

**Date**: 2026-04-04
**Working title**: From capture to calm execution
**Approach**: Big bang replacement — remove all legacy priority mechanics, replace with section-based containment model

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
| Migration strategy | Big bang replacement | Incremental migration; Parallel app |

---

## Data Model

### Tasks Table (replacing current)

```sql
tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  project_id      UUID REFERENCES projects(id),  -- NOW NULLABLE
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
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  state_changed_at timestamptz NOT NULL DEFAULT now()
);

-- Constraint: today_section required when state = 'today', null otherwise
ALTER TABLE tasks ADD CONSTRAINT check_today_section
  CHECK (
    (state = 'today' AND today_section IS NOT NULL) OR
    (state != 'today' AND today_section IS NULL)
  );
```

**Existing fields kept**: `description` (already exists on tasks, no migration needed)

**Removed fields**: `priority`, `importance_score`, `urgency_score`, `is_completed`, `job`

**Chip values**: `high_impact`, `urgent`, `blocks_others`, `quick_win`, `deep_work`, `stress_relief`, `only_i_can`

**Chips validation**: Application-level only (validate in taskService before write). No database CHECK constraint on the array — this keeps chips extensible without migrations.

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

### Projects Table (modified)

- **Remove**: `priority` field
- **Rename**: `job` to `area`
- **Keep**: everything else (name, description, due_date, status, stakeholders, timestamps, completed_at)

### Notes Table (modified)

- **Add**: `idea_id` UUID FK (nullable)
- **Update constraint**: at least one of (project_id, task_id, idea_id) is NOT NULL, but only one at a time
- **Existing data**: Current notes already satisfy this (they have exactly one of project_id or task_id set). Migration adds the column and updates the constraint in one step:

```sql
-- Audit for orphan notes before applying constraint
-- SELECT count(*) FROM notes WHERE project_id IS NULL AND task_id IS NULL;
-- If orphans exist: delete them or assign to a default project before proceeding

ALTER TABLE notes ADD COLUMN idea_id UUID REFERENCES ideas(id);

-- Clean up any orphan notes (both FKs null) — these violate the new constraint
DELETE FROM notes WHERE project_id IS NULL AND task_id IS NULL;

ALTER TABLE notes DROP CONSTRAINT IF EXISTS check_note_parent;
ALTER TABLE notes ADD CONSTRAINT check_note_parent CHECK (
  (project_id IS NOT NULL)::int +
  (task_id IS NOT NULL)::int +
  (idea_id IS NOT NULL)::int = 1
);
```

---

## Views & Navigation

### Tab Bar

Three primary tabs (top on desktop, bottom on mobile):

| Tab | Purpose | Default |
|-----|---------|---------|
| **Today** | Daily execution view | Default landing page |
| **Plan** | Board view for weekly planning/triage | |
| **Ideas** | Idea Vault — separate from tasks | |

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
- "Promote to task" creates a task in Backlog and sets the idea's `idea_state = 'promoted'` (idea retained for history, hidden from active views)
- Ideas never appear in Today/Plan views

---

## Task Card Design

Compact card showing:
- Task name (primary text)
- Chips as small coloured pills (e.g. "High impact", "Quick win")
- Area as subtle text label if set
- Due date badge (red = overdue/today, amber = tomorrow, blue = this week, grey = future)
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
| Send to Waiting | Drag to Waiting — inline prompt for waiting_reason |
| Move within Plan board | Drag between any columns |

Optimistic UI — card moves instantly, database write in background.

### Drag-and-Drop Library

Use **@dnd-kit/core** + **@dnd-kit/sortable**. The current native HTML drag-and-drop is insufficient for multi-container sortable lists with sort order persistence. @dnd-kit provides:
- Multi-container sortable (items between Today sections and Board columns)
- Touch support for mobile
- Keyboard accessibility
- Collision detection strategies for kanban
- Active development and React 19 compatible

### Sort Order Mechanics

**Algorithm**: Gap-based integers with lazy reindex.

- When inserting at position between two items: `sort_order = floor((above + below) / 2)`
- When inserting at top: `sort_order = first_item.sort_order - 1000`
- When inserting at bottom: `sort_order = last_item.sort_order + 1000`
- Initial gap: 1000 between items
- **Lazy reindex**: When a gap becomes < 1 (after many insertions between the same two items), reindex all items in that state+section with gaps of 1000. This is rare in practice.
- When a task moves between sections/states: it gets `sort_order = max(sort_order in target) + 1000` (appended to bottom of target, except drag to Today defaults to Good to Do section bottom)

### Quick Actions (per card, via action menu or swipe)

| Action | Effect |
|--------|--------|
| Complete | state = 'done', completed_at set |
| Move to... | Quick picker: Today (which section?) / This Week / Backlog / Waiting |
| Set chips | Toggle chips on/off (pill-style multi-select) |
| Set due date | Inline picker with quick picks (Tomorrow, Friday, Next Monday) |
| Set area | Dropdown of existing areas + free text |
| Set type | Dropdown of task types |

### Quick Capture

Available from every view via persistent floating input:
- Enter = create in Backlog
- Shift+Enter = create in Today > Good to Do
- `!` prefix = create as Idea in vault
- Minimal fields on capture: just the name

### Waiting Mechanics

When moving to Waiting:
- Inline prompt: "Who/what are you waiting on?" (optional free text)
- "Follow-up date?" with quick picks: +3 days, +1 week, +2 weeks
- Card shows reason and follow-up date
- Overdue follow-ups get amber visual flag

### Completion Behaviour

- Complete in Today → moves to "Completed today" section
- Complete elsewhere → state = 'done'
- Completed tasks hidden from Plan board (viewable via toggle)

### "Completed Today" Day Boundary

The "Completed today" section filters by `completed_at >= start of today (Europe/London)`. When the user opens the app the next morning, yesterday's completions are no longer shown — they are in the `done` state and visible only via the "Show completed" toggle in the Plan board. No manual reset needed.

### Staleness Detection

- This Week items with state_changed_at >14 days old → subtle "stale" badge
- Backlog items never flagged as stale
- Waiting items with overdue follow_up_date → amber flag

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

Visual nudges only. Never blocking, never modal, never punishing. Dismissable.

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

## Routing & Existing Pages

The new navigation model replaces the current page structure:

| Current Route | Fate | New Route |
|---------------|------|-----------|
| `/dashboard` | **Replaced** — becomes redirect to `/today` | `/today` |
| `/login` | **Kept** — unchanged | `/login` |
| `/completed-report` | **Kept** — update queries to use `state = 'done'` instead of `is_completed` | `/completed-report` |
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

Making `project_id` nullable means tasks can exist without a project. The existing `ensureUnassignedProject` pattern is **removed** — tasks without a project simply have `project_id = null`. The area field replaces the need for a catch-all project. Existing tasks in the "Unassigned" project get `project_id` set to null during migration.

### Area Field Behaviour

`area` is free text with no database constraint. "Existing areas" dropdown is populated by `SELECT DISTINCT area FROM tasks WHERE area IS NOT NULL AND user_id = $1 UNION SELECT DISTINCT area FROM projects WHERE area IS NOT NULL AND user_id = $1`. Users can type a new value or select from the dropdown. Empty strings are normalised to null.

---

## External Services Impact

### Office 365 Sync Service

`src/services/office365SyncService.js` currently maps `priority` to Microsoft Graph's `importance` field and uses `is_completed` to set Graph task status.

**Changes required:**
- Replace `is_completed` check with `state === 'done'`
- Remove `priority` → Graph `importance` mapping entirely (Graph tasks will use `importance: 'normal'` as default)
- Update any `job` references to `area`

### Daily Task Email Service

`src/services/dailyTaskEmailService.js` currently queries by `priority` and filters `is_completed = false`.

**Changes required:**
- Filter by `state = 'today'` instead of `is_completed = false` (email shows today's tasks)
- Replace priority formatting with today_section labels (Must Do / Good to Do / Quick Wins)
- Group tasks by today_section in the email template
- Update any `job` references to `area`

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
| src/contexts/TargetProjectContext.tsx | Project selection context — remove (projects no longer primary navigation organiser) |
| src/components/Projects/ProjectList.js | Priority-ordered project list — replaced by Plan board |
| src/app/prioritise/page.js | Scoring matrix page — entire feature removed |
| src/app/capture/page.js | Replaced by Quick Capture floating input |
| src/app/tasks/page.js | Replaced by Plan board view |

### Code Modified in Surviving Files

| File | What Changes |
|------|-------------|
| src/lib/constants.js | Remove PRIORITY, PRIORITY_VALUES. Add STATE, TODAY_SECTION, TASK_TYPE, CHIP_VALUES constants. Rename DRAG_DATA_TYPES if needed for @dnd-kit |
| src/lib/styleUtils.js | Remove getPriorityStyles(), getPriorityBadgeStyles(). Add state/section styling helpers |
| src/lib/projectHelpers.js | Remove priority styling functions, shadow glows. Update any `job` references to `area` |
| src/lib/validators.js | Remove importance_score, urgency_score validation. Add state, today_section, task_type, chips validation |
| src/components/Tasks/TaskItem.js | Remove getTaskPriorityClasses(), priority rendering, ChaseTaskModal import. Rebuild as new TaskCard component |
| src/components/Projects/ProjectItem.js | Remove priority sidebar strip, shadow glow. Update `job` to `area`. Remove drag-to-project logic (replaced by drag-to-state) |
| src/components/dashboard/SidebarFilters.jsx | Remove priority filter checkboxes. Update `job` filter to `area` |
| src/services/taskService.js | Update all queries: remove priority/importance_score/urgency_score fields, add state/today_section/sort_order/chips fields, rename job to area |
| src/services/office365SyncService.js | Replace is_completed with state check, remove priority mapping, rename job to area |
| src/services/dailyTaskEmailService.js | Filter by state='today', replace priority with today_section, rename job to area |
| src/app/api/tasks/route.js | Update query fields to match new schema |
| src/app/api/projects/route.js | Remove priority, rename job to area |
| src/app/api/projects/[id]/route.js | Remove priority, rename job to area |
| src/app/api/completed-items/route.js | Replace is_completed=true filter with state='done' |
| src/app/dashboard/page.js | Redirect to /today or replace with new navigation shell |
| src/components/Projects/ProjectHeader.jsx | Remove priority display, update job to area |
| src/components/Projects/AddProjectForm.js | Remove priority dropdown, update job to area |
| src/components/Notes/ProjectNoteWorkspaceModal.js | Remove QuickTaskForm import, replace with new Quick Capture or inline task creation |
| src/components/Projects/ProjectItem.js | Remove QuickTaskForm import (in addition to priority removals listed above) |
| src/app/api/admin/migrate/route.js | Remove priority references from migration indexes |
| src/app/api/cron/daily-task-email/route.js | Update to match new dailyTaskEmailService query shape |
| src/lib/taskSort.js | Keep — due date sort logic still useful in new views. Remove any priority references if present |

### Features Retired

| Feature | Replacement |
|---------|-------------|
| Chase button | Move to Waiting + follow-up date |
| Priority dropdown on forms | Chips + section placement |
| Priority colour-coded borders | Section hierarchy |
| Importance/urgency score inputs | Chips |
| Computed priority label | Gone |

### What Survives Unchanged

- Due date colour coding (red/amber/blue/grey)
- Quick date picker options
- Notes system (extended with idea_id FK)
- Project statuses (Open, In Progress, On Hold, Completed, Cancelled)
- Stakeholder tracking and filtering
- Authentication (NextAuth)
- Supabase client patterns

---

## Migration

### Single Migration File

**Step 1 — Create new tables and columns:**
- Create ideas table
- Add new columns to tasks: state, today_section, sort_order, area, task_type, chips, waiting_reason, follow_up_date, state_changed_at
- Add idea_id FK to notes, update constraint
- Add area column to projects

**Step 2 — Seed existing data:**
- Active tasks (is_completed = false): state = 'backlog'
- Completed tasks (is_completed = true): state = 'done', completed_at preserved
- Copy job values to area on tasks and projects
- Set sort_order = 0, state_changed_at = now() on all tasks

**Step 3 — Audit and update functions/triggers:**
- Find all PL/pgSQL functions referencing priority, importance_score, urgency_score, is_completed, job
- Update or drop each in the same migration

**Step 4 — Drop old columns:**
- Tasks: drop priority, importance_score, urgency_score, is_completed, job
- Projects: drop priority, job

**Step 5 — Add constraints:**
- All CHECK constraints on new enums
- today_section required when state = 'today'

### Rollback Strategy

- Full database backup before migration
- Test with npx supabase db push --dry-run
- Old columns dropped only after confirming new columns populated
