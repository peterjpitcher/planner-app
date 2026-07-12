import { describe, it, expect } from 'vitest';
import { getLondonDayOfWeek, isLondonWeekend } from '@/lib/cronAuth';

// getLondonDayOfWeek / isLondonWeekend gate the automated planner and digest
// email to the Monday–Friday working week. These verify the day is resolved in
// Europe/London (not UTC), which matters near midnight during BST.

describe('getLondonDayOfWeek', () => {
  it('maps a full week to 1=Mon … 0=Sun (midday, unambiguous)', () => {
    expect(getLondonDayOfWeek(new Date('2024-01-08T12:00:00Z'))).toBe(1); // Mon
    expect(getLondonDayOfWeek(new Date('2024-01-09T12:00:00Z'))).toBe(2); // Tue
    expect(getLondonDayOfWeek(new Date('2024-01-10T12:00:00Z'))).toBe(3); // Wed
    expect(getLondonDayOfWeek(new Date('2024-01-11T12:00:00Z'))).toBe(4); // Thu
    expect(getLondonDayOfWeek(new Date('2024-01-12T12:00:00Z'))).toBe(5); // Fri
    expect(getLondonDayOfWeek(new Date('2024-01-06T12:00:00Z'))).toBe(6); // Sat
    expect(getLondonDayOfWeek(new Date('2024-01-07T12:00:00Z'))).toBe(0); // Sun
  });

  it('resolves the London day, not the UTC day, across the BST midnight boundary', () => {
    // 23:30Z on Sunday 7 Jul 2024 (BST, UTC+1) is 00:30 Monday in London.
    expect(getLondonDayOfWeek(new Date('2024-07-07T23:30:00Z'))).toBe(1); // Mon in London
  });
});

describe('isLondonWeekend', () => {
  it('is true on Saturday and Sunday in London', () => {
    expect(isLondonWeekend(new Date('2024-01-06T12:00:00Z'))).toBe(true); // Sat
    expect(isLondonWeekend(new Date('2024-01-07T12:00:00Z'))).toBe(true); // Sun
  });

  it('is false Monday through Friday in London', () => {
    expect(isLondonWeekend(new Date('2024-01-08T12:00:00Z'))).toBe(false); // Mon
    expect(isLondonWeekend(new Date('2024-01-09T12:00:00Z'))).toBe(false); // Tue
    expect(isLondonWeekend(new Date('2024-01-10T12:00:00Z'))).toBe(false); // Wed
    expect(isLondonWeekend(new Date('2024-01-11T12:00:00Z'))).toBe(false); // Thu
    expect(isLondonWeekend(new Date('2024-01-12T12:00:00Z'))).toBe(false); // Fri
  });

  it('treats a Sunday-night instant that is already Monday in London as a weekday', () => {
    expect(isLondonWeekend(new Date('2024-07-07T23:30:00Z'))).toBe(false); // Mon 00:30 London
  });
});
