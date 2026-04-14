# Smart Planning Prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automated daily/weekly planning prompts that surface tasks with upcoming due dates and guide the user through triage into their day or week.

**Architecture:** A `usePlanningPrompt` hook in AppShell checks London time against configurable planning windows, fetches candidates from a new `/api/planning-candidates` endpoint, and renders a `PlanningModal` + `PlanningBanner` globally. Two new DB tables (`planning_sessions`, `user_settings`) track session state and user preferences. Existing `updateTask` mutation path is reused for task moves.

**Tech Stack:** Next.js 15 App Router, React 19, Supabase (PostgreSQL), date-fns-tz, Headless UI, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-04-14-smart-planning-prompts-design.md`

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `supabase/migrations/20260414000001_add_planning_tables.sql` | DB tables: `planning_sessions`, `user_settings` |
| `src/lib/planningWindow.js` | London-time window detection, window date calculation |
| `src/hooks/usePlanningPrompt.js` | Central hook: window state, session check, candidate fetch |
| `src/app/api/planning-candidates/route.js` | GET endpoint: server-side date-filtered task query |
| `src/app/api/planning-sessions/route.js` | GET/POST: check and record planning sessions |
| `src/app/api/user-settings/route.js` | GET/PATCH: fetch and update planning window times |
| `src/components/planning/PlanningModal.jsx` | Full-screen planning wizard (daily + weekly + combined) |
| `src/components/planning/PlanningBanner.jsx` | Slim top-of-page prompt banner |
| `src/components/planning/PlanningTaskRow.jsx` | Individual task row with action buttons |
| `src/app/settings/planning/page.js` | Settings page for planning window times |
| `src/app/settings/planning/PlanningSettingsClient.jsx` | Client component for settings form |

### Modified files
| File | Change |
|------|--------|
| `src/components/layout/AppShell.jsx` | Mount PlanningModal + PlanningBanner, add `/calendar` to TAB_ROUTES |
| `src/lib/apiClient.js` | Add `getPlanningCandidates()`, `getPlanningSession()`, `createPlanningSession()`, `getUserSettings()`, `updateUserSettings()` methods |
| `src/lib/constants.js` | Add `PLANNING_DEFAULTS` and `WINDOW_TYPE` constants |
| `vercel.json` | Shift demote cron schedules from `:00` to `:55` |
| `src/components/layout/Sidebar.jsx` | Add Planning settings nav link under Settings |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260414000001_add_planning_tables.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Planning Sessions: tracks completed planning sessions
CREATE TABLE planning_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  window_type text NOT NULL CHECK (window_type IN ('daily', 'weekly')),
  window_date date NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, window_type, window_date)
);

-- Index for the common lookup: "has this user planned for this window?"
CREATE INDEX idx_planning_sessions_lookup
  ON planning_sessions (user_id, window_type, window_date);

-- RLS (defence-in-depth; app uses service-role client)
ALTER TABLE planning_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own planning sessions"
  ON planning_sessions FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- User Settings: per-user planning window configuration
CREATE TABLE user_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  daily_plan_start time NOT NULL DEFAULT '20:05',
  daily_plan_end time NOT NULL DEFAULT '20:00',
  weekly_plan_start time NOT NULL DEFAULT '20:05',
  weekly_plan_end time NOT NULL DEFAULT '20:00',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_user_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_user_settings_updated_at();

-- RLS
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own settings"
  ON user_settings FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
```

- [ ] **Step 2: Dry-run the migration**

Run: `npx supabase db push --dry-run`
Expected: Migration applies cleanly, two new tables created.

- [ ] **Step 3: Apply the migration**

Run: `npx supabase db push`
Expected: Tables `planning_sessions` and `user_settings` exist with all constraints.

