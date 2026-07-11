import { describe, it, expect, vi } from 'vitest';
import { updateTask } from '../taskService';
import { getLondonDateKey } from '@/lib/timezone';
import { nextRecurrenceDate } from '@/lib/recurrence';

// Minimal Supabase query-builder stub. updateTask fetches the existing row via
// .from('tasks').select().eq().eq().single(); may probe append sort_order via
// .select('sort_order').eq()...not()...order().limit(); writes via
// .from('tasks').update(payload).eq().eq().select().single(). The recurrence
// next-occurrence spawn then calls createTask, which inserts via
// .from('tasks').insert(payload).select().single(). We capture both the update
// and the insert payloads so we can assert the spawn behaviour precisely.
function makeSupabase(existingTask, { insertFails = false, lostRace = false } = {}) {
  let updatePayload = null;
  let insertPayload = null;

  function makeSelectChain() {
    const chain = {
      eq() { return chain; },
      not() { return chain; },
      is() { return chain; },
      order() { return chain; },
      limit: async () => ({ data: [], error: null }),
      single: async () => ({ data: existingTask, error: null }),
    };
    return chain;
  }

  const supabase = {
    from() {
      return {
        select() { return makeSelectChain(); },
        update(payload) {
          updatePayload = payload;
          const chain = {
            eq() { return chain; },
            neq() { return chain; },
            select() {
              return {
                // lostRace simulates the atomic neq('state','done') guard matching
                // no row because another request completed the task first.
                single: async () => (lostRace
                  ? { data: null, error: { code: 'PGRST116', message: 'no rows' } }
                  : { data: { ...existingTask, ...payload }, error: null }),
              };
            },
          };
          return chain;
        },
        insert(payload) {
          insertPayload = payload;
          return {
            select() {
              return {
                single: async () => (insertFails
                  ? { data: null, error: { message: 'insert failed' } }
                  : { data: { id: 'spawned-1', ...payload }, error: null }),
              };
            },
          };
        },
      };
    },
    getUpdatePayload: () => updatePayload,
    getInsertPayload: () => insertPayload,
  };
  return supabase;
}

const USER_ID = 'user-1';

// Far-future due date so the base-date "later of (due_date, today)" resolves to
// the due date regardless of when the suite runs — keeps the assertion stable.
const baseTask = {
  id: 'task-1',
  user_id: USER_ID,
  name: 'Standup',
  description: 'Daily standup',
  state: 'today',
  today_section: 'must_do',
  sort_order: 100,
  area: 'Ops',
  task_type: 'admin',
  chips: ['urgent'],
  project_id: null,
  due_date: '2030-03-10',
  recurrence: 'daily',
  recurrence_interval: 1,
  completed_at: null,
  snoozed_until: null,
  snooze_count: 0,
  inbox: false,
  carried_count: 0,
  carried_section: null,
  autoplanned_at: null,
};

const opts = { skipOffice365Sync: true, skipProjectTouch: true };

async function runUpdate(existingOverrides, updates, supabaseOptions) {
  const existing = { ...baseTask, ...existingOverrides };
  const supabase = makeSupabase(existing, supabaseOptions);
  const result = await updateTask({
    supabase, userId: USER_ID, taskId: existing.id, updates, options: opts,
  });
  return { result, insert: supabase.getInsertPayload(), update: supabase.getUpdatePayload() };
}

