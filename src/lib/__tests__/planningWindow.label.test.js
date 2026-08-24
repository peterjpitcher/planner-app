import { describe, it, expect } from 'vitest';
import { getPlanningWeekStart, getWindowLabel } from '../planningWindow';
import { WINDOW_TYPE } from '../constants';

describe('getPlanningWeekStart', () => {
  it('targets tomorrow when planning on a Sunday', () => {
    // Sunday 23 August 2026. The week being planned starts on Monday the 24th,
    // which is what the automatic Sunday weekly window already targets. Taking
    // the ISO Monday here aimed manual weekly planning at 17 August, the week
    // that was ending, so the session it wrote was never read back.
    expect(getPlanningWeekStart('2026-08-23')).toBe('2026-08-24');
  });

  it('targets the current Monday on every other day', () => {
    expect(getPlanningWeekStart('2026-08-24')).toBe('2026-08-24'); // Monday
    expect(getPlanningWeekStart('2026-08-26')).toBe('2026-08-24'); // Wednesday
    expect(getPlanningWeekStart('2026-08-29')).toBe('2026-08-24'); // Saturday
  });

  it('agrees with the automatic window across a month boundary', () => {
    expect(getPlanningWeekStart('2026-08-30')).toBe('2026-08-31'); // Sunday
    expect(getPlanningWeekStart('2026-08-31')).toBe('2026-08-31'); // Monday
  });
});

describe('getWindowLabel: daily', () => {
  // Monday 24 August 2026.
  const today = '2026-08-24';

  it('names the day you are planning in the evening "tomorrow"', () => {
    expect(getWindowLabel(WINDOW_TYPE.DAILY, '2026-08-25', today)).toBe('tomorrow');
  });

  it('names that same window "today" once the day arrives', () => {
    // The daily window runs 20:05 through to 20:00 the next day, so the plan
    // made last night is still the active window all day. Calling it "tomorrow"
    // told the user their planned day was unplanned.
    expect(getWindowLabel(WINDOW_TYPE.DAILY, today, today)).toBe('today');
  });

  it('names a window left over from the previous day "yesterday"', () => {
    expect(getWindowLabel(WINDOW_TYPE.DAILY, '2026-08-23', today)).toBe('yesterday');
  });

  it('returns null for anything further out so the caller shows the date', () => {
    expect(getWindowLabel(WINDOW_TYPE.DAILY, '2026-08-27', today)).toBeNull();
  });

  it('crosses a month boundary', () => {
    expect(getWindowLabel(WINDOW_TYPE.DAILY, '2026-09-01', '2026-08-31')).toBe('tomorrow');
    expect(getWindowLabel(WINDOW_TYPE.DAILY, '2026-08-31', '2026-09-01')).toBe('yesterday');
  });

  it('crosses the end of British Summer Time without slipping a day', () => {
    // BST ends on Sunday 25 October 2026 at 02:00.
    expect(getWindowLabel(WINDOW_TYPE.DAILY, '2026-10-25', '2026-10-24')).toBe('tomorrow');
    expect(getWindowLabel(WINDOW_TYPE.DAILY, '2026-10-26', '2026-10-25')).toBe('tomorrow');
  });

  it('crosses the start of British Summer Time without slipping a day', () => {
    // BST starts on Sunday 29 March 2026 at 01:00.
    expect(getWindowLabel(WINDOW_TYPE.DAILY, '2026-03-29', '2026-03-28')).toBe('tomorrow');
    expect(getWindowLabel(WINDOW_TYPE.DAILY, '2026-03-30', '2026-03-29')).toBe('tomorrow');
  });
});

describe('getWindowLabel: weekly', () => {
  it('names the Monday of the current week "this week"', () => {
    // Wednesday 26 August 2026, week beginning Monday 24 August.
    expect(getWindowLabel(WINDOW_TYPE.WEEKLY, '2026-08-24', '2026-08-26')).toBe('this week');
  });

  it('names next Monday "next week" when planning on a Sunday evening', () => {
    // Sunday 23 August plans the week beginning Monday 24 August.
    expect(getWindowLabel(WINDOW_TYPE.WEEKLY, '2026-08-24', '2026-08-23')).toBe('next week');
  });

  it('names the previous Monday "last week"', () => {
    expect(getWindowLabel(WINDOW_TYPE.WEEKLY, '2026-08-17', '2026-08-26')).toBe('last week');
  });

  it('returns null for a week further out', () => {
    expect(getWindowLabel(WINDOW_TYPE.WEEKLY, '2026-09-07', '2026-08-24')).toBeNull();
  });
});

describe('getWindowLabel: missing input', () => {
  it('returns null rather than guessing', () => {
    expect(getWindowLabel(WINDOW_TYPE.DAILY, null, '2026-08-24')).toBeNull();
    expect(getWindowLabel(WINDOW_TYPE.DAILY, '2026-08-24', null)).toBeNull();
  });
});
