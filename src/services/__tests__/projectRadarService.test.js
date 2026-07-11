import { describe, it, expect } from 'vitest';
import { buildProjectRadar } from '../projectRadarService';

// Wave 5 — project-altitude radar classification. These tests exercise the PURE
// builder with hand-built plain data (no Supabase, no IO). A "stalled" project
// is an Open project with no scheduled next action; On Hold is paused (never
// stalled); Completed/Cancelled are off the radar entirely.

const NOW_MS = Date.parse('2026-07-11T09:00:00Z');

function project(overrides = {}) {
  return {
    id: overrides.id || Math.random().toString(36).slice(2),
    name: overrides.name || 'A project',
    status: overrides.status || 'Open',
    area: overrides.area ?? null,
    due_date: overrides.due_date ?? null,
    updated_at: overrides.updated_at ?? '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

function task(overrides = {}) {
  return {
    project_id: overrides.project_id || null,
    state: overrides.state || 'backlog',
    due_date: overrides.due_date ?? null,
    follow_up_date: overrides.follow_up_date ?? null,
    updated_at: overrides.updated_at ?? '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

function byId(rows) {
  return Object.fromEntries(rows.map((r) => [r.projectId, r]));
}

describe('buildProjectRadar — stalled classification', () => {
  it('flags an Open project whose only tasks are undated backlog as stalled', () => {
    const rows = buildProjectRadar({
      projects: [project({ id: 'p1' })],
      tasksByProject: { p1: [task({ project_id: 'p1', state: 'backlog', due_date: null })] },
      nowMs: NOW_MS,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].stalled).toBe(true);
    expect(rows[0].hasNextAction).toBe(false);
    expect(rows[0].openTaskCount).toBe(1);
  });

  it('flags an Open project with no tasks at all as stalled', () => {
    const rows = buildProjectRadar({
      projects: [project({ id: 'p1' })],
      tasksByProject: {},
      nowMs: NOW_MS,
    });
    expect(rows[0].stalled).toBe(true);
    expect(rows[0].hasNextAction).toBe(false);
    expect(rows[0].openTaskCount).toBe(0);
  });

  it('flags an In Progress project with no scheduled task as stalled (active status)', () => {
    const rows = buildProjectRadar({
      projects: [project({ id: 'p1', status: 'In Progress' })],
      tasksByProject: { p1: [task({ project_id: 'p1', state: 'backlog', due_date: null })] },
      nowMs: NOW_MS,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].stalled).toBe(true);
    expect(rows[0].paused).toBe(false);
  });

  it('flags an Open project whose only task is waiting without a follow-up as stalled', () => {
    const rows = buildProjectRadar({
      projects: [project({ id: 'p1' })],
      tasksByProject: { p1: [task({ project_id: 'p1', state: 'waiting', follow_up_date: null })] },
      nowMs: NOW_MS,
    });
    expect(rows[0].stalled).toBe(true);
    expect(rows[0].hasNextAction).toBe(false);
  });
});

describe('buildProjectRadar — has a next action (not stalled)', () => {
  it('a today task counts as a next action', () => {
    const rows = buildProjectRadar({
      projects: [project({ id: 'p1' })],
      tasksByProject: { p1: [task({ project_id: 'p1', state: 'today' })] },
      nowMs: NOW_MS,
    });
    expect(rows[0].hasNextAction).toBe(true);
    expect(rows[0].stalled).toBe(false);
  });

  it('a this_week task counts as a next action', () => {
    const rows = buildProjectRadar({
      projects: [project({ id: 'p1' })],
      tasksByProject: { p1: [task({ project_id: 'p1', state: 'this_week' })] },
      nowMs: NOW_MS,
    });
    expect(rows[0].hasNextAction).toBe(true);
    expect(rows[0].stalled).toBe(false);
  });

  it('a dated backlog task counts as a next action', () => {
    const rows = buildProjectRadar({
      projects: [project({ id: 'p1' })],
      tasksByProject: { p1: [task({ project_id: 'p1', state: 'backlog', due_date: '2026-07-20' })] },
      nowMs: NOW_MS,
    });
    expect(rows[0].hasNextAction).toBe(true);
    expect(rows[0].stalled).toBe(false);
  });

  it('a waiting task WITH a follow-up date counts as a next action', () => {
    const rows = buildProjectRadar({
      projects: [project({ id: 'p1' })],
      tasksByProject: { p1: [task({ project_id: 'p1', state: 'waiting', follow_up_date: '2026-07-20' })] },
      nowMs: NOW_MS,
    });
    expect(rows[0].hasNextAction).toBe(true);
    expect(rows[0].stalled).toBe(false);
  });
});

describe('buildProjectRadar — status handling', () => {
  it('never marks an On Hold project stalled, and flags it paused', () => {
    const rows = buildProjectRadar({
      projects: [project({ id: 'p1', status: 'On Hold' })],
      tasksByProject: {}, // no next action, but paused → not stalled
      nowMs: NOW_MS,
    });
    expect(rows[0].stalled).toBe(false);
    expect(rows[0].paused).toBe(true);
  });

  it('marks an Open project paused=false', () => {
    const rows = buildProjectRadar({
      projects: [project({ id: 'p1', status: 'Open' })],
      tasksByProject: { p1: [task({ project_id: 'p1', state: 'today' })] },
      nowMs: NOW_MS,
    });
    expect(rows[0].paused).toBe(false);
  });

  it('excludes Completed and Cancelled projects entirely', () => {
    const rows = buildProjectRadar({
      projects: [
        project({ id: 'open', status: 'Open' }),
        project({ id: 'done', status: 'Completed' }),
        project({ id: 'cancelled', status: 'Cancelled' }),
      ],
      tasksByProject: {},
      nowMs: NOW_MS,
    });
    const ids = rows.map((r) => r.projectId);
    expect(ids).toContain('open');
    expect(ids).not.toContain('done');
    expect(ids).not.toContain('cancelled');
  });
});

describe('buildProjectRadar — derived fields', () => {
  it('computes lastActivityAt as the max of project and task updated_at', () => {
    const rows = buildProjectRadar({
      projects: [project({ id: 'p1', updated_at: '2026-07-01T00:00:00Z' })],
      tasksByProject: {
        p1: [
          task({ project_id: 'p1', updated_at: '2026-07-05T00:00:00Z' }),
          task({ project_id: 'p1', updated_at: '2026-07-08T12:00:00Z' }),
        ],
      },
      nowMs: NOW_MS,
    });
    expect(rows[0].lastActivityAt).toBe('2026-07-08T12:00:00Z');
  });

  it('falls back to project updated_at when it is the most recent', () => {
    const rows = buildProjectRadar({
      projects: [project({ id: 'p1', updated_at: '2026-07-10T00:00:00Z' })],
      tasksByProject: { p1: [task({ project_id: 'p1', updated_at: '2026-07-05T00:00:00Z' })] },
      nowMs: NOW_MS,
    });
    expect(rows[0].lastActivityAt).toBe('2026-07-10T00:00:00Z');
  });

  it('picks the earliest today-or-future due date as nextDueDate', () => {
    const rows = buildProjectRadar({
      projects: [project({ id: 'p1' })],
      tasksByProject: {
        p1: [
          task({ project_id: 'p1', state: 'backlog', due_date: '2026-07-25' }),
          task({ project_id: 'p1', state: 'backlog', due_date: '2026-07-15' }),
          task({ project_id: 'p1', state: 'backlog', due_date: '2026-07-30' }),
        ],
      },
      nowMs: NOW_MS,
    });
    expect(rows[0].nextDueDate).toBe('2026-07-15');
  });

  it('falls back to the earliest overdue due date when none are upcoming', () => {
    const rows = buildProjectRadar({
      projects: [project({ id: 'p1' })],
      tasksByProject: {
        p1: [
          task({ project_id: 'p1', state: 'backlog', due_date: '2026-07-02' }),
          task({ project_id: 'p1', state: 'backlog', due_date: '2026-07-05' }),
        ],
      },
      nowMs: NOW_MS,
    });
    expect(rows[0].nextDueDate).toBe('2026-07-02');
  });

  it('nextDueDate is null when no incomplete task has a due date', () => {
    const rows = buildProjectRadar({
      projects: [project({ id: 'p1' })],
      tasksByProject: { p1: [task({ project_id: 'p1', state: 'backlog', due_date: null })] },
      nowMs: NOW_MS,
    });
    expect(rows[0].nextDueDate).toBeNull();
  });

  it('surfaces the project due date and area', () => {
    const rows = buildProjectRadar({
      projects: [project({ id: 'p1', area: 'Growth', due_date: '2026-08-01' })],
      tasksByProject: {},
      nowMs: NOW_MS,
    });
    expect(rows[0].area).toBe('Growth');
    expect(rows[0].dueDate).toBe('2026-08-01');
  });

  it('ignores done tasks when counting and classifying', () => {
    const rows = buildProjectRadar({
      projects: [project({ id: 'p1' })],
      tasksByProject: {
        p1: [
          task({ project_id: 'p1', state: 'done', due_date: '2026-07-20' }),
          task({ project_id: 'p1', state: 'backlog', due_date: null }),
        ],
      },
      nowMs: NOW_MS,
    });
    // The dated task is done, so it does not create a next action.
    expect(rows[0].openTaskCount).toBe(1);
    expect(rows[0].hasNextAction).toBe(false);
    expect(rows[0].stalled).toBe(true);
  });
});

describe('buildProjectRadar — sort order', () => {
  it('sorts stalled first, then by lastActivityAt ascending (most-neglected first)', () => {
    const rows = buildProjectRadar({
      projects: [
        // active (not stalled), recently touched
        project({ id: 'active', status: 'Open', updated_at: '2026-07-10T00:00:00Z' }),
        // stalled, touched a week ago
        project({ id: 'stalledRecent', status: 'Open', updated_at: '2026-07-04T00:00:00Z' }),
        // stalled, touched long ago → most neglected
        project({ id: 'stalledOld', status: 'Open', updated_at: '2026-06-01T00:00:00Z' }),
      ],
      tasksByProject: {
        active: [task({ project_id: 'active', state: 'today' })],
        // stalled projects have no next action
      },
      nowMs: NOW_MS,
    });
    expect(rows.map((r) => r.projectId)).toEqual(['stalledOld', 'stalledRecent', 'active']);
  });

  it('treats a missing lastActivityAt as most-neglected within the stalled group', () => {
    const rows = buildProjectRadar({
      projects: [
        project({ id: 'hasDate', status: 'Open', updated_at: '2026-06-01T00:00:00Z' }),
        project({ id: 'noDate', status: 'Open', updated_at: null }),
      ],
      tasksByProject: {},
      nowMs: NOW_MS,
    });
    expect(rows.map((r) => r.projectId)).toEqual(['noDate', 'hasDate']);
  });
});
