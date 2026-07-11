import { describe, it, expect } from 'vitest';
import { buildDigestEmail, buildDailyTaskEmail } from '../dailyTaskEmailService';

// A4 — proposal-style morning digest. These tests exercise the PURE builder
// (buildDigestEmail) and the route-facing adapter (buildDailyTaskEmail) with
// hand-built data structures. No Supabase, no Graph — nothing is ever sent.

const TODAY = '2026-07-10';
const TZ = 'Europe/London';
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
    projects: overrides.projects ?? { name: overrides.projectName || 'Project X' },
    ...overrides,
  };
}

function baseData(overrides = {}) {
  return {
    todayDateKey: TODAY,
    timeZone: TZ,
    dashboardUrl: DASHBOARD,
    todayBySection: { must_do: [], good_to_do: [], quick_wins: [] },
    carried: { mustDoCarried: 0, thisWeekCarried: 0 },
    decisions: {
      inbox: [],
      snoozedToday: [],
      overdue: [],
      overCapSections: [],
      staleWaiting: [],
      thriceSnoozed: [],
      carried3Days: [],
    },
    ideas: [],
    ...overrides,
  };
}

describe('buildDigestEmail — decision dedup', () => {
  it('lists and counts a task matching multiple lenses only once (highest precedence)', () => {
    const shared = task({ id: 'dup-1', name: 'Chase invoice', state: 'this_week', today_section: null, due_date: '2026-07-01' });
    const email = buildDigestEmail(baseData({
      decisions: {
        inbox: [],
        snoozedToday: [{ ...shared }],   // also matches overdue below
        overdue: [{ ...shared }],
        overCapSections: [],
        staleWaiting: [],
        thriceSnoozed: [{ ...shared }],  // and thrice-snoozed
        carried3Days: [],
      },
    }));
    expect(email).not.toBeNull();
    // Appears once across the whole "Needs a decision" block...
    const occurrences = email.text.split('Chase invoice').length - 1;
    expect(occurrences).toBe(1);
    // ...and the headline count treats it as a single decision.
    expect(email.text).toContain('NEEDS A DECISION (1)');
  });
});

describe('buildDigestEmail — empty state', () => {
  it('returns null when there is nothing to send', () => {
    expect(buildDigestEmail(baseData())).toBeNull();
  });

  it('sends when only ideas are due for review', () => {
    const email = buildDigestEmail(baseData({ ideas: [{ title: 'Rethink onboarding', area: 'Growth' }] }));
    expect(email).not.toBeNull();
    expect(email.subject).toContain('1 idea to revisit');
    expect(email.text).toContain('Rethink onboarding');
  });

  it('sends when only This Week carried items exist (no today tasks)', () => {
    const email = buildDigestEmail(baseData({ carried: { mustDoCarried: 0, thisWeekCarried: 2 } }));
    expect(email).not.toBeNull();
    expect(email.text).toContain('2 items currently carried in This Week');
  });
});

describe('buildDigestEmail — Your day section', () => {
  it('renders all three sections including undated tasks with project and chips', () => {
    const email = buildDigestEmail(baseData({
      todayBySection: {
        must_do: [task({ name: 'Ship release', today_section: 'must_do', chips: ['urgent'], projectName: 'Launch' })],
        good_to_do: [task({ name: 'Review PR', today_section: 'good_to_do' })],
        quick_wins: [task({ name: 'Reply to Sam', today_section: 'quick_wins', due_date: null })],
      },
    }));
    expect(email.text).toContain('Must Do (1)');
    expect(email.text).toContain('Good to Do (1)');
    expect(email.text).toContain('Quick Wins (1)');
    expect(email.text).toContain('Ship release (Launch) — Urgent');
    expect(email.text).toContain('Reply to Sam (Project X)');
    expect(email.html).toContain('Your day (3)');
    expect(email.html).toContain('[Urgent]');
  });

  it('orders tasks within a section by the F1 priority comparator', () => {
    // blocks_others outranks urgent, so B renders before A despite input order.
    const email = buildDigestEmail(baseData({
      todayBySection: {
        must_do: [
          task({ id: 'a', name: 'Task A', today_section: 'must_do', chips: ['urgent'] }),
          task({ id: 'b', name: 'Task B', today_section: 'must_do', chips: ['blocks_others'] }),
        ],
        good_to_do: [],
        quick_wins: [],
      },
    }));
    expect(email.text.indexOf('Task B')).toBeLessThan(email.text.indexOf('Task A'));
  });

  it('omits empty Today subsections cleanly', () => {
    const email = buildDigestEmail(baseData({
      todayBySection: {
        must_do: [task({ name: 'Only must do', today_section: 'must_do' })],
        good_to_do: [],
        quick_wins: [],
      },
    }));
    expect(email.text).toContain('Must Do (1)');
    expect(email.text).not.toContain('Good to Do');
    expect(email.text).not.toContain('Quick Wins');
  });
});

