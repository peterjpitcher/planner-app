import { describe, it, expect } from 'vitest';
import {
  assignAutopilotSections,
  buildAutopilotPlan,
  clearAutopilotPlan,
} from '../autopilotService';

const WINDOW_DATE = '2026-07-10';

// Hand-built candidate factory. Distinct ids so dedupe/ranking is deterministic.
let seq = 0;
function task(overrides = {}) {
  seq += 1;
  return {
    id: overrides.id || `task-${seq}`,
    name: overrides.name || `Task ${seq}`,
    due_date: overrides.due_date ?? null,
    state: overrides.state || 'this_week',
    today_section: overrides.today_section ?? null,
    sort_order: overrides.sort_order ?? null,
    task_type: overrides.task_type ?? null,
    chips: overrides.chips ?? null,
    entered_state_at: overrides.entered_state_at ?? '2026-07-01T09:00:00Z',
    created_at: overrides.created_at ?? '2026-07-01T09:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PURE assignment logic — rank + cap-respecting section routing + leftover.
// ---------------------------------------------------------------------------

describe('assignAutopilotSections — pure section assignment', () => {
  it('routes overdue + due-today into Must Do and respects the cap (5)', () => {
    const pool = Array.from({ length: 7 }, (_, i) =>
      task({ id: `o-${i}`, due_date: '2026-07-01', created_at: `2026-07-0${i + 1}T09:00:00Z` })
    );
    const { placed, leftOver, placements } = assignAutopilotSections(pool, { windowDate: WINDOW_DATE });
    expect(placed).toEqual({ must_do: 5, good_to_do: 0, quick_wins: 0 });
    expect(leftOver).toBe(2);
    expect(placements).toHaveLength(5);
    expect(placements.every((p) => p.section === 'must_do')).toBe(true);
  });

  it('treats a task due exactly on windowDate as Must Do', () => {
    const pool = [task({ due_date: WINDOW_DATE })];
    const { placed } = assignAutopilotSections(pool, { windowDate: WINDOW_DATE });
    expect(placed.must_do).toBe(1);
  });

  it('routes quick-win task_types into Quick Wins and respects the cap (8)', () => {
    const pool = Array.from({ length: 10 }, (_, i) =>
      task({ id: `q-${i}`, task_type: 'admin', due_date: null })
    );
    const { placed, leftOver } = assignAutopilotSections(pool, { windowDate: WINDOW_DATE });
    expect(placed.quick_wins).toBe(8);
    expect(placed.must_do).toBe(0);
    expect(placed.good_to_do).toBe(0);
    expect(leftOver).toBe(2);
  });

  it('routes non-quick undated remainder into Good to Do and respects the cap (5)', () => {
    const pool = Array.from({ length: 7 }, (_, i) =>
      task({ id: `g-${i}`, task_type: 'deep_work', due_date: null })
    );
    const { placed, leftOver } = assignAutopilotSections(pool, { windowDate: WINDOW_DATE });
    expect(placed.good_to_do).toBe(5);
    expect(leftOver).toBe(2);
  });

  it('routes a mixed pool to the correct sections', () => {
    const pool = [
      task({ id: 'm1', due_date: '2026-07-05' }),          // overdue → must_do
      task({ id: 'm2', due_date: WINDOW_DATE }),            // due today → must_do
      task({ id: 'q1', task_type: 'reply_chase' }),        // quick → quick_wins
      task({ id: 'q2', task_type: 'fix' }),                // quick → quick_wins
      task({ id: 'g1', task_type: 'content' }),            // non-quick undated → good_to_do
      task({ id: 'g2', due_date: '2026-07-20' }),          // future-dated non-quick → good_to_do
    ];
    const { placed, leftOver } = assignAutopilotSections(pool, { windowDate: WINDOW_DATE });
    expect(placed).toEqual({ must_do: 2, good_to_do: 2, quick_wins: 2 });
    expect(leftOver).toBe(0);
  });

  it('subtracts existing Today occupancy from the section capacity', () => {
    const pool = Array.from({ length: 4 }, (_, i) => task({ id: `o-${i}`, due_date: '2026-07-01' }));
    const { placed, leftOver } = assignAutopilotSections(pool, {
      windowDate: WINDOW_DATE,
      existingCounts: { must_do: 3 },
    });
    expect(placed.must_do).toBe(2); // cap 5 − 3 already there
    expect(leftOver).toBe(2);
  });

  it('never overflows a full section into another (leftover, not spill)', () => {
    const pool = Array.from({ length: 3 }, (_, i) => task({ id: `o-${i}`, due_date: '2026-07-01' }));
    const { placed, leftOver } = assignAutopilotSections(pool, {
      windowDate: WINDOW_DATE,
      existingCounts: { must_do: 5 }, // Must Do already full
    });
    expect(placed).toEqual({ must_do: 0, good_to_do: 0, quick_wins: 0 });
    expect(leftOver).toBe(3);
  });

  it('treats an over-cap existing section as zero remaining capacity', () => {
    const pool = [task({ due_date: '2026-07-01' })];
    const { placed, leftOver } = assignAutopilotSections(pool, {
      windowDate: WINDOW_DATE,
      existingCounts: { must_do: 7 },
    });
    expect(placed.must_do).toBe(0);
    expect(leftOver).toBe(1);
  });

  it('places tasks within a section in F1 order (earlier-due overdue first)', () => {
    const pool = [
      task({ id: 'due-05', due_date: '2026-07-05' }),
      task({ id: 'due-01', due_date: '2026-07-01' }),
      task({ id: 'due-03', due_date: '2026-07-03' }),
    ];
    const { placements } = assignAutopilotSections(pool, { windowDate: WINDOW_DATE });
    expect(placements.map((p) => p.id)).toEqual(['due-01', 'due-03', 'due-05']);
  });

  it('handles an empty pool', () => {
    const { placed, leftOver, placements } = assignAutopilotSections([], { windowDate: WINDOW_DATE });
    expect(placed).toEqual({ must_do: 0, good_to_do: 0, quick_wins: 0 });
    expect(leftOver).toBe(0);
    expect(placements).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Orchestration — buildAutopilotPlan / clearAutopilotPlan with a mocked Supabase.
// A recording query-builder: every filter method chains; awaiting the builder (or
// calling single/maybeSingle) resolves via the configured resolver. All IO mocked.
// ---------------------------------------------------------------------------

const POOL_SELECT_HINT = ['task_type', 'entered_state_at'];

function makeSupabase(config) {
  config.updates = [];
  config.deletes = [];

  function resolver(state) {
    const idFilter = state.filters.find((f) => f[0] === 'eq' && f[1] === 'id');
    const id = idFilter ? idFilter[2] : null;

    if (state.op === 'update') {
      config.updates.push({ id, payload: state.payload, filters: state.filters });
      return Promise.resolve({ data: id ? { id } : null, error: config.updateError || null });
    }
    if (state.op === 'delete') {
      config.deletes.push({ filters: state.filters });
      return Promise.resolve({ data: null, error: config.deleteError || null });
    }
    // select
    const sel = state.selectArg || '';
    if (sel === 'id, today_section, sort_order') {
      return Promise.resolve({ data: config.today || [], error: config.todayError || null });
    }
    if (POOL_SELECT_HINT.every((h) => sel.includes(h))) {
      return Promise.resolve({ data: config.pool || [], error: config.poolError || null });
    }
    if (sel === 'sort_order') {
      return Promise.resolve({
        data: config.maxThisWeek != null ? { sort_order: config.maxThisWeek } : null,
        error: null,
      });
    }
    if (sel === 'id') {
      return Promise.resolve({ data: config.autoPlaced || [], error: config.autoPlacedError || null });
    }
    return Promise.resolve({ data: [], error: null });
  }

  function makeBuilder() {
    const state = { table: 'tasks', op: 'select', selectArg: null, filters: [], payload: null };
    const builder = {};
    const chainMethods = ['select', 'eq', 'neq', 'not', 'is', 'or', 'lt', 'lte', 'gte', 'gt', 'in', 'order', 'limit'];
    for (const m of chainMethods) {
      builder[m] = (...args) => {
        if (m === 'select') state.selectArg = args[0];
        state.filters.push([m, ...args]);
        return builder;
      };
    }
    builder.update = (payload) => { state.op = 'update'; state.payload = payload; return builder; };
    builder.delete = () => { state.op = 'delete'; return builder; };
    builder.insert = (payload) => { state.op = 'insert'; state.payload = payload; return builder; };
    builder.single = () => resolver(state);
    builder.maybeSingle = () => resolver(state);
    builder.then = (onF, onR) => resolver(state).then(onF, onR);
    return builder;
  }

  return { from: () => makeBuilder() };
}

describe('buildAutopilotPlan — orchestration (mocked IO)', () => {
  it('fetches the pool, assigns sections, and writes the four placement fields', async () => {
    const config = {
      today: [],
      pool: [
        task({ id: 'm1', due_date: '2026-07-01' }),   // must_do
        task({ id: 'q1', task_type: 'admin' }),       // quick_wins
        task({ id: 'g1', task_type: 'content' }),     // good_to_do
      ],
      maxThisWeek: null,
    };
    const supabase = makeSupabase(config);

    const result = await buildAutopilotPlan({ supabase, userId: 'user-1', windowDate: WINDOW_DATE });

    expect(result.placed).toEqual({ must_do: 1, good_to_do: 1, quick_wins: 1 });
    expect(result.leftOver).toBe(0);
    expect(result.failures).toEqual([]);
    expect(config.updates).toHaveLength(3);

    for (const upd of config.updates) {
      expect(upd.payload.state).toBe('today');
      expect(['must_do', 'good_to_do', 'quick_wins']).toContain(upd.payload.today_section);
      expect(typeof upd.payload.sort_order).toBe('number');
      expect(typeof upd.payload.autoplanned_at).toBe('string');
      // Scoped by id AND user_id.
      expect(upd.filters).toContainEqual(['eq', 'user_id', 'user-1']);
    }
    // The must_do task got today_section must_do.
    const m1 = config.updates.find((u) => u.id === 'm1');
    expect(m1.payload.today_section).toBe('must_do');
  });

  it('counts existing Today tasks against the cap and leaves the surplus untouched', async () => {
    const config = {
      today: Array.from({ length: 5 }, (_, i) => ({ id: `t-${i}`, today_section: 'must_do', sort_order: (i + 1) * 1000 })),
      pool: [task({ id: 'm1', due_date: '2026-07-01' }), task({ id: 'm2', due_date: '2026-07-02' })],
      maxThisWeek: null,
    };
    const supabase = makeSupabase(config);

    const result = await buildAutopilotPlan({ supabase, userId: 'user-1', windowDate: WINDOW_DATE });
    expect(result.placed.must_do).toBe(0); // Must Do already full (5)
    expect(result.leftOver).toBe(2);
    expect(config.updates).toHaveLength(0);
  });

  it('reports placement failures without throwing', async () => {
    const config = {
      today: [],
      pool: [task({ id: 'm1', due_date: '2026-07-01' })],
      updateError: { message: 'boom' },
      maxThisWeek: null,
    };
    const supabase = makeSupabase(config);
    const result = await buildAutopilotPlan({ supabase, userId: 'user-1', windowDate: WINDOW_DATE });
    expect(result.placed.must_do).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain('boom');
  });

  it('rejects an invalid windowDate', async () => {
    const supabase = makeSupabase({});
    await expect(
      buildAutopilotPlan({ supabase, userId: 'user-1', windowDate: 'not-a-date' })
    ).rejects.toThrow(/windowDate/);
  });
});

describe('clearAutopilotPlan — orchestration (mocked IO)', () => {
  it('moves every still-auto-placed task back to This Week and clears the flag', async () => {
    const config = {
      autoPlaced: [{ id: 'a1' }, { id: 'a2' }],
      maxThisWeek: 1000,
    };
    const supabase = makeSupabase(config);

    const result = await clearAutopilotPlan({ supabase, userId: 'user-1' });
    expect(result.cleared).toBe(2);
    expect(config.updates).toHaveLength(2);
    for (const upd of config.updates) {
      expect(upd.payload.state).toBe('this_week');
      expect(upd.payload.autoplanned_at).toBeNull();
      expect(typeof upd.payload.sort_order).toBe('number');
    }
    // Appended after the current max This Week sort_order.
    expect(config.updates.every((u) => u.payload.sort_order > 1000)).toBe(true);
  });

  it('does nothing when there are no auto-placed tasks', async () => {
    const config = { autoPlaced: [], maxThisWeek: null };
    const supabase = makeSupabase(config);
    const result = await clearAutopilotPlan({ supabase, userId: 'user-1' });
    expect(result.cleared).toBe(0);
    expect(config.updates).toHaveLength(0);
  });
});
