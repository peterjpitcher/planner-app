import { describe, it, expect } from 'vitest';
import { countCandidates, countNewCandidates, hasCandidates } from '../planningCandidates';

const PLANNED_AT = '2026-08-24T20:30:00.000Z';

function task(id, createdAt) {
  return { id, created_at: createdAt };
}

describe('countCandidates', () => {
  it('counts tasks across every bucket', () => {
    expect(
      countCandidates({
        inbox: [task('a'), task('b')],
        overdue: [task('c')],
        dueTomorrow: [],
      })
    ).toBe(3);
  });

  it('ignores the non-array reviewBacklogTotal count', () => {
    expect(countCandidates({ reviewBacklog: [task('a')], reviewBacklogTotal: 87 })).toBe(1);
  });

  it('does not double count a task that appears in two buckets', () => {
    expect(countCandidates({ overdue: [task('a')], chaseDue: [task('a')] })).toBe(1);
  });

  it('handles a missing or empty payload', () => {
    expect(countCandidates(null)).toBe(0);
    expect(countCandidates(undefined)).toBe(0);
    expect(countCandidates({})).toBe(0);
  });
});

describe('hasCandidates', () => {
  it('is false when every bucket is empty', () => {
    expect(hasCandidates({ inbox: [], overdue: [], reviewBacklogTotal: 0 })).toBe(false);
  });

  it('is true when any bucket has a task', () => {
    expect(hasCandidates({ inbox: [], overdue: [task('a')] })).toBe(true);
  });
});

describe('countNewCandidates', () => {
  it('counts only tasks captured after the plan was made', () => {
    const candidates = {
      overdue: [task('old', '2026-08-20T09:00:00.000Z')],
      inbox: [
        task('new-1', '2026-08-24T21:00:00.000Z'),
        task('new-2', '2026-08-25T07:15:00.000Z'),
      ],
    };
    expect(countNewCandidates(candidates, PLANNED_AT)).toBe(2);
  });

  it('is zero when every leftover candidate predates the plan', () => {
    // The regression that prompted this: leftovers the user deliberately left
    // out of the plan must never be reported as new work to plan.
    const candidates = {
      overdue: [task('a', '2026-07-01T09:00:00.000Z')],
      reviewBacklog: [task('b', '2026-05-11T09:00:00.000Z')],
      undatedThisWeek: [task('c', '2026-08-24T18:00:00.000Z')],
      reviewBacklogTotal: 40,
    };
    expect(countNewCandidates(candidates, PLANNED_AT)).toBe(0);
  });

  it('treats a task created at exactly the planning moment as already planned', () => {
    expect(countNewCandidates({ inbox: [task('a', PLANNED_AT)] }, PLANNED_AT)).toBe(0);
  });

  it('returns zero when there is no session to compare against', () => {
    const candidates = { inbox: [task('a', '2026-08-25T07:15:00.000Z')] };
    expect(countNewCandidates(candidates, null)).toBe(0);
    expect(countNewCandidates(candidates, undefined)).toBe(0);
    expect(countNewCandidates(candidates, 'not-a-date')).toBe(0);
  });

  it('ignores tasks with no created_at rather than counting them as new', () => {
    expect(countNewCandidates({ inbox: [{ id: 'a' }] }, PLANNED_AT)).toBe(0);
  });

  it('does not double count a new task present in two buckets', () => {
    const fresh = task('a', '2026-08-25T07:15:00.000Z');
    expect(countNewCandidates({ inbox: [fresh], overdue: [fresh] }, PLANNED_AT)).toBe(1);
  });
});
