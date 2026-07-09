import { describe, it, expect } from 'vitest';
import { fromGraphDueDateTime } from '../office365SyncService';

describe('fromGraphDueDateTime', () => {
  it('returns null when the remote task has no dueDateTime (FF-040)', () => {
    expect(fromGraphDueDateTime(null)).toBe(null);
    expect(fromGraphDueDateTime(undefined)).toBe(null);
    expect(fromGraphDueDateTime({})).toBe(null);
    expect(fromGraphDueDateTime({ dateTime: null })).toBe(null);
  });

  it('slices the date component when the zone is UTC or absent', () => {
    expect(fromGraphDueDateTime({ dateTime: '2026-07-09T12:00:00.0000000', timeZone: 'UTC' })).toBe('2026-07-09');
    expect(fromGraphDueDateTime({ dateTime: '2026-07-09T00:00:00' })).toBe('2026-07-09');
    // Midnight-UTC value with no/UTC zone is preserved verbatim (round-trips with noon-UTC writes).
    expect(fromGraphDueDateTime({ dateTime: '2026-07-08T23:00:00', timeZone: 'UTC' })).toBe('2026-07-08');
  });

  it('resolves a named non-UTC zone to the Europe/London calendar date (FF-039)', () => {
    // A task due 9 July whose wall-clock midnight is expressed in New York time
    // is 2026-07-09T00:00 America/New_York = 2026-07-09T04:00Z = 9 July in London.
    expect(
      fromGraphDueDateTime({ dateTime: '2026-07-09T00:00:00.0000000', timeZone: 'America/New_York' }),
    ).toBe('2026-07-09');

    // 2026-07-09T00:00 in Asia/Tokyo (+09) is 2026-07-08T15:00Z, still 8 July in
    // London under BST (+01 -> 16:00) — the wall-clock date is preserved.
    expect(
      fromGraphDueDateTime({ dateTime: '2026-07-09T00:00:00', timeZone: 'Asia/Tokyo' }),
    ).toBe('2026-07-08');
  });

  it('falls back to the plain date slice for an unrecognised (e.g. Windows) zone name', () => {
    expect(
      fromGraphDueDateTime({ dateTime: '2026-07-09T00:00:00.0000000', timeZone: 'Pacific Standard Time' }),
    ).toBe('2026-07-09');
  });
});
