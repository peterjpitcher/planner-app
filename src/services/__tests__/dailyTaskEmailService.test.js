import { describe, it, expect } from 'vitest';
import { buildDailyTaskEmail, fetchOutstandingTasks } from '../dailyTaskEmailService';

// The morning email, simple and to the point since 29 Sep 2026: today's plan and
// overdue tasks, nothing else. The builder is pure, so these tests pass plain
// arrays. Nothing is ever sent.

const TODAY = '2026-09-29'; // a Tuesday
const TZ = 'Europe/London';
// Month abbreviations come from the runtime's ICU data: newer builds write "Sept"
// for September, older ones "Sep", so date assertions accept either.
const DASHBOARD = 'https://planner.example.com';

function task(overrides = {}) {
  return {
    id: overrides.id || Math.random().toString(36).slice(2),
    name: overrides.name || 'A task',
    due_date: overrides.due_date ?? null,
    state: overrides.state || 'today',
    today_section: overrides.today_section ?? null,
    chips: overrides.chips ?? null,
    entered_state_at: overrides.entered_state_at ?? null,
    created_at: overrides.created_at ?? null,
    sort_order: overrides.sort_order ?? null,
    projects: 'projectName' in overrides ? { name: overrides.projectName } : null,
    ...overrides,
  };
}

function build({ dueToday = [], overdue = [] } = {}) {
  return buildDailyTaskEmail({
    todayDateKey: TODAY,
    timeZone: TZ,
    dashboardUrl: DASHBOARD,
    dueToday,
    overdue,
  });
}

function overdueTask(n) {
  return task({ id: `o${n}`, name: `Late ${n}`, state: 'backlog', due_date: `2026-09-${String(10 + n).padStart(2, '0')}` });
}

describe('morning email: when it sends', () => {
  it('returns null when nothing is planned and nothing is overdue', () => {
    expect(build()).toBeNull();
  });

  it('sends when only overdue tasks exist', () => {
    const email = build({ overdue: [overdueTask(1)] });
    expect(email.subject).toMatch(/^Planner: 1 overdue \(Tue 29 Sept?\)$/);
    expect(email.text).toContain('OVERDUE (1)');
  });
});

describe('morning email: subject', () => {
  it('counts today and overdue, with the date so days do not thread together', () => {
    const email = build({
      dueToday: [
        task({ name: 'A', today_section: 'must_do' }),
        task({ name: 'B', today_section: 'quick_wins' }),
      ],
      overdue: [overdueTask(1), overdueTask(2)],
    });
    expect(email.subject).toMatch(/^Planner: 2 tasks today, 2 overdue \(Tue 29 Sept?\)$/);
  });

  it('uses the singular for one task', () => {
    const email = build({ dueToday: [task({ name: 'A', today_section: 'must_do' })] });
    expect(email.subject).toMatch(/^Planner: 1 task today \(Tue 29 Sept?\)$/);
  });
});

describe("morning email: today's plan", () => {
  it('lists Must Do first, then Good to Do and Quick Wins under "Also today"', () => {
    const email = build({
      dueToday: [
        task({ name: 'Quick one', today_section: 'quick_wins' }),
        task({ name: 'Nice to have', today_section: 'good_to_do' }),
        task({ name: 'Ship release', today_section: 'must_do', projectName: 'Launch' }),
      ],
    });
    const lines = email.text.split('\n');
    expect(lines.slice(0, 6)).toEqual([
      'MUST DO',
      '- Ship release (Launch)',
      '',
      'ALSO TODAY',
      '- Nice to have',
      '- Quick one',
    ]);
    expect(email.html).toContain('<strong>Must Do</strong>');
    expect(email.html).toContain('<strong>Also today</strong>');
  });

  it('heads the list "Today" when there is no Must Do', () => {
    const email = build({ dueToday: [task({ name: 'Nice to have', today_section: 'good_to_do' })] });
    expect(email.text.startsWith('TODAY\n- Nice to have')).toBe(true);
    expect(email.text).not.toContain('ALSO TODAY');
  });

  it('orders tasks within a section by the F1 priority comparator', () => {
    // blocks_others outranks urgent, so B comes before A despite input order.
    const email = build({
      dueToday: [
        task({ id: 'a', name: 'Task A', today_section: 'must_do', chips: ['urgent'] }),
        task({ id: 'b', name: 'Task B', today_section: 'must_do', chips: ['blocks_others'] }),
      ],
    });
    expect(email.text.indexOf('Task B')).toBeLessThan(email.text.indexOf('Task A'));
  });

  it('shows no chips and no placeholder for a task without a project', () => {
    const email = build({ dueToday: [task({ name: 'Solo', today_section: 'must_do', chips: ['urgent'] })] });
    expect(email.text).toContain('- Solo\n');
    expect(email.text).not.toContain('Urgent');
    expect(email.text).not.toContain('Unassigned');
  });
});

