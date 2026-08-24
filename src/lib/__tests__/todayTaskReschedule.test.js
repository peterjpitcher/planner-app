import { describe, expect, it } from 'vitest';

import { STATE } from '../constants';
import { getRescheduledTodayState } from '../todayTaskReschedule';

describe('getRescheduledTodayState', () => {
  it.each([
    ['2026-08-19', '2026-08-18', STATE.THIS_WEEK],
    ['2026-08-23', '2026-08-18', STATE.THIS_WEEK],
    ['2026-08-24', '2026-08-18', STATE.BACKLOG],
    ['2026-08-28', '2026-08-18', STATE.BACKLOG],
    ['2026-08-23', '2026-08-22', STATE.THIS_WEEK],
    ['2026-08-24', '2026-08-23', STATE.BACKLOG],
  ])('moves %s from %s to %s', (dueDate, todayDate, expected) => {
    expect(getRescheduledTodayState(dueDate, todayDate)).toBe(expected);
  });

  it.each([
    [null, '2026-08-18'],
    ['', '2026-08-18'],
    ['2026-08-18', '2026-08-18'],
    ['2026-08-17', '2026-08-18'],
    ['2026-02-30', '2026-08-18'],
    ['not-a-date', '2026-08-18'],
  ])('does not move a task for due date %s', (dueDate, todayDate) => {
    expect(getRescheduledTodayState(dueDate, todayDate)).toBeNull();
  });
});