describe('updateTask — recurrence next-occurrence spawn (F6/P4)', () => {
  it('spawns one backlog task with the right due_date on completion', async () => {
    const { result, insert } = await runUpdate({}, { state: 'done' });
    expect(result.error).toBeUndefined();
    expect(insert).not.toBeNull();
    // base = later of (2030-03-10, today) = 2030-03-10; daily -> +1 day.
    expect(insert.due_date).toBe('2030-03-11');
    expect(insert.state).toBe('backlog');
  });

  it('carries the intended fields onto the spawned occurrence', async () => {
    const { insert } = await runUpdate({}, { state: 'done' });
    expect(insert.name).toBe('Standup');
    expect(insert.description).toBe('Daily standup');
    expect(insert.project_id).toBeNull();
    expect(insert.area).toBe('Ops');
    expect(insert.task_type).toBe('admin');
    expect(insert.chips).toEqual(['urgent']);
    expect(insert.recurrence).toBe('daily');
    expect(insert.recurrence_interval).toBe(1);
    expect(insert.user_id).toBe(USER_ID);
  });

  it('does NOT carry completion / placement / marker fields onto the spawn', async () => {
    const { insert } = await runUpdate({}, { state: 'done' });
    expect(insert).not.toHaveProperty('completed_at');
    expect(insert).not.toHaveProperty('today_section');
    expect(insert).not.toHaveProperty('sort_order');
    expect(insert).not.toHaveProperty('snoozed_until');
    expect(insert).not.toHaveProperty('snooze_count');
    expect(insert).not.toHaveProperty('inbox');
    expect(insert).not.toHaveProperty('carried_count');
    expect(insert).not.toHaveProperty('carried_section');
    expect(insert).not.toHaveProperty('autoplanned_at');
  });

  it('advances from today (not the past due date) so the next occurrence is in the future', async () => {
    // Overdue recurring task: base must be today, never the stale past due date.
    const { insert } = await runUpdate({ due_date: '2020-01-01' }, { state: 'done' });
    const today = getLondonDateKey();
    expect(insert.due_date).toBe(nextRecurrenceDate(today, 'daily', 1));
    expect(insert.due_date > today).toBe(true);
    expect(insert.due_date).not.toBe('2020-01-02');
  });

  it('advances from today when the recurring task is undated', async () => {
    const { insert } = await runUpdate({ due_date: null }, { state: 'done' });
    const today = getLondonDateKey();
    expect(insert.due_date).toBe(nextRecurrenceDate(today, 'daily', 1));
  });

  it('uses the recurrence pattern + interval (weekly, every 2 weeks)', async () => {
    const { insert } = await runUpdate(
      { recurrence: 'weekly', recurrence_interval: 2 },
      { state: 'done' }
    );
    // base 2030-03-10 + 14 days.
    expect(insert.due_date).toBe('2030-03-24');
    expect(insert.recurrence).toBe('weekly');
    expect(insert.recurrence_interval).toBe(2);
  });

  it('does NOT spawn when re-saving an already-done task (idempotent)', async () => {
    const { result, insert } = await runUpdate(
      { state: 'done' },
      { name: 'Edited while done' }
    );
    expect(result.error).toBeUndefined();
    expect(insert).toBeNull();
  });

  it('does NOT spawn for a non-recurring task', async () => {
    const { result, insert } = await runUpdate(
      { recurrence: null },
      { state: 'done' }
    );
    expect(result.error).toBeUndefined();
    expect(insert).toBeNull();
  });

  it('does NOT spawn when the update is not a transition into done', async () => {
    const { insert } = await runUpdate(
      { state: 'today' },
      { today_section: 'good_to_do' }
    );
    expect(insert).toBeNull();
  });

  it('never lets a spawn failure break the completion itself', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result, insert } = await runUpdate({}, { state: 'done' }, { insertFails: true });
    // Completion still succeeds and returns the updated (done) task.
    expect(result.error).toBeUndefined();
    expect(result.data.state).toBe('done');
    // The spawn was attempted (insert captured) but its failure was swallowed.
    expect(insert).not.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does NOT spawn when it loses the concurrent done-transition race', async () => {
    // The atomic neq('state','done') guard matched no row — another request
    // already completed it — so this request must not spawn a second occurrence.
    const { result, insert } = await runUpdate({}, { state: 'done' }, { lostRace: true });
    expect(result.error).toBeUndefined();
    expect(insert).toBeNull();
  });
});

describe('updateTask — recurrence field validation (F6/P4)', () => {
  it('rejects an invalid recurrence pattern', async () => {
    const { result } = await runUpdate({}, { recurrence: 'yearly' });
    expect(result.error?.status).toBe(400);
  });

  it('coerces a zero/negative recurrence_interval to 1', async () => {
    const { update } = await runUpdate({}, { recurrence: 'weekly', recurrence_interval: 0 });
    expect(update.recurrence_interval).toBe(1);
  });

  it('accepts clearing recurrence to null', async () => {
    const { result, update } = await runUpdate({}, { recurrence: null });
    expect(result.error).toBeUndefined();
    expect(update.recurrence).toBeNull();
  });
});