- [ ] **Step 4: Verify tables**

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name IN ('planning_sessions', 'user_settings')
ORDER BY table_name, ordinal_position;
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260414000001_add_planning_tables.sql
git commit -m "feat: add planning_sessions and user_settings tables"
```

---

## Task 2: Shift Demote Cron Schedules

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Update cron schedules from :00 to :55**

In `vercel.json`, change the demote cron entries. The demote-today and demote-week crons currently fire at `0 19` and `0 20` (top of hour). Shift to `55 18` and `55 19` so they complete before the 20:05 planning window opens.

```json
{
  "version": 2,
  "crons": [
    {
      "path": "/api/cron/daily-task-email",
      "schedule": "0 7 * * *"
    },
    {
      "path": "/api/cron/daily-task-email",
      "schedule": "0 8 * * *"
    },
    {
      "path": "/api/cron/office365-sync",
      "schedule": "* * * * *"
    },
    {
      "path": "/api/cron/demote-today-tasks",
      "schedule": "55 18 * * *"
    },
    {
      "path": "/api/cron/demote-today-tasks",
      "schedule": "55 19 * * *"
    },
    {
      "path": "/api/cron/demote-week-tasks",
      "schedule": "55 18 * * *"
    },
    {
      "path": "/api/cron/demote-week-tasks",
      "schedule": "55 19 * * *"
    }
  ]
}
```

- [ ] **Step 2: Verify the change doesn't break existing cron auth**

The cron route handlers check `isLondonTimeWindow({ hour: 20 })` (demote-today-tasks/route.js:26). With the schedule shifted to `:55`, the cron will fire at 18:55/19:55 UTC. During BST (UTC+1), 19:55 UTC = 20:55 London — this would MISS the `hour: 20` check. During GMT, 19:55 UTC = 19:55 London — also misses.

**This means the cron route guard also needs updating.** Read the demote route files to confirm the exact hour check, then update them to accept hour 19 OR 20 (covering both the :55 firing and DST variation). This is addressed in Task 2b below.

- [ ] **Step 3: Commit vercel.json change**

```bash
git add vercel.json
git commit -m "chore: shift demote cron schedules to :55 before planning window"
```

---

## Task 2b: Update Demote Cron Hour Guards

**Files:**
- Modify: `src/app/api/cron/demote-today-tasks/route.js`
- Modify: `src/app/api/cron/demote-week-tasks/route.js`

- [ ] **Step 1: Read the current hour guard in demote-today-tasks**

Read `src/app/api/cron/demote-today-tasks/route.js` to find the `isLondonTimeWindow` call and understand the exact guard logic.

- [ ] **Step 2: Update demote-today-tasks to accept a wider hour window**

Replace the single-hour check with a range that covers the :55 firing across both GMT and BST. The crons fire at 18:55 and 19:55 UTC. In GMT that's 18:55 and 19:55 London. In BST that's 19:55 and 20:55 London. So the guard should accept London hours 18, 19, or 20.

Change the guard from:
```js
if (!isLondonTimeWindow({ hour: 20 })) {
```
to:
```js
const londonParts = getTimeZoneParts(new Date(), LONDON_TIME_ZONE);
if (londonParts.hour < 18 || londonParts.hour > 20) {
```

Import `getTimeZoneParts` and `LONDON_TIME_ZONE` from `@/lib/timezone` if not already imported.

- [ ] **Step 3: Apply the same update to demote-week-tasks**

Same pattern — widen the hour guard to accept 18-20.

- [ ] **Step 4: Verify cron routes still respond correctly**

Run: `npm run build`
Expected: Clean build, no import errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/demote-today-tasks/route.js src/app/api/cron/demote-week-tasks/route.js
git commit -m "fix: widen demote cron hour guard to cover shifted schedule"
```

---

## Task 3: Planning Window Utility

**Files:**
- Create: `src/lib/planningWindow.js`
- Modify: `src/lib/constants.js`

- [ ] **Step 1: Add planning constants**

Add to `src/lib/constants.js` after the existing `SOFT_CAPS` block:

```js
// Planning Window Types
export const WINDOW_TYPE = {
  DAILY: 'daily',
  WEEKLY: 'weekly'
};

// Default planning window times
export const PLANNING_DEFAULTS = {
  DAILY_START: '20:05',
  DAILY_END: '20:00',
  WEEKLY_START: '20:05',
  WEEKLY_END: '20:00'
};
```

- [ ] **Step 2: Create the planning window utility**

Create `src/lib/planningWindow.js`:

```js
import { getTimeZoneParts, LONDON_TIME_ZONE } from './timezone';
import { PLANNING_DEFAULTS, WINDOW_TYPE } from './constants';

/**
 * Parse a "HH:MM" time string into { hour, minute }.
 */
function parseTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return { hour: h, minute: m };
}

/**
 * Convert London { hour, minute } into minutes-since-midnight for comparison.
 */
function toMinutes({ hour, minute }) {
  return hour * 60 + minute;
}

/**
 * Determine if a London time is inside a planning window.
 *
 * Daily windows span two calendar days: start (e.g. 20:05 today) to end (e.g. 20:00 tomorrow).
 * This means the window wraps past midnight: start > end in minute terms.
 *
 * @param {Object} londonParts - { hour, minute, day, month, year, dateKey } from getTimeZoneParts
 * @param {string} startTime - "HH:MM" start of window
 * @param {string} endTime - "HH:MM" end of window (next day for daily, next week for weekly)
 * @returns {boolean}
 */
function isInsideWindow(londonParts, startTime, endTime) {
  const now = toMinutes(londonParts);
  const start = toMinutes(parseTime(startTime));
  const end = toMinutes(parseTime(endTime));

  if (start > end) {
    // Window wraps past midnight: e.g. 20:05 to 20:00
    // Inside if now >= start OR now < end
    return now >= start || now < end;
  }
  // Non-wrapping window
  return now >= start && now < end;
}

/**
 * Get the day of week in London (0 = Sunday, 6 = Saturday).
 */
function getLondonDayOfWeek(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TIME_ZONE,
    weekday: 'short',
  });
  const weekday = formatter.format(date);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[weekday];
}

/**
 * Determine the active planning window and compute the target window_date.
 *
 * @param {Object} settings - User settings with daily_plan_start/end, weekly_plan_start/end
 * @param {Date} [now] - Current time (defaults to new Date())
 * @returns {{ isActive: boolean, windowType: string|null, windowDate: string|null }}
 *   windowDate is ISO date string (YYYY-MM-DD) — tomorrow for daily, Monday of target week for weekly.
 */
export function getActivePlanningWindow(settings = {}, now = new Date()) {
  const londonParts = getTimeZoneParts(now, LONDON_TIME_ZONE);
  const dayOfWeek = getLondonDayOfWeek(now);

  const dailyStart = settings.daily_plan_start || PLANNING_DEFAULTS.DAILY_START;
  const dailyEnd = settings.daily_plan_end || PLANNING_DEFAULTS.DAILY_END;
  const weeklyStart = settings.weekly_plan_start || PLANNING_DEFAULTS.WEEKLY_START;
  const weeklyEnd = settings.weekly_plan_end || PLANNING_DEFAULTS.WEEKLY_END;

  // Sunday check for weekly window
  const isSunday = dayOfWeek === 0;
  // After midnight but before end on Monday counts as Sunday's weekly window
  const isMondayBeforeEnd = dayOfWeek === 1 && toMinutes(londonParts) < toMinutes(parseTime(weeklyEnd));

  // Check weekly window first (Sunday evening or still inside on Monday morning)
  if (isSunday || isMondayBeforeEnd) {
    if (isSunday && isInsideWindow(londonParts, weeklyStart, weeklyEnd)) {
      // Window date = tomorrow (Monday) as the anchor for the week
      const tomorrow = getDatePlusDays(londonParts.dateKey, 1);
      return { isActive: true, windowType: WINDOW_TYPE.WEEKLY, windowDate: tomorrow };
    }
    if (isMondayBeforeEnd && toMinutes(londonParts) < toMinutes(parseTime(weeklyEnd))) {
      // Still in the weekly window that started Sunday evening
      // Window date = today (Monday)
      return { isActive: true, windowType: WINDOW_TYPE.WEEKLY, windowDate: londonParts.dateKey };
    }
  }

  // Check daily window (every day except Sunday before weekly start)
  if (isInsideWindow(londonParts, dailyStart, dailyEnd)) {
    // Compute tomorrow's date as the window_date
    const nowMinutes = toMinutes(londonParts);
    const startMinutes = toMinutes(parseTime(dailyStart));

    if (nowMinutes >= startMinutes) {
      // After start time: tomorrow = current London date + 1
      const tomorrow = getDatePlusDays(londonParts.dateKey, 1);
      return { isActive: true, windowType: WINDOW_TYPE.DAILY, windowDate: tomorrow };
    } else {
      // Before end time (after midnight): tomorrow = current London date (it IS tomorrow now)
      return { isActive: true, windowType: WINDOW_TYPE.DAILY, windowDate: londonParts.dateKey };
    }
  }

  return { isActive: false, windowType: null, windowDate: null };
}

/**
 * Add days to an ISO date string.
 * @param {string} dateKey - "YYYY-MM-DD"
 * @param {number} days
 * @returns {string} "YYYY-MM-DD"
 */
function getDatePlusDays(dateKey, days) {
  const d = new Date(dateKey + 'T12:00:00Z'); // noon UTC to avoid DST edge
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Get the Monday date for a given week (used for weekly window_date).
 * @param {string} dateKey - any date in ISO format
 * @returns {string} Monday's date in "YYYY-MM-DD"
 */
export function getMondayOfWeek(dateKey) {
  const d = new Date(dateKey + 'T12:00:00Z');
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/planningWindow.js src/lib/constants.js
git commit -m "feat: add planning window time utilities"
```

---

## Task 4: Planning Candidates API Endpoint

**Files:**
- Create: `src/app/api/planning-candidates/route.js`

- [ ] **Step 1: Create the endpoint**

```js
import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';

const CANDIDATE_SELECT = 'id, name, due_date, state, today_section, sort_order, area, task_type, chips, project_id, waiting_reason, follow_up_date, created_at';

// GET /api/planning-candidates?windowType=daily&windowDate=2026-04-15
export async function GET(request) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const windowType = searchParams.get('windowType');
    const windowDate = searchParams.get('windowDate');

    // Validate params
    if (!windowType || !['daily', 'weekly'].includes(windowType)) {
      return NextResponse.json({ error: 'Invalid windowType — must be "daily" or "weekly"' }, { status: 400 });
    }
    if (!windowDate || !/^\d{4}-\d{2}-\d{2}$/.test(windowDate)) {
      return NextResponse.json({ error: 'Invalid windowDate — must be YYYY-MM-DD' }, { status: 400 });
    }

    const supabase = getSupabaseServiceRole();
    const userId = session.user.id;

    if (windowType === 'daily') {
      const [dueTomorrow, overdue, undatedThisWeek] = await Promise.all([
        // 1. Due tomorrow, not already in today/done
        supabase
          .from('tasks')
          .select(CANDIDATE_SELECT + ', projects!tasks_project_id_fkey(name, area)')
          .eq('user_id', userId)
          .eq('due_date', windowDate)
          .not('state', 'in', '("today","done")')
          .order('sort_order', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true }),

        // 2. Overdue: due before windowDate, not in today/done
        supabase
          .from('tasks')
          .select(CANDIDATE_SELECT + ', projects!tasks_project_id_fkey(name, area)')
          .eq('user_id', userId)
          .lt('due_date', windowDate)
          .not('state', 'in', '("today","done")')
          .order('due_date', { ascending: true })
          .order('created_at', { ascending: true }),

        // 3. Undated THIS_WEEK tasks
        supabase
          .from('tasks')
          .select(CANDIDATE_SELECT + ', projects!tasks_project_id_fkey(name, area)')
          .eq('user_id', userId)
          .eq('state', 'this_week')
          .is('due_date', null)
          .order('sort_order', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true }),
      ]);

      if (dueTomorrow.error || overdue.error || undatedThisWeek.error) {
        const err = dueTomorrow.error || overdue.error || undatedThisWeek.error;
        console.error('Planning candidates query error:', err);
        return NextResponse.json({ error: 'Failed to fetch planning candidates' }, { status: 500 });
      }

      return NextResponse.json({
        data: {
          dueTomorrow: flattenProjects(dueTomorrow.data),
          overdue: flattenProjects(overdue.data),
          undatedThisWeek: flattenProjects(undatedThisWeek.data),
        },
      });
    }

    // Weekly
    const weekEnd = new Date(windowDate + 'T12:00:00Z');
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const weekEndStr = weekEnd.toISOString().slice(0, 10);

    const [dueThisWeek, overdue] = await Promise.all([
      // 1. Due in target week, not in today/done
      supabase
        .from('tasks')
        .select(CANDIDATE_SELECT + ', projects!tasks_project_id_fkey(name, area)')
        .eq('user_id', userId)
        .gte('due_date', windowDate)
        .lte('due_date', weekEndStr)
        .not('state', 'in', '("today","done")')
        .order('due_date', { ascending: true })
        .order('created_at', { ascending: true }),

      // 2. Overdue: due before Monday, not in this_week/today/done
      supabase
        .from('tasks')
        .select(CANDIDATE_SELECT + ', projects!tasks_project_id_fkey(name, area)')
        .eq('user_id', userId)
        .lt('due_date', windowDate)
        .not('state', 'in', '("this_week","today","done")')
        .order('due_date', { ascending: true })
        .order('created_at', { ascending: true }),
    ]);

    if (dueThisWeek.error || overdue.error) {
      const err = dueThisWeek.error || overdue.error;
      console.error('Planning candidates query error:', err);
      return NextResponse.json({ error: 'Failed to fetch planning candidates' }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        dueThisWeek: flattenProjects(dueThisWeek.data),
        overdue: flattenProjects(overdue.data),
      },
    });
  } catch (err) {
    console.error('Planning candidates error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Flatten the nested project join into top-level project_name and project_area fields.
 */
function flattenProjects(tasks) {
  return (tasks || []).map((t) => {
    const { projects, ...rest } = t;
    return {
      ...rest,
      project_name: projects?.name || null,
      project_area: projects?.area || null,
    };
  });
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/planning-candidates/route.js
git commit -m "feat: add /api/planning-candidates endpoint with date-filtered queries"
```

---

## Task 5: Planning Sessions API Endpoint

**Files:**
- Create: `src/app/api/planning-sessions/route.js`

- [ ] **Step 1: Create the endpoint**

```js
import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';

// GET /api/planning-sessions?windowType=daily&windowDate=2026-04-15
export async function GET(request) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const windowType = searchParams.get('windowType');
    const windowDate = searchParams.get('windowDate');

    if (!windowType || !['daily', 'weekly'].includes(windowType)) {
      return NextResponse.json({ error: 'Invalid windowType' }, { status: 400 });
    }
    if (!windowDate || !/^\d{4}-\d{2}-\d{2}$/.test(windowDate)) {
      return NextResponse.json({ error: 'Invalid windowDate' }, { status: 400 });
    }

    const supabase = getSupabaseServiceRole();
    const { data, error } = await supabase
      .from('planning_sessions')
      .select('id, window_type, window_date, completed_at')
      .eq('user_id', session.user.id)
      .eq('window_type', windowType)
      .eq('window_date', windowDate)
      .maybeSingle();

    if (error) {
      console.error('Planning session lookup error:', error);
      return NextResponse.json({ error: 'Failed to check planning session' }, { status: 500 });
    }

    return NextResponse.json({ data: data || null });
  } catch (err) {
    console.error('Planning sessions GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/planning-sessions — upsert a completed session
export async function POST(request) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { windowType, windowDate } = body;

    if (!windowType || !['daily', 'weekly'].includes(windowType)) {
      return NextResponse.json({ error: 'Invalid windowType' }, { status: 400 });
    }
    if (!windowDate || !/^\d{4}-\d{2}-\d{2}$/.test(windowDate)) {
      return NextResponse.json({ error: 'Invalid windowDate' }, { status: 400 });
    }

    const supabase = getSupabaseServiceRole();
    const { data, error } = await supabase
      .from('planning_sessions')
      .upsert(
        {
          user_id: session.user.id,
          window_type: windowType,
          window_date: windowDate,
          completed_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,window_type,window_date' }
      )
      .select('id, window_type, window_date, completed_at')
      .single();

    if (error) {
      console.error('Planning session upsert error:', error);
      return NextResponse.json({ error: 'Failed to record planning session' }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error('Planning sessions POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/planning-sessions/route.js
git commit -m "feat: add /api/planning-sessions GET/POST endpoint"
```

---

## Task 6: User Settings API Endpoint

**Files:**
- Create: `src/app/api/user-settings/route.js`

- [ ] **Step 1: Create the endpoint**

```js
import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';
import { PLANNING_DEFAULTS } from '@/lib/constants';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

// GET /api/user-settings — returns user's planning settings or defaults
export async function GET(request) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabaseServiceRole();
    const { data, error } = await supabase
      .from('user_settings')
      .select('daily_plan_start, daily_plan_end, weekly_plan_start, weekly_plan_end')
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (error) {
      console.error('User settings lookup error:', error);
      return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
    }

    // Return saved settings or defaults
    return NextResponse.json({
      data: data || {
        daily_plan_start: PLANNING_DEFAULTS.DAILY_START,
        daily_plan_end: PLANNING_DEFAULTS.DAILY_END,
        weekly_plan_start: PLANNING_DEFAULTS.WEEKLY_START,
        weekly_plan_end: PLANNING_DEFAULTS.WEEKLY_END,
      },
    });
  } catch (err) {
    console.error('User settings GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH /api/user-settings — update planning window times
export async function PATCH(request) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { daily_plan_start, daily_plan_end, weekly_plan_start, weekly_plan_end } = body;

    // Validate all four fields
    const fields = { daily_plan_start, daily_plan_end, weekly_plan_start, weekly_plan_end };
    const errors = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue; // allow partial updates
      if (typeof value !== 'string' || !TIME_REGEX.test(value)) {
        errors[key] = 'Must be a valid time in HH:MM format (00:00 to 23:59)';
      }
    }

    // Check start != end for daily and weekly pairs
    const effectiveDaily = {
      start: daily_plan_start || PLANNING_DEFAULTS.DAILY_START,
      end: daily_plan_end || PLANNING_DEFAULTS.DAILY_END,
    };
    const effectiveWeekly = {
      start: weekly_plan_start || PLANNING_DEFAULTS.WEEKLY_START,
      end: weekly_plan_end || PLANNING_DEFAULTS.WEEKLY_END,
    };
    if (effectiveDaily.start === effectiveDaily.end) {
      errors.daily_plan_start = 'Start and end times cannot be the same';
    }
    if (effectiveWeekly.start === effectiveWeekly.end) {
      errors.weekly_plan_start = 'Start and end times cannot be the same';
    }

    if (Object.keys(errors).length > 0) {
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 });
    }

    // Build update object with only provided fields
    const updates = {};
    if (daily_plan_start !== undefined) updates.daily_plan_start = daily_plan_start;
    if (daily_plan_end !== undefined) updates.daily_plan_end = daily_plan_end;
    if (weekly_plan_start !== undefined) updates.weekly_plan_start = weekly_plan_start;
    if (weekly_plan_end !== undefined) updates.weekly_plan_end = weekly_plan_end;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const supabase = getSupabaseServiceRole();
    const { data, error } = await supabase
      .from('user_settings')
      .upsert(
        {
          user_id: session.user.id,
          ...updates,
        },
        { onConflict: 'user_id' }
      )
      .select('daily_plan_start, daily_plan_end, weekly_plan_start, weekly_plan_end')
      .single();

    if (error) {
      console.error('User settings update error:', error);
      return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error('User settings PATCH error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/user-settings/route.js
git commit -m "feat: add /api/user-settings GET/PATCH endpoint with validation"
```

---

## Task 7: API Client Methods

**Files:**
- Modify: `src/lib/apiClient.js`

- [ ] **Step 1: Add planning methods to APIClient**

Add these methods to the `APIClient` class in `src/lib/apiClient.js`, after the existing task methods (after `updateSortOrder`):

```js
  // Planning
  async getPlanningCandidates(windowType, windowDate) {
    const params = new URLSearchParams({ windowType, windowDate });
    const response = await this.fetchWithAuth(`/api/planning-candidates?${params}`);
    return response.data || {};
  }

  async getPlanningSession(windowType, windowDate) {
    const params = new URLSearchParams({ windowType, windowDate });
    const response = await this.fetchWithAuth(`/api/planning-sessions?${params}`);
    return response.data;
  }

  async createPlanningSession(windowType, windowDate) {
    const response = await this.fetchWithAuth('/api/planning-sessions', {
      method: 'POST',
      body: JSON.stringify({ windowType, windowDate }),
    });
    return response.data;
  }

  async getUserSettings() {
    const response = await this.fetchWithAuth('/api/user-settings');
    return response.data;
  }

  async updateUserSettings(settings) {
    const response = await this.fetchWithAuth('/api/user-settings', {
      method: 'PATCH',
      body: JSON.stringify(settings),
    });
    return response.data;
  }
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/lib/apiClient.js
git commit -m "feat: add planning API client methods"
```

---

## Task 8: usePlanningPrompt Hook

**Files:**
- Create: `src/hooks/usePlanningPrompt.js`

- [ ] **Step 1: Create the hook**

```js
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePathname } from 'next/navigation';
import apiClient from '@/lib/apiClient';
import { getActivePlanningWindow } from '@/lib/planningWindow';

/**
 * Central orchestrator for planning prompts.
 * Mounted in AppShell — checks London time, fetches candidates, manages modal/banner state.
 */
export function usePlanningPrompt() {
  const pathname = usePathname();
  const [isLoading, setIsLoading] = useState(true);
  const [windowState, setWindowState] = useState({
    isActive: false,
    windowType: null,
    windowDate: null,
  });
  const [isPlanned, setIsPlanned] = useState(false);
  const [tasks, setTasks] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [hasNewTasks, setHasNewTasks] = useState(false);

  const settingsRef = useRef(null);
  const lastCheckRef = useRef(null);

  const checkPlanningState = useCallback(async () => {
    try {
      // 1. Fetch settings (cache in ref)
      if (!settingsRef.current) {
        settingsRef.current = await apiClient.getUserSettings();
      }

      // 2. Determine active window
      const window = getActivePlanningWindow(settingsRef.current);

      setWindowState(window);

      if (!window.isActive) {
        setIsLoading(false);
        setIsPlanned(false);
        setTasks(null);
        setHasNewTasks(false);
        return;
      }

      // 3. Check if already planned
      const session = await apiClient.getPlanningSession(window.windowType, window.windowDate);
      const planned = !!session;
      setIsPlanned(planned);

      // 4. Fetch candidates
      const candidates = await apiClient.getPlanningCandidates(window.windowType, window.windowDate);
      setTasks(candidates);

      // 5. Detect new tasks after planning
      if (planned) {
        const hasCandidates = Object.values(candidates).some((arr) => arr && arr.length > 0);
        setHasNewTasks(hasCandidates);
      } else {
        setHasNewTasks(false);
      }

      // 6. Show modal on first visit if not planned and there are tasks
      const hasTasks = Object.values(candidates).some((arr) => arr && arr.length > 0);
      const checkKey = `${window.windowType}-${window.windowDate}`;
      if (!planned && hasTasks && lastCheckRef.current !== checkKey) {
        setShowModal(true);
      }
      lastCheckRef.current = checkKey;
    } catch (err) {
      console.error('Planning prompt check failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Run on mount and pathname changes
  useEffect(() => {
    checkPlanningState();
  }, [pathname, checkPlanningState]);

  // Recheck on tab focus (cross-device, time passing)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Invalidate settings cache on refocus
        settingsRef.current = null;
        checkPlanningState();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [checkPlanningState]);

  const openModal = useCallback(() => setShowModal(true), []);
  const closeModal = useCallback(() => setShowModal(false), []);

  const refreshSettings = useCallback(() => {
    settingsRef.current = null;
  }, []);

  const onPlanningComplete = useCallback(async () => {
    setShowModal(false);
    setIsPlanned(true);
    setHasNewTasks(false);
    // Emit event for views to refetch their data
    window.dispatchEvent(new CustomEvent('planning-complete'));
    // Re-check candidates (some may have moved, new ones may exist)
    await checkPlanningState();
  }, [checkPlanningState]);

  const totalCandidates = tasks
    ? Object.values(tasks).reduce((sum, arr) => sum + (arr?.length || 0), 0)
    : 0;

  return {
    isLoading,
    isActive: windowState.isActive,
    windowType: windowState.windowType,
    windowDate: windowState.windowDate,
    isPlanned,
    hasNewTasks,
    tasks,
    totalCandidates,
    showModal,
    openModal,
    closeModal,
    onPlanningComplete,
    refreshSettings,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/usePlanningPrompt.js
git commit -m "feat: add usePlanningPrompt hook"
```

---

## Task 9: PlanningTaskRow Component

**Files:**
- Create: `src/components/planning/PlanningTaskRow.jsx`

- [ ] **Step 1: Create the task row component**

```jsx
'use client';

import { useState } from 'react';
import { TODAY_SECTION, SOFT_CAPS, CHIP_VALUES, TASK_TYPE } from '@/lib/constants';
import { getDueDateStatus, quickPickOptions, toDateInputValue } from '@/lib/dateUtils';
import {
  CalendarDaysIcon,
  CheckCircleIcon,
  ForwardIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';

const SECTION_LABELS = {
  [TODAY_SECTION.MUST_DO]: 'Must Do',
  [TODAY_SECTION.GOOD_TO_DO]: 'Good to Do',
  [TODAY_SECTION.QUICK_WINS]: 'Quick Wins',
};

const SECTION_COLORS = {
  [TODAY_SECTION.MUST_DO]: 'bg-red-100 text-red-800 border-red-200',
  [TODAY_SECTION.GOOD_TO_DO]: 'bg-amber-100 text-amber-800 border-amber-200',
  [TODAY_SECTION.QUICK_WINS]: 'bg-green-100 text-green-800 border-green-200',
};

const CHIP_LABELS = {
  [CHIP_VALUES.HIGH_IMPACT]: 'High Impact',
  [CHIP_VALUES.URGENT]: 'Urgent',
  [CHIP_VALUES.BLOCKS_OTHERS]: 'Blocks Others',
  [CHIP_VALUES.STRESS_RELIEF]: 'Stress Relief',
  [CHIP_VALUES.ONLY_I_CAN]: 'Only I Can',
};

const TYPE_LABELS = {
  [TASK_TYPE.ADMIN]: 'Admin',
  [TASK_TYPE.REPLY_CHASE]: 'Reply/Chase',
  [TASK_TYPE.FIX]: 'Fix',
  [TASK_TYPE.PLANNING]: 'Planning',
  [TASK_TYPE.CONTENT]: 'Content',
  [TASK_TYPE.DEEP_WORK]: 'Deep Work',
  [TASK_TYPE.PERSONAL]: 'Personal',
};

export default function PlanningTaskRow({
  task,
  mode, // 'daily' | 'weekly'
  sectionCounts, // { must_do: N, good_to_do: N, quick_wins: N }
  onAssign, // (taskId, { state, today_section }) => void
  onSkip, // (taskId) => void
  onDefer, // (taskId, newDate) => void
}) {
  const [showDefer, setShowDefer] = useState(false);
  const [isActioned, setIsActioned] = useState(false);
  const [actionLabel, setActionLabel] = useState(null);
  const dueDateStatus = task.due_date ? getDueDateStatus(task.due_date) : null;

  if (isActioned) {
    return (
      <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        <CheckCircleIcon className="h-5 w-5 text-green-500" />
        <span className="font-medium">{task.name}</span>
        <span className="ml-auto text-xs">{actionLabel}</span>
      </div>
    );
  }

  const handleAssignSection = (section) => {
    onAssign(task.id, { state: 'today', today_section: section });
    setIsActioned(true);
    setActionLabel(`→ ${SECTION_LABELS[section]}`);
  };

  const handleAcceptWeekly = () => {
    onAssign(task.id, { state: 'this_week' });
    setIsActioned(true);
    setActionLabel('→ This Week');
  };

  const handleSkip = () => {
    onSkip(task.id);
    setIsActioned(true);
    setActionLabel('Skipped');
  };

  const handleDefer = (newDate) => {
    onDefer(task.id, newDate);
    setIsActioned(true);
    setActionLabel(`Deferred → ${newDate}`);
    setShowDefer(false);
  };

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      {/* Task info row */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{task.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {task.project_name && (
              <span className="rounded bg-muted px-1.5 py-0.5">{task.project_name}</span>
            )}
            {task.task_type && (
              <span className="rounded bg-muted px-1.5 py-0.5">{TYPE_LABELS[task.task_type] || task.task_type}</span>
            )}
            {dueDateStatus && (
              <span className={`rounded px-1.5 py-0.5 ${dueDateStatus.styles?.badge || 'bg-muted'}`}>
                {dueDateStatus.label}
              </span>
            )}
            {(task.chips || []).map((chip) => (
              <span key={chip} className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">
                {CHIP_LABELS[chip] || chip}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {mode === 'daily' ? (
          // Daily: section assignment pills
          <>
            {Object.entries(SECTION_LABELS).map(([section, label]) => {
              const count = sectionCounts?.[section] || 0;
              const cap = SOFT_CAPS[section.toUpperCase()] || 999;
              const isOverCap = count >= cap;
              return (
                <div key={section} className="flex flex-col items-start">
                  <button
                    type="button"
                    onClick={() => handleAssignSection(section)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:opacity-80 ${SECTION_COLORS[section]}`}
                  >
                    {label}
                  </button>
                  {isOverCap && (
                    <span className="mt-0.5 text-[10px] text-amber-600">
                      Already {count} tasks
                    </span>
                  )}
                </div>
              );
            })}
          </>
        ) : (
          // Weekly: Accept button
          <button
            type="button"
            onClick={handleAcceptWeekly}
            className="rounded-full border border-blue-200 bg-blue-100 px-3 py-1 text-xs font-medium text-blue-800 transition-colors hover:opacity-80"
          >
            Accept
          </button>
        )}

        <button
          type="button"
          onClick={handleSkip}
          className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80"
        >
          Skip
        </button>

        <button
          type="button"
          onClick={() => setShowDefer(!showDefer)}
          className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80"
        >
          <CalendarDaysIcon className="mr-1 inline h-3 w-3" />
          Defer
        </button>
      </div>

      {/* Defer date picker */}
      {showDefer && (
        <div className="mt-2 flex flex-wrap gap-2 rounded-md border border-border bg-muted/30 p-2">
          {quickPickOptions.map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => handleDefer(toDateInputValue(option.getValue()))}
              className="rounded border border-border bg-card px-2 py-1 text-xs hover:bg-muted"
            >
              {option.label}
            </button>
          ))}
          <input
            type="date"
            className="rounded border border-border bg-card px-2 py-1 text-xs"
            onChange={(e) => {
              if (e.target.value) handleDefer(e.target.value);
            }}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/planning/PlanningTaskRow.jsx