describe('morning email: overdue', () => {
  it('shows the five most recently due, newest first, then a count of the rest', () => {
    // Passed oldest first (due 11 to 18 Sep) to prove the builder reorders.
    const overdue = Array.from({ length: 8 }, (_, i) => overdueTask(i + 1));
    const email = build({ overdue });
    expect(email.text).toContain('OVERDUE (8)');
    expect(email.text).toMatch(/- Late 8, due Fri 18 Sept?\n/);
    expect(email.text).toMatch(/- Late 4, due Mon 14 Sept?\n/);
    expect(email.text.indexOf('Late 8')).toBeLessThan(email.text.indexOf('Late 4'));
    for (const hidden of ['Late 1', 'Late 2', 'Late 3']) expect(email.text).not.toContain(hidden);
    expect(email.text).toContain('- and 3 more in Planner');
    expect(email.html).toContain('and 3 more in Planner');
  });

  it('lists tasks due the same day in the order they were created', () => {
    const email = build({
      overdue: [
        task({ name: 'Second', state: 'backlog', due_date: '2026-09-20', created_at: '2026-09-02T09:00:00Z' }),
        task({ name: 'First', state: 'backlog', due_date: '2026-09-20', created_at: '2026-09-01T09:00:00Z' }),
      ],
    });
    expect(email.text.indexOf('First')).toBeLessThan(email.text.indexOf('Second'));
  });

  it('writes single-digit days without a leading zero', () => {
    const email = build({ overdue: [task({ name: 'Early', state: 'backlog', due_date: '2026-09-04' })] });
    expect(email.text).toMatch(/- Early, due Fri 4 Sept?\n/);
  });

  it('has no "more" line when everything fits', () => {
    const email = build({ overdue: [overdueTask(1), overdueTask(2)] });
    expect(email.text).not.toContain('more in Planner');
  });
});

describe('morning email: stays short', () => {
  it('carries only the plan, overdue and one link', () => {
    const email = build({
      dueToday: [task({ name: 'A', today_section: 'must_do', carried_count: 4, chips: ['urgent'] })],
      overdue: [overdueTask(1)],
    });
    for (const gone of ['Needs a decision', 'Carried', 'Ideas', 'Inbox', 'Snooze', 'Waiting', 'Confirm', 'Projects needing', '/api/actions/']) {
      expect(email.text).not.toContain(gone);
      expect(email.html).not.toContain(gone);
    }
    expect(email.text.endsWith(`Open Planner: ${DASHBOARD}/dashboard`)).toBe(true);
    expect(email.html).toContain(`<a href="${DASHBOARD}/dashboard">Open Planner</a>`);
  });

  it('renders no undefined, NaN, Invalid Date or em dash from fixture data', () => {
    const email = build({
      dueToday: [
        task({ name: 'A', today_section: 'must_do', projectName: 'P' }),
        task({ name: 'B', today_section: 'good_to_do' }),
      ],
      overdue: Array.from({ length: 7 }, (_, i) => overdueTask(i + 1)),
    });
    for (const part of [email.subject, email.text, email.html]) {
      expect(part).not.toMatch(/undefined|NaN|Invalid Date|null/);
      expect(part).not.toContain(String.fromCharCode(0x2014));
    }
  });
});

describe('morning email: HTML escaping', () => {
  it('escapes task and project names', () => {
    const email = build({
      dueToday: [task({ name: '<script>x</script>', today_section: 'must_do', projectName: 'A & B' })],
    });
    expect(email.html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(email.html).toContain('A &amp; B');
    expect(email.html).not.toContain('<script>');
  });
});

// A minimal PostgREST stand-in: each query resolves to whatever `resolve`
// returns for its filters.
function fakeSupabase(resolve) {
  return {
    from() {
      const filters = {};
      const query = {
        select() { return query; },
        eq(key, value) { filters[key] = value; return query; },
        lt(key, value) { filters[`${key}<`] = value; return query; },
        not() { return query; },
        or() { return query; },
        order() { return query; },
        then(onFulfilled, onRejected) {
          return Promise.resolve(resolve(filters)).then(onFulfilled, onRejected);
        },
      };
      return query;
    },
  };
}

describe('fetchOutstandingTasks', () => {
  it('returns the Today tasks and the overdue tasks', async () => {
    const supabase = fakeSupabase((filters) => (filters.state === 'today'
      ? { data: [{ id: 't1' }], error: null }
      : { data: [{ id: 'o1' }], error: null }));
    const result = await fetchOutstandingTasks({ supabase, userId: 'u1', todayDateKey: TODAY });
    expect(result).toEqual({ dueToday: [{ id: 't1' }], overdue: [{ id: 'o1' }] });
  });

  it('throws rather than send a partial email when the overdue query fails', async () => {
    const supabase = fakeSupabase((filters) => (filters.state === 'today'
      ? { data: [{ id: 't1' }], error: null }
      : { data: null, error: { message: 'boom' } }));
    await expect(fetchOutstandingTasks({ supabase, userId: 'u1', todayDateKey: TODAY }))
      .rejects.toThrow('Unable to fetch overdue tasks: boom');
  });
});
