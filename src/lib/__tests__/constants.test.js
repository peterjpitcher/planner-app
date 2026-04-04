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
