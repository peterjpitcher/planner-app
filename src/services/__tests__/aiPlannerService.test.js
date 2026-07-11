import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { SOFT_CAPS } from '@/lib/constants';

// Mock the OpenAI SDK. The factory closes over a single `create` mock so every
// `new OpenAI()` (including the service's lazy singleton) shares the same
// mocked chat.completions.create — the one place aiPlannerService talks to the
// network. vi.hoisted makes the handle available in the factory and the tests.
const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('openai', () => ({
  // A real class so `new OpenAI(...)` (the lazy singleton in aiPlannerService)
  // constructs cleanly; every instance shares the single hoisted `create` mock.
  OpenAI: class {
    constructor() {
      this.chat = { completions: { create } };
    }
  },
}));

import { draftPlanWithAI } from '../aiPlannerService';

const TODAY = '2026-07-10';
const CAPS = { MUST_DO: 5, GOOD_TO_DO: 5, QUICK_WINS: 8 };
const ORIGINAL_KEY = process.env.OPENAI_API_KEY;

function completionWith(obj) {
  return { choices: [{ message: { content: JSON.stringify(obj) } }] };
}

function cand(id, overrides = {}) {
  return {
    id,
    name: `Task ${id}`,
    description: '',
    chips: [],
    due_date: null,
    entered_state_at: '2026-07-01T09:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  create.mockReset();
  process.env.OPENAI_API_KEY = 'test-key';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = ORIGINAL_KEY;
});

describe('draftPlanWithAI — validates + cap-enforces the model response', () => {
  it('maps a valid model response to assignments', async () => {
    create.mockResolvedValue(
      completionWith({
        assignments: [
          { taskId: 'a', section: 'must_do', reason: 'Overdue and blocks the launch' },
          { taskId: 'b', section: 'quick_wins', reason: 'Quick admin reply' },
        ],
      })
    );

    const result = await draftPlanWithAI({
      candidates: [cand('a', { due_date: '2026-07-01' }), cand('b', { task_type: 'admin' })],
      caps: CAPS,
      todayKey: TODAY,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      assignments: [
        { taskId: 'a', section: 'must_do', reason: 'Overdue and blocks the launch' },
        { taskId: 'b', section: 'quick_wins', reason: 'Quick admin reply' },
      ],
    });
  });

  it('trims an over-cap response down to the caps, keeping the model order', async () => {
    const candidates = Array.from({ length: 4 }, (_, i) => cand(`m${i}`, { due_date: '2026-07-01' }));
    create.mockResolvedValue(
      completionWith({
        assignments: candidates.map((c) => ({ taskId: c.id, section: 'must_do', reason: 'due' })),
      })
    );

    const result = await draftPlanWithAI({
      candidates,
      caps: { MUST_DO: 2, GOOD_TO_DO: 5, QUICK_WINS: 8 },
      todayKey: TODAY,
    });

    expect(result.assignments).toHaveLength(2);
    expect(result.assignments.map((a) => a.taskId)).toEqual(['m0', 'm1']);
  });

  it('drops assignments with unknown task ids or invalid sections, and dedupes', async () => {
    create.mockResolvedValue(
      completionWith({
        assignments: [
          { taskId: 'known', section: 'must_do', reason: 'valid' },
          { taskId: 'ghost', section: 'must_do', reason: 'unknown id' },
          { taskId: 'known2', section: 'later', reason: 'bad section' },
          { taskId: 'known', section: 'good_to_do', reason: 'duplicate id' },
        ],
      })
    );

    const result = await draftPlanWithAI({
      candidates: [cand('known'), cand('known2')],
      caps: CAPS,
      todayKey: TODAY,
    });

    expect(result.assignments).toEqual([{ taskId: 'known', section: 'must_do', reason: 'valid' }]);
  });

  it('caps an over-long reason to 12 words', async () => {
    const longReason = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen';
    create.mockResolvedValue(
      completionWith({ assignments: [{ taskId: 'a', section: 'must_do', reason: longReason }] })
    );

    const result = await draftPlanWithAI({ candidates: [cand('a')], caps: CAPS, todayKey: TODAY });
    expect(result.assignments[0].reason.split(' ')).toHaveLength(12);
    expect(result.assignments[0].reason).toBe('one two three four five six seven eight nine ten eleven twelve');
  });

  it('returns null when the OpenAI call throws (error/timeout)', async () => {
    create.mockRejectedValue(new Error('request timed out'));
    const result = await draftPlanWithAI({ candidates: [cand('a')], caps: SOFT_CAPS, todayKey: TODAY });
    expect(result).toBeNull();
  });

  it('returns null when the model returns unparseable JSON', async () => {
    create.mockResolvedValue({ choices: [{ message: { content: 'not json at all' } }] });
    const result = await draftPlanWithAI({ candidates: [cand('a')], caps: SOFT_CAPS, todayKey: TODAY });
    expect(result).toBeNull();
  });

  it('returns null when the model returns an empty assignments array', async () => {
    create.mockResolvedValue(completionWith({ assignments: [] }));
    const result = await draftPlanWithAI({ candidates: [cand('a')], caps: SOFT_CAPS, todayKey: TODAY });
    expect(result).toBeNull();
  });

  it('returns null (without calling OpenAI) when no API key is configured', async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await draftPlanWithAI({ candidates: [cand('a')], caps: SOFT_CAPS, todayKey: TODAY });
    expect(result).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('returns null (without calling OpenAI) when there are no candidates', async () => {
    const result = await draftPlanWithAI({ candidates: [], caps: SOFT_CAPS, todayKey: TODAY });
    expect(result).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});
