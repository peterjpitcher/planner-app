import { describe, it, expect } from 'vitest';
import { nextRecurrenceDate, isValidRecurrence } from '../recurrence';

// Reference weekdays in July 2026 (verified against the calendar):
//   2026-07-10 Friday, 2026-07-11 Saturday, 2026-07-12 Sunday, 2026-07-13 Monday.

describe('nextRecurrenceDate — daily', () => {
  it('advances one day for interval 1', () => {
    expect(nextRecurrenceDate('2026-07-11', 'daily', 1)).toBe('2026-07-12');
  });

  it('advances N days for interval > 1', () => {
    expect(nextRecurrenceDate('2026-07-11', 'daily', 3)).toBe('2026-07-14');
  });

  it('rolls over month boundaries', () => {
    expect(nextRecurrenceDate('2026-07-31', 'daily', 1)).toBe('2026-08-01');
  });

  it('defaults a missing interval to 1', () => {
    expect(nextRecurrenceDate('2026-07-11', 'daily')).toBe('2026-07-12');
  });
});

describe('nextRecurrenceDate — weekdays', () => {
  it('jumps Friday -> Monday over the weekend', () => {
    expect(nextRecurrenceDate('2026-07-10', 'weekdays', 1)).toBe('2026-07-13');
  });

  it('jumps Saturday -> Monday', () => {
    expect(nextRecurrenceDate('2026-07-11', 'weekdays', 1)).toBe('2026-07-13');
  });

  it('jumps Sunday -> Monday', () => {
    expect(nextRecurrenceDate('2026-07-12', 'weekdays', 1)).toBe('2026-07-13');
  });

  it('advances one day mid-week (Monday -> Tuesday)', () => {
    expect(nextRecurrenceDate('2026-07-13', 'weekdays', 1)).toBe('2026-07-14');
  });

  it('ignores the interval entirely', () => {
    expect(nextRecurrenceDate('2026-07-10', 'weekdays', 5)).toBe('2026-07-13');
  });
});

describe('nextRecurrenceDate — weekly', () => {
  it('advances 7 days for interval 1 (same weekday)', () => {
    expect(nextRecurrenceDate('2026-07-11', 'weekly', 1)).toBe('2026-07-18');
  });

  it('advances 14 days for interval 2', () => {
    expect(nextRecurrenceDate('2026-07-11', 'weekly', 2)).toBe('2026-07-25');
  });
});

describe('nextRecurrenceDate — monthly', () => {
  it('advances one month, keeping the day-of-month when it exists', () => {
    expect(nextRecurrenceDate('2026-01-15', 'monthly', 1)).toBe('2026-02-15');
  });

  it('clamps Jan 31 -> Feb 28 in a non-leap year', () => {
    expect(nextRecurrenceDate('2026-01-31', 'monthly', 1)).toBe('2026-02-28');
  });

  it('clamps Jan 31 -> Feb 29 in a leap year', () => {
    expect(nextRecurrenceDate('2028-01-31', 'monthly', 1)).toBe('2028-02-29');
  });

  it('rolls over the year (Dec -> Jan)', () => {
    expect(nextRecurrenceDate('2026-12-31', 'monthly', 1)).toBe('2027-01-31');
  });

  it('advances N months with year rollover for interval > 1', () => {
    // Nov 2026 + 2 months = Jan 2027; day 30 fits January.
    expect(nextRecurrenceDate('2026-11-30', 'monthly', 2)).toBe('2027-01-30');
  });
});

describe('nextRecurrenceDate — interval guards', () => {
  it('treats interval 0 as 1 (daily)', () => {
    expect(nextRecurrenceDate('2026-07-11', 'daily', 0)).toBe('2026-07-12');
  });

  it('treats a negative interval as 1 (weekly)', () => {
    expect(nextRecurrenceDate('2026-07-11', 'weekly', -3)).toBe('2026-07-18');
  });

  it('floors a fractional interval (daily 2.9 -> 2 days)', () => {
    expect(nextRecurrenceDate('2026-07-11', 'daily', 2.9)).toBe('2026-07-13');
  });

  it('treats a non-numeric interval as 1', () => {
    expect(nextRecurrenceDate('2026-07-11', 'daily', 'abc')).toBe('2026-07-12');
  });
});

describe('nextRecurrenceDate — invalid inputs return null', () => {
  it('returns null for an unknown pattern', () => {
    expect(nextRecurrenceDate('2026-07-11', 'yearly', 1)).toBeNull();
  });

  it('returns null for a null pattern', () => {
    expect(nextRecurrenceDate('2026-07-11', null, 1)).toBeNull();
  });

  it('returns null for an empty pattern', () => {
    expect(nextRecurrenceDate('2026-07-11', '', 1)).toBeNull();
  });

  it('returns null for an unparseable date', () => {
    expect(nextRecurrenceDate('not-a-date', 'daily', 1)).toBeNull();
  });

  it('returns null for a null date', () => {
    expect(nextRecurrenceDate(null, 'daily', 1)).toBeNull();
  });

  it('returns null for an impossible date (Feb 31)', () => {
    expect(nextRecurrenceDate('2026-02-31', 'daily', 1)).toBeNull();
  });
});

describe('isValidRecurrence', () => {
  it('accepts null (not recurring)', () => {
    expect(isValidRecurrence(null)).toBe(true);
  });

  it('accepts each supported pattern', () => {
    for (const value of ['daily', 'weekdays', 'weekly', 'monthly']) {
      expect(isValidRecurrence(value)).toBe(true);
    }
  });

  it('rejects an unknown pattern', () => {
    expect(isValidRecurrence('yearly')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidRecurrence('')).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isValidRecurrence(undefined)).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(isValidRecurrence('DAILY')).toBe(false);
  });
});
