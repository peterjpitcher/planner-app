import { describe, it, expect } from 'vitest';
import {
  buildTodoTaskPayload,
  fromGraphDueDateTime,
  isTaskFinished,
} from '../office365SyncService';


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

describe('isTaskFinished', () => {
  it('counts both done and cancelled as finished', () => {
    // CLOSED_STATES is the single source of truth. This file compared against
    // 'done' alone, which predates the cancelled state.
    expect(isTaskFinished({ state: 'done' })).toBe(true);
    expect(isTaskFinished({ state: 'cancelled' })).toBe(true);
  });

  it.each(['today', 'this_week', 'backlog', 'waiting'])('treats %s as live work', (state) => {
    expect(isTaskFinished({ state })).toBe(false);
  });

  it('handles a missing task or state', () => {
    expect(isTaskFinished(null)).toBe(false);
    expect(isTaskFinished({})).toBe(false);
  });
});

describe('buildTodoTaskPayload', () => {
  const base = { name: 'Ring the supplier', description: 'about the invoice', due_date: '2026-08-28' };

  it('marks a done task complete in Outlook', () => {
    expect(buildTodoTaskPayload({ ...base, state: 'done' }).status).toBe('completed');
  });

  it('marks a cancelled task complete rather than leaving it outstanding', () => {
    // Graph has no "cancelled". Leaving it notStarted left tasks the user had
    // cancelled sitting in Outlook as work still to do.
    expect(buildTodoTaskPayload({ ...base, state: 'cancelled' }).status).toBe('completed');
  });

  it('leaves live work outstanding', () => {
    expect(buildTodoTaskPayload({ ...base, state: 'today' }).status).toBe('notStarted');
    expect(buildTodoTaskPayload({ ...base, state: 'backlog' }).status).toBe('notStarted');
  });

  it('carries the title, description and due date', () => {
    const payload = buildTodoTaskPayload({ ...base, state: 'backlog' });
    expect(payload.title).toBe('Ring the supplier');
    expect(payload.body.content).toBe('about the invoice');
    expect(payload.dueDateTime).toBeTruthy();
  });
});