git commit -m "feat: add PlanningTaskRow component with section assignment and defer"
```

---

## Task 10: PlanningModal Component

**Files:**
- Create: `src/components/planning/PlanningModal.jsx`

- [ ] **Step 1: Create the modal component**

```jsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { format, parseISO } from 'date-fns';
import apiClient from '@/lib/apiClient';
import { STATE, TODAY_SECTION, SOFT_CAPS, WINDOW_TYPE } from '@/lib/constants';
import PlanningTaskRow from './PlanningTaskRow';

/**
 * Full-screen planning wizard modal.
 * Supports daily, weekly, and Sunday combined (weekly → daily) flows.
 */
export default function PlanningModal({
  isOpen,
  onClose,
  onComplete,
  windowType,
  windowDate,
  tasks,
}) {
  // Combined flow: Sunday starts with weekly, then transitions to daily (Monday)
  const isSundayCombined = windowType === WINDOW_TYPE.WEEKLY;
  const [step, setStep] = useState(isSundayCombined ? 'weekly' : windowType);
  const [sectionCounts, setSectionCounts] = useState({
    [TODAY_SECTION.MUST_DO]: 0,
    [TODAY_SECTION.GOOD_TO_DO]: 0,
    [TODAY_SECTION.QUICK_WINS]: 0,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [skippedIds, setSkippedIds] = useState(new Set());

  // Fetch current today section counts for soft cap warnings
  useEffect(() => {
    async function fetchCounts() {
      try {
        const todayTasks = await apiClient.getTasks(null, { state: STATE.TODAY });
        const counts = {
          [TODAY_SECTION.MUST_DO]: 0,
          [TODAY_SECTION.GOOD_TO_DO]: 0,
          [TODAY_SECTION.QUICK_WINS]: 0,
        };
        for (const t of todayTasks) {
          if (t.today_section && counts[t.today_section] !== undefined) {
            counts[t.today_section]++;
          }
        }
        setSectionCounts(counts);
      } catch (err) {
        console.error('Failed to fetch section counts:', err);
      }
    }
    if (isOpen) fetchCounts();
  }, [isOpen]);

  // Compute max sort_order for appending
  const getMaxSortOrder = useCallback(async (state, section = null) => {
    try {
      const tasks = await apiClient.getTasks(null, { state });
      let max = 0;
      for (const t of tasks) {
        if (section && t.today_section !== section) continue;
        if (t.sort_order != null && t.sort_order > max) max = t.sort_order;
      }
      return max;
    } catch {
      return 0;
    }
  }, []);

  const handleAssign = useCallback(async (taskId, updates) => {
    try {
      const maxSort = await getMaxSortOrder(
        updates.state,
        updates.today_section || null
      );
      await apiClient.updateTask(taskId, {
        ...updates,
        sort_order: maxSort + 1,
      });

      // Update section counts if assigning to today
      if (updates.today_section) {
        setSectionCounts((prev) => ({
          ...prev,
          [updates.today_section]: (prev[updates.today_section] || 0) + 1,
        }));
      }
    } catch (err) {
      console.error('Failed to assign task:', err);
    }
  }, [getMaxSortOrder]);

  const handleSkip = useCallback((taskId) => {
    setSkippedIds((prev) => new Set(prev).add(taskId));
  }, []);

  const handleDefer = useCallback(async (taskId, newDate) => {
    try {
      // If new date is outside current week, move to backlog
      const weekEnd = new Date(windowDate + 'T12:00:00Z');
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
      const weekEndStr = weekEnd.toISOString().slice(0, 10);

      const updates = { due_date: newDate };
      if (newDate > weekEndStr) {
        updates.state = STATE.BACKLOG;
      }

      await apiClient.updateTask(taskId, updates);
    } catch (err) {
      console.error('Failed to defer task:', err);
    }
  }, [windowDate]);

  const handleFinish = useCallback(async () => {
    setIsSubmitting(true);
    try {
      if (isSundayCombined && step === 'weekly') {
        // Record weekly session, transition to daily step
        await apiClient.createPlanningSession(WINDOW_TYPE.WEEKLY, windowDate);
        setStep('daily');
        setSkippedIds(new Set());
        setIsSubmitting(false);
        return;
      }

      // Record session (daily or weekly final step)
      const sessionType = isSundayCombined ? WINDOW_TYPE.DAILY : windowType;
      await apiClient.createPlanningSession(sessionType, windowDate);
      onComplete();
    } catch (err) {
      console.error('Failed to complete planning session:', err);
    } finally {
      setIsSubmitting(false);
    }
  }, [isSundayCombined, step, windowType, windowDate, onComplete]);

  // Determine which tasks to show for the current step
  const currentTasks = step === 'weekly'
    ? [...(tasks?.dueThisWeek || []), ...(tasks?.overdue || [])]
    : [...(tasks?.dueTomorrow || []), ...(tasks?.overdue || []), ...(tasks?.undatedThisWeek || [])];

  // For Sunday combined daily step: filter out tasks already triaged in weekly step
  // (tasks that are now in this_week state from the weekly accept won't appear in daily candidates
  //  since they'd need a fresh fetch — but the modal uses the initial tasks prop.
  //  We handle this by checking if a task was already actioned.)

  const formatWindowDate = (dateStr) => {
    try {
      return format(parseISO(dateStr), 'EEEE do MMMM');
    } catch {
      return dateStr;
    }
  };

  const formatWeekRange = (dateStr) => {
    try {
      const start = parseISO(dateStr);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      return `${format(start, 'do MMMM')} – ${format(end, 'do MMMM')}`;
    } catch {
      return dateStr;
    }
  };

  const title = step === 'weekly'
    ? `Plan Your Week — ${formatWeekRange(windowDate)}`
    : `Plan Your Tomorrow — ${formatWindowDate(windowDate)}`;

  const stepIndicator = isSundayCombined
    ? step === 'weekly'
      ? 'Step 1 of 2: Plan Your Week'
      : 'Step 2 of 2: Plan Monday'
    : null;

  // Group tasks by category for section headers
  const taskSections = step === 'weekly'
    ? [
        { label: 'Due This Week', tasks: tasks?.dueThisWeek || [] },
        { label: 'Overdue', tasks: tasks?.overdue || [] },
      ]
    : [
        { label: 'Due Tomorrow', tasks: tasks?.dueTomorrow || [] },
        { label: 'Overdue', tasks: tasks?.overdue || [] },
        { label: 'Available This Week', tasks: tasks?.undatedThisWeek || [] },
      ];

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-[1px]" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="mx-auto flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-card shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              {stepIndicator && (
                <p className="mb-1 text-xs font-medium text-muted-foreground">{stepIndicator}</p>
              )}
              <DialogTitle className="text-lg font-semibold text-foreground">
                {title}
              </DialogTitle>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
              aria-label="Close"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          {/* Task list */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {taskSections.map((section) => {
              if (section.tasks.length === 0) return null;
              return (
                <div key={section.label} className="mb-6">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {section.label} ({section.tasks.length})
                  </h3>
                  <div className="space-y-2">
                    {section.tasks.map((task) => (
                      <PlanningTaskRow
                        key={task.id}
                        task={task}
                        mode={step === 'weekly' ? 'weekly' : 'daily'}
                        sectionCounts={sectionCounts}
                        onAssign={handleAssign}
                        onSkip={handleSkip}
                        onDefer={handleDefer}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            {currentTasks.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No tasks to plan. You're all set!
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-muted"
            >
              Do This Later
            </button>
            <button
              type="button"
              onClick={handleFinish}
              disabled={isSubmitting}
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {isSubmitting
                ? 'Saving…'
                : isSundayCombined && step === 'weekly'
                  ? 'Next: Plan Monday →'
                  : 'Finish Planning'}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/planning/PlanningModal.jsx
git commit -m "feat: add PlanningModal component with daily/weekly/combined flows"
```

---

## Task 11: PlanningBanner Component

**Files:**
- Create: `src/components/planning/PlanningBanner.jsx`

- [ ] **Step 1: Create the banner component**

```jsx
'use client';

import { XMarkIcon } from '@heroicons/react/24/outline';
import { useState } from 'react';

export default function PlanningBanner({
  isPlanned,
  hasNewTasks,
  totalCandidates,
  windowType,
  onPlanNow,
}) {
  const [isDismissed, setIsDismissed] = useState(false);

  if (isDismissed) return null;

  const isDaily = windowType === 'daily';
  const timeLabel = isDaily ? 'tomorrow' : 'this week';

  // Not yet planned or new tasks arrived
  if (!isPlanned || hasNewTasks) {
    const count = totalCandidates;
    const message = hasNewTasks
      ? `${count} new task${count !== 1 ? 's' : ''} due ${timeLabel}`
      : `You have ${count} task${count !== 1 ? 's' : ''} due ${timeLabel}`;

    return (
      <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm">
        <span className="text-blue-800">{message}</span>
        <button
          type="button"
          onClick={onPlanNow}
          className="ml-4 rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
        >
          Plan now
        </button>
      </div>
    );
  }

  // Already planned
  const plannedMessage = isDaily ? "Tomorrow's planned" : 'Week planned';
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 px-4 py-2.5 text-sm">
      <span className="text-muted-foreground">{plannedMessage}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPlanNow}
          className="text-xs text-muted-foreground underline hover:text-foreground"
        >
          Revisit
        </button>
        <button
          type="button"
          onClick={() => setIsDismissed(true)}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted"
          aria-label="Dismiss"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/planning/PlanningBanner.jsx
git commit -m "feat: add PlanningBanner component"
```

---

## Task 12: Mount in AppShell + View Invalidation

**Files:**
- Modify: `src/components/layout/AppShell.jsx`

- [ ] **Step 1: Add `/calendar` to TAB_ROUTES and mount planning components**

Update `AppShell.jsx` to import and render the planning components:

```jsx
'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { TabBar } from './TabBar';
import QuickCapture from '@/components/shared/QuickCapture';
import { usePlanningPrompt } from '@/hooks/usePlanningPrompt';
import PlanningModal from '@/components/planning/PlanningModal';
import PlanningBanner from '@/components/planning/PlanningBanner';

const TAB_ROUTES = ['/today', '/plan', '/projects', '/ideas', '/calendar'];
const PLANNING_BANNER_ROUTES = ['/today', '/plan', '/calendar'];

export default function AppShell({ children }) {
  const pathname = usePathname();
  const isAuthRoute = pathname === '/login';
  const isTabRoute = TAB_ROUTES.some(
    (route) => pathname === route || pathname?.startsWith(route + '/')
  );
  const showPlanningBanner = PLANNING_BANNER_ROUTES.some(
    (route) => pathname === route || pathname?.startsWith(route + '/')
  );
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const planning = usePlanningPrompt();

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isMobileMenuOpen) {
      return undefined;
    }

    const originalOverflow = document.body.style.overflow;
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsMobileMenuOpen(false);
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleEscape);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isMobileMenuOpen]);

  if (isAuthRoute) {
    return (
      <div className="min-h-screen bg-background text-foreground font-sans antialiased">
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      <Sidebar
        isMobileMenuOpen={isMobileMenuOpen}
        onCloseMobileMenu={() => setIsMobileMenuOpen(false)}
      />
      {isMobileMenuOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}
      <Header
        isMobileMenuOpen={isMobileMenuOpen}
        onToggleMobileMenu={() => setIsMobileMenuOpen((open) => !open)}
      />
      <main className="min-h-screen pl-0 pt-14 lg:pl-[240px]">
        {isTabRoute && <TabBar />}
        <div className={isTabRoute ? 'w-full p-4 sm:p-6 pb-20 lg:pb-6' : 'w-full p-4 sm:p-6'}>
          {showPlanningBanner && planning.isActive && !planning.isLoading && planning.totalCandidates > 0 && (
            <div className="mb-4">
              <PlanningBanner
                isPlanned={planning.isPlanned}
                hasNewTasks={planning.hasNewTasks}
                totalCandidates={planning.totalCandidates}
                windowType={planning.windowType}
                onPlanNow={planning.openModal}
              />
            </div>
          )}
          {children}
        </div>
      </main>
      {isTabRoute && <QuickCapture />}

      {/* Planning Modal — renders above all content */}
      {planning.isActive && !planning.isLoading && (
        <PlanningModal
          isOpen={planning.showModal}
          onClose={planning.closeModal}
          onComplete={planning.onPlanningComplete}
          windowType={planning.windowType}
          windowDate={planning.windowDate}
          tasks={planning.tasks}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add `planning-complete` event listener to views**

In each of `TodayView.jsx`, `PlanBoard.jsx`, and `CalendarView.jsx`, add an event listener inside the existing `useEffect` that loads data. Find the data-loading function (e.g. `loadTasks`, the anonymous async function inside `useEffect`) and add:

```js
// Listen for planning completion to refetch
const handlePlanningComplete = () => {
  // Call the same loadTasks/fetchData function that runs on mount
  loadData();
};
window.addEventListener('planning-complete', handlePlanningComplete);
return () => {
  window.removeEventListener('planning-complete', handlePlanningComplete);
};
```

Add this inside the `useEffect` that fetches task data in each view. The exact function name varies per view — use whatever the existing load function is called in that view.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/AppShell.jsx src/components/today/TodayView.jsx src/components/plan/PlanBoard.jsx src/components/calendar/CalendarView.jsx
git commit -m "feat: mount planning modal and banner in AppShell, add view invalidation"
```

---

## Task 13: Planning Settings Page

**Files:**
- Create: `src/app/settings/planning/page.js`
- Create: `src/app/settings/planning/PlanningSettingsClient.jsx`
- Modify: `src/components/layout/Sidebar.jsx`

- [ ] **Step 1: Create settings page wrapper**

Create `src/app/settings/planning/page.js`:

```js
import { Suspense } from 'react';
import PlanningSettingsClient from './PlanningSettingsClient';

export default function PlanningSettingsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
      <PlanningSettingsClient />
    </Suspense>
  );
}
```

- [ ] **Step 2: Create settings client component**

Create `src/app/settings/planning/PlanningSettingsClient.jsx`:

```jsx
'use client';

import { useState, useEffect } from 'react';
import apiClient from '@/lib/apiClient';

export default function PlanningSettingsClient() {
  const [settings, setSettings] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const data = await apiClient.getUserSettings();
        setSettings(data);
      } catch (err) {
        setError('Failed to load settings');
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const updated = await apiClient.updateUserSettings(settings);
      setSettings(updated);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading settings…</div>;
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-1 text-xl font-semibold text-foreground">Planning Prompts</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Configure when daily and weekly planning prompts appear.
      </p>

      <form onSubmit={handleSave} className="space-y-6">
        <fieldset className="rounded-lg border border-border p-4">
          <legend className="px-2 text-sm font-medium text-foreground">Daily Planning Window</legend>
          <div className="mt-2 grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs text-muted-foreground">Start time</span>
              <input
                type="time"
                value={settings?.daily_plan_start || '20:05'}
                onChange={(e) => setSettings({ ...settings, daily_plan_start: e.target.value })}
                className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">End time (next day)</span>
              <input
                type="time"
                value={settings?.daily_plan_end || '20:00'}
                onChange={(e) => setSettings({ ...settings, daily_plan_end: e.target.value })}
                className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
              />
            </label>
          </div>
        </fieldset>

        <fieldset className="rounded-lg border border-border p-4">
          <legend className="px-2 text-sm font-medium text-foreground">Weekly Planning Window</legend>
          <div className="mt-2 grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs text-muted-foreground">Start time (Sunday)</span>
              <input
                type="time"
                value={settings?.weekly_plan_start || '20:05'}
                onChange={(e) => setSettings({ ...settings, weekly_plan_start: e.target.value })}
                className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">End time (next Sunday)</span>
              <input
                type="time"
                value={settings?.weekly_plan_end || '20:00'}
                onChange={(e) => setSettings({ ...settings, weekly_plan_end: e.target.value })}
                className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
              />
            </label>
          </div>
        </fieldset>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-600">Settings saved!</p>}

        <button
          type="submit"
          disabled={isSaving}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
        >
          {isSaving ? 'Saving…' : 'Save Settings'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Add Planning settings link to Sidebar**

In `src/components/layout/Sidebar.jsx`, find the Settings/Integrations nav link and add a Planning link alongside it. Look for the section that links to `/settings/integrations` and add:

```jsx
{ name: 'Planning', href: '/settings/planning', icon: ClockIcon }
```

Import `ClockIcon` from `@heroicons/react/24/outline` if not already imported.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings/planning/page.js src/app/settings/planning/PlanningSettingsClient.jsx src/components/layout/Sidebar.jsx
git commit -m "feat: add planning settings page with time configuration"
```

---

## Task 14: Manual Integration Testing

- [ ] **Step 1: Start dev server**

Run: `npm run dev`

- [ ] **Step 2: Test planning candidates API**

Open browser console or use curl:
```bash
curl -s 'http://localhost:3000/api/planning-candidates?windowType=daily&windowDate=2026-04-15' -H 'Cookie: <session cookie>'
```

Verify: returns `{ data: { dueTomorrow: [...], overdue: [...], undatedThisWeek: [...] } }` with correct task filtering.

- [ ] **Step 3: Test planning sessions API**

```bash
# Check no session exists
curl -s 'http://localhost:3000/api/planning-sessions?windowType=daily&windowDate=2026-04-15' -H 'Cookie: <session cookie>'
# Should return { data: null }

# Create a session
curl -s -X POST 'http://localhost:3000/api/planning-sessions' -H 'Content-Type: application/json' -H 'Cookie: <session cookie>' -d '{"windowType":"daily","windowDate":"2026-04-15"}'
# Should return { data: { id: ..., ... } }
```

- [ ] **Step 4: Test user settings API**

```bash
# Get defaults
curl -s 'http://localhost:3000/api/user-settings' -H 'Cookie: <session cookie>'
# Should return default times

# Update
curl -s -X PATCH 'http://localhost:3000/api/user-settings' -H 'Content-Type: application/json' -H 'Cookie: <session cookie>' -d '{"daily_plan_start":"19:00"}'
```

- [ ] **Step 5: Test the planning modal**

To test the modal without waiting until 20:05, temporarily change `PLANNING_DEFAULTS.DAILY_START` in `src/lib/constants.js` to a time a few minutes from now. Then:
1. Open the app — modal should appear if there are tasks due tomorrow
2. Assign tasks to sections — verify they move to Today view
3. Click "Finish Planning" — verify session is recorded
4. Close and reopen — banner should show "planned" state
5. Revert the temporary time change

- [ ] **Step 6: Test settings page**

Navigate to `/settings/planning`. Verify:
1. Default times are shown
2. Changing times and saving works
3. Invalid times are rejected

- [ ] **Step 7: Run verification pipeline**

```bash
npm run lint && npm run build
```

Expected: Zero errors, zero warnings, clean build.

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "test: verify smart planning prompts integration"
```
