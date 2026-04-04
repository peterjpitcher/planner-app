import { describe, it, expect } from 'vitest';
import { getStartOfTodayLondon } from '../dateUtils';

describe('getStartOfTodayLondon', () => {
  it('returns a Date object', () => {
    const result = getStartOfTodayLondon();
    expect(result).toBeInstanceOf(Date);
  });

  it('returns start of day (is before or equal to now)', () => {
    const result = getStartOfTodayLondon();
    expect(result.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('returns a time within the last 24 hours', () => {
    const result = getStartOfTodayLondon();
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    expect(result.getTime()).toBeGreaterThan(dayAgo);
  });
});