describe('buildDigestEmail — Needs a decision section', () => {
  it('renders each exception group with its label', () => {
    const email = buildDigestEmail(baseData({
      decisions: {
        inbox: [task({ name: 'Captured note', state: 'backlog', today_section: null })],
        snoozedToday: [task({ name: 'Snoozed back', state: 'this_week', today_section: null })],
        overdue: [task({ name: 'Late thing', state: 'this_week', today_section: null, due_date: '2026-07-01' })],
        overCapSections: [{ section: 'must_do', count: 7, cap: 5 }],
        staleWaiting: [task({ name: 'Waiting reply', state: 'waiting', today_section: null })],
        thriceSnoozed: [task({ name: 'Thrice deferred', state: 'backlog', today_section: null })],
        carried3Days: [task({ name: 'Carried task', today_section: 'must_do' })],
      },
    }));
    expect(email.text).toContain('Inbox — awaiting triage');
    expect(email.text).toContain('Snooze returns today');
    expect(email.text).toContain('Overdue');
    expect(email.text).toContain('Late thing (Project X) — due');
    expect(email.text).toContain('Over capacity');
    expect(email.text).toContain('Must Do: 7 (cap 5)');
    expect(email.text).toContain('Waiting — needs a chase');
    expect(email.text).toContain('Snoozed 3+ times — decide');
    expect(email.text).toContain('Carried 3+ days — still today?');
  });

  it('truncates a long sub-list with "+N more"', () => {
    const inbox = Array.from({ length: 7 }, (_, i) =>
      task({ id: `inbox-${i}`, name: `Inbox ${i}`, state: 'backlog', today_section: null })
    );
    const email = buildDigestEmail(baseData({ decisions: { ...baseData().decisions, inbox } }));
    expect(email.text).toContain('Inbox — awaiting triage (7)');
    expect(email.text).toContain('+2 more'); // cap is 5
    expect(email.html).toContain('<li>+2 more</li>');
  });

  it('omits the whole Needs a decision section when empty', () => {
    const email = buildDigestEmail(baseData({
      todayBySection: { must_do: [task({ name: 'x', today_section: 'must_do' })], good_to_do: [], quick_wins: [] },
    }));
    expect(email.text).not.toContain('NEEDS A DECISION');
  });
});

describe('buildDigestEmail — Ideas + carried-forward', () => {
  it('renders the carried-forward summary line', () => {
    const email = buildDigestEmail(baseData({
      todayBySection: { must_do: [task({ name: 'x', today_section: 'must_do' })], good_to_do: [], quick_wins: [] },
      carried: { mustDoCarried: 2, thisWeekCarried: 3 },
    }));
    expect(email.text).toContain('Carried forward: 2 Must Do carried from yesterday; 3 items currently carried in This Week.');
  });

  it('truncates ideas beyond the cap', () => {
    const ideas = Array.from({ length: 6 }, (_, i) => ({ title: `Idea ${i}`, area: 'Area' }));
    const email = buildDigestEmail(baseData({ ideas }));
    expect(email.text).toContain('Ideas to revisit'.toUpperCase());
    expect(email.text).toContain('+1 more');
  });

  it('omits ideas section when there are no ideas', () => {
    const email = buildDigestEmail(baseData({
      todayBySection: { must_do: [task({ name: 'x', today_section: 'must_do' })], good_to_do: [], quick_wins: [] },
    }));
    expect(email.text).not.toContain('IDEAS TO REVISIT');
  });
});

describe('buildDigestEmail — subject counts', () => {
  it('reflects today count and decision count', () => {
    const email = buildDigestEmail(baseData({
      todayBySection: {
        must_do: [task({ name: 'a', today_section: 'must_do' }), task({ name: 'b', today_section: 'must_do' })],
        good_to_do: [],
        quick_wins: [task({ name: 'c', today_section: 'quick_wins' })],
      },
      decisions: {
        ...baseData().decisions,
        inbox: [task({ name: 'i1', state: 'backlog', today_section: null })],
        overdue: [task({ name: 'o1', state: 'this_week', today_section: null, due_date: '2026-07-01' })],
      },
    }));
    expect(email.subject).toBe('Planner: 3 tasks today, 2 to decide (Fri, 10 Jul 2026)');
  });

  it('uses singular "task" for a single today item', () => {
    const email = buildDigestEmail(baseData({
      todayBySection: { must_do: [task({ name: 'a', today_section: 'must_do' })], good_to_do: [], quick_wins: [] },
    }));
    expect(email.subject).toContain('1 task today');
  });
});

describe('buildDigestEmail — HTML escaping', () => {
  it('escapes task and project names', () => {
    const email = buildDigestEmail(baseData({
      todayBySection: {
        must_do: [task({ name: '<script>alert(1)</script>', today_section: 'must_do', projectName: 'A & B' })],
        good_to_do: [],
        quick_wins: [],
      },
    }));
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(email.html).toContain('A &amp; B');
    expect(email.html).not.toContain('<script>alert(1)</script>');
  });

  it('escapes idea titles and areas', () => {
    const email = buildDigestEmail(baseData({ ideas: [{ title: 'Idea <b>bold</b>', area: 'R&D' }] }));
    expect(email.html).toContain('Idea &lt;b&gt;bold&lt;/b&gt;');
    expect(email.html).toContain('R&amp;D');
  });
});

