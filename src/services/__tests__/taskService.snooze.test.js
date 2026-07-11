import { describe, it, expect } from 'vitest';
import { updateTask } from '../taskService';

// Minimal Supabase query-builder stub. updateTask fetches the existing row via
// .from('tasks').select().eq().eq().single(), then writes via
// .from('tasks').update(payload).eq().eq().select().single(). We capture the
// update payload so we can assert the server-managed snooze_count behaviour.
function makeSupabase(existingTask) {
  let updatePayload = null;
  const supabase = {
    from() {
      return {
        select() {
          const chain = {
            eq() { return chain; },
            single: async () => ({ data: existingTask, error: null }),
          };
          return chain;
        },
        update(payload) {
          updatePayload = payload;
          const chain = {
            eq() { return chain; },
            neq() { return chain; },
            select() {
              return {
                single: async () => ({ data: { ...existingTask, ...payload }, error: null }),
              };
            },
          };
          return chain;
        },
      };
    },
    getUpdatePayload: () => updatePayload,
  };
  return supabase;
}

const USER_ID = 'user-1';
const baseTask = {
  id: 'task-1',
  user_id: USER_ID,
  name: 'A task',
  state: 'backlog',
  project_id: null,
  snoozed_until: null,
  snooze_count: 0,
};

const opts = { skipOffice365Sync: true, skipProjectTouch: true };

async function runUpdate(existingOverrides, updates) {
  const existing = { ...baseTask, ...existingOverrides };
  const supabase = makeSupabase(existing);
  const result = await updateTask({ supabase, userId: USER_ID, taskId: existing.id, updates, options: opts });
  return { result, payload: supabase.getUpdatePayload() };
}

describe('updateTask — first-class snooze (F2)', () => {
  it('increments snooze_count when a new non-null snooze date is set', async () => {
    const { result, payload } = await runUpdate(
      { snoozed_until: null, snooze_count: 2 },
      { snoozed_until: '2026-07-15' }
    );
    expect(result.error).toBeUndefined();
    expect(payload.snoozed_until).toBe('2026-07-15');
    expect(payload.snooze_count).toBe(3);
  });

  it('increments when re-snoozing to a different date', async () => {
    const { payload } = await runUpdate(
      { snoozed_until: '2026-07-12', snooze_count: 1 },
      { snoozed_until: '2026-07-20' }
    );
    expect(payload.snoozed_until).toBe('2026-07-20');
    expect(payload.snooze_count).toBe(2);
  });

  it('does NOT increment when re-snoozing to the same date', async () => {
    const { payload } = await runUpdate(
      { snoozed_until: '2026-07-15', snooze_count: 2 },
      { snoozed_until: '2026-07-15' }
    );
    expect(payload.snoozed_until).toBe('2026-07-15');
    expect(payload.snooze_count).toBeUndefined();
  });

  it('does NOT change snooze_count when clearing the snooze (null)', async () => {
    const { payload } = await runUpdate(
      { snoozed_until: '2026-07-15', snooze_count: 2 },
      { snoozed_until: null }
    );
    expect(payload.snoozed_until).toBeNull();
    expect(payload.snooze_count).toBeUndefined();
  });

  it('never lets a client set snooze_count directly (server-managed)', async () => {
    const { payload } = await runUpdate(
      { snoozed_until: null, snooze_count: 0 },
      { snoozed_until: '2026-07-15', snooze_count: 99 }
    );
    // The client-supplied 99 is stripped by the update allowlist; the server
    // computes the real value from the increment rule (0 + 1).
    expect(payload.snooze_count).toBe(1);
  });
});
