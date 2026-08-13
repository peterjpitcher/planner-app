import { describe, it, expect } from 'vitest';
import {
  STATE, TODAY_SECTION, TODAY_SECTION_ORDER, IDEA_STATE_ORDER,
  TASK_TYPE, CHIP_VALUES, IDEA_STATE, SOFT_CAPS,
  STALE_BACKLOG_DAYS, REVIEW_BACKLOG_CAP,
  CLOSED_STATES, ACTIVE_STATES, closedStatesFilter
} from '../constants';

describe('constants', () => {
  it('STATE has all 6 values', () => {
    expect(Object.values(STATE)).toEqual(['today', 'this_week', 'backlog', 'waiting', 'done', 'cancelled']);
  });

  it('CLOSED_STATES and ACTIVE_STATES partition STATE exactly', () => {
    // A state that is in neither list would silently escape both the "hide
    // finished work" filters and the "these are live tasks" queries.
    expect([...ACTIVE_STATES, ...CLOSED_STATES].sort()).toEqual(Object.values(STATE).sort());
    expect(CLOSED_STATES.filter((s) => ACTIVE_STATES.includes(s))).toEqual([]);
  });

  it('CLOSED_STATES covers both terminal states', () => {
    expect(CLOSED_STATES).toContain('done');
    expect(CLOSED_STATES).toContain('cancelled');
  });

  it('closedStatesFilter builds a PostgREST list excluding all terminal states', () => {
    expect(closedStatesFilter()).toBe('("done","cancelled")');
  });

  it('closedStatesFilter prepends extra states before the terminal ones', () => {
    expect(closedStatesFilter([STATE.TODAY])).toBe('("today","done","cancelled")');
    expect(closedStatesFilter([STATE.THIS_WEEK, STATE.TODAY]))
      .toBe('("this_week","today","done","cancelled")');
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

  it('F4 backlog-ageing constants have the expected defaults', () => {
    expect(STALE_BACKLOG_DAYS).toBe(14);
    expect(REVIEW_BACKLOG_CAP).toBe(10);
  });
});