describe('buildDigestEmail — Projects needing a next action (Wave 5)', () => {
  function stalledProject(overrides = {}) {
    return {
      projectId: overrides.projectId || Math.random().toString(36).slice(2),
      name: overrides.name || 'A project',
      area: overrides.area ?? null,
      lastActivityAt: overrides.lastActivityAt ?? '2026-07-01T00:00:00Z',
      stalled: true,
      ...overrides,
    };
  }

  it('renders the stalled-projects section with name, area and last-touched', () => {
    const email = buildDigestEmail(baseData({
      stalledProjects: [
        stalledProject({ name: 'Website revamp', area: 'Growth', lastActivityAt: '2026-06-20T00:00:00Z' }),
      ],
    }));
    expect(email).not.toBeNull();
    expect(email.text).toContain('PROJECTS NEEDING A NEXT ACTION (1)');
    expect(email.text).toContain('Website revamp (Growth) — last touched');
    expect(email.html).toContain('Projects needing a next action (1)');
    expect(email.html).toContain('Website revamp');
  });

  it('sends when the ONLY content is stalled projects (null-guard)', () => {
    const email = buildDigestEmail(baseData({
      stalledProjects: [stalledProject({ name: 'Lonely project' })],
    }));
    expect(email).not.toBeNull();
    expect(email.text).toContain('Lonely project');
  });

  it('omits the stalled-projects section when there are none', () => {
    const email = buildDigestEmail(baseData({
      todayBySection: { must_do: [task({ name: 'x', today_section: 'must_do' })], good_to_do: [], quick_wins: [] },
      stalledProjects: [],
    }));
    expect(email.text).not.toContain('PROJECTS NEEDING A NEXT ACTION');
    expect(email.html).not.toContain('Projects needing a next action');
  });

  it('truncates a long stalled-projects list with "+N more"', () => {
    const stalledProjects = Array.from({ length: 7 }, (_, i) =>
      stalledProject({ projectId: `p-${i}`, name: `Project ${i}` })
    );
    const email = buildDigestEmail(baseData({ stalledProjects }));
    expect(email.text).toContain('PROJECTS NEEDING A NEXT ACTION (7)');
    expect(email.text).toContain('+2 more'); // cap is 5
    expect(email.html).toContain('<li>+2 more</li>');
  });

  it('escapes stalled-project names and areas', () => {
    const email = buildDigestEmail(baseData({
      stalledProjects: [stalledProject({ name: '<b>Proj</b>', area: 'R&D' })],
    }));
    expect(email.html).toContain('&lt;b&gt;Proj&lt;/b&gt;');
    expect(email.html).toContain('R&amp;D');
    expect(email.html).not.toContain('<b>Proj</b>');
  });
});

describe('buildDailyTaskEmail — route-facing adapter', () => {
  it('renders the assembled digest passed by fetchOutstandingTasks', () => {
    const digest = {
      todayDateKey: TODAY,
      todayBySection: {
        must_do: [task({ name: 'Ship it', today_section: 'must_do' })],
        good_to_do: [],
        quick_wins: [],
      },
      carried: { mustDoCarried: 0, thisWeekCarried: 0 },
      decisions: {
        inbox: [], snoozedToday: [], overdue: [], overCapSections: [],
        staleWaiting: [], thriceSnoozed: [], carried3Days: [],
      },
      ideas: [],
    };

    const email = buildDailyTaskEmail({
      todayDateKey: TODAY,
      digest,
      // dueToday/overdue are still forwarded for the run-tracking counts, but the
      // digest is what renders — pass a deliberately different array to prove the
      // digest (not the legacy fallback) is used.
      dueToday: [task({ name: 'IGNORED legacy row', today_section: 'quick_wins' })],
      overdue: [],
      inboxCount: 0,
      dashboardUrl: DASHBOARD,
      timeZone: TZ,
    });
    expect(email).not.toBeNull();
    expect(email.text).toContain('Ship it (Project X)');
    expect(email.text).not.toContain('IGNORED legacy row');
    expect(email.subject).toContain('1 task today');
  });

  it('falls back to a degraded brief from plain arrays when no digest is attached', () => {
    const email = buildDailyTaskEmail({
      todayDateKey: TODAY,
      dueToday: [task({ name: 'Plain today', today_section: 'good_to_do' })],
      overdue: [task({ name: 'Plain overdue', state: 'this_week', today_section: null, due_date: '2026-07-01' })],
      inboxCount: 0,
      dashboardUrl: DASHBOARD,
      timeZone: TZ,
    });
    expect(email.text).toContain('Plain today (Project X)');
    expect(email.text).toContain('Plain overdue');
  });
});
