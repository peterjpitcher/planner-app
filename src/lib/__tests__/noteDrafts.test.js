import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearAllNoteDrafts,
  noteDraftKey,
  readNoteDraft,
  removeNoteDraft,
  writeNoteDraft,
} from '@/lib/noteDrafts';

// This jsdom has no localStorage, so each test gets a fresh in-memory one.
function memoryStorage() {
  const entries = new Map();
  return {
    get length() { return entries.size; },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => { entries.set(key, String(value)); },
    removeItem: (key) => { entries.delete(key); },
    clear: () => entries.clear(),
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
});

describe('noteDraftKey', () => {
  it('keys a draft by where the note is written', () => {
    expect(noteDraftKey({ projectId: 'p1' })).toBe('planner.noteDraft.v1:project:p1');
    expect(noteDraftKey({ taskId: 't1' })).toBe('planner.noteDraft.v1:task:t1');
    expect(noteDraftKey({ customerId: 'c1' })).toBe('planner.noteDraft.v1:customer:c1');
    expect(noteDraftKey({})).toBeNull();
  });
});

describe('note drafts', () => {
  const key = 'planner.noteDraft.v1:project:p1';

  it('keeps and reads back a draft with when it was kept', () => {
    expect(writeNoteDraft(key, '[17 Sep 2026 14:32] Called Sam', new Date('2026-09-17T13:32:00Z'))).toBe(true);
    expect(readNoteDraft(key)).toEqual({
      text: '[17 Sep 2026 14:32] Called Sam',
      savedAt: '2026-09-17T13:32:00.000Z',
    });
  });

  it('removes a draft', () => {
    writeNoteDraft(key, 'Called Sam');
    removeNoteDraft(key);
    expect(readNoteDraft(key)).toBeNull();
  });

  it('ignores a corrupt or empty entry', () => {
    window.localStorage.setItem(key, '{not json');
    expect(readNoteDraft(key)).toBeNull();
    window.localStorage.setItem(key, JSON.stringify({ text: '   ' }));
    expect(readNoteDraft(key)).toBeNull();
  });

  it('reports a draft the browser would not keep', () => {
    window.localStorage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(writeNoteDraft(key, 'Called Sam')).toBe(false);
  });

  it('clears every note draft on sign-out and nothing else', () => {
    writeNoteDraft(key, 'One');
    writeNoteDraft('planner.noteDraft.v1:customer:c1', 'Two');
    window.localStorage.setItem('journal_draft', 'Journal');

    clearAllNoteDrafts();

    expect(readNoteDraft(key)).toBeNull();
    expect(readNoteDraft('planner.noteDraft.v1:customer:c1')).toBeNull();
    expect(window.localStorage.getItem('journal_draft')).toBe('Journal');
  });
});
