import { describe, it, expect } from 'vitest';
import { updateTask } from '../taskService';

// Minimal Supabase query-builder stub. updateTask fetches the existing row via
// .from('tasks').select().eq().eq().single(), then writes via
// .from('tasks').update(payload).eq().eq().select().single(). The chase-engine
// updates below never change state, so no server-side sort_order append runs and
// the simple select chain (eq/single) is sufficient. We capture the update
// payload to assert the server-managed chase_count behaviour (Wave 7).
function makeSupabase(existingTask) {
  let updatePayload = null;
  const supabase = {
    from() {
      return {
        select() {
          const chain = {
            eq() { return chain; },
            not() { return chain; },
            is() { return chain; },
            order() { return chain; },
            // computeAppendSortOrder awaits .order().limit() when a state change
            // triggers the server-side sort_order append; an empty bucket is fine.
            limit: async () => ({ data: [], error: null }),
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
  state: 'waiting',
  project_id: null,
  snoozed_until: null,
  snooze_count: 0,
  follow_up_date: null,
  chase_count: 0,
};

const opts = { skipOffice365Sync: true, skipProjectTouch: true };

async function runUpdate(existingOverrides, updates) {
  const existing = { ...baseTask, ...existingOverrides };
  const supabase = makeSupabase(existing);
  const result = await updateTask({ supabase, userId: USER_ID, taskId: existing.id, updates, options: opts });
  return { result, payload: supabase.getUpdatePayload() };
}

describe('updateTask — waiting chase engine (Wave 7)', () => {
  it('increments chase_count when a waiting task moves its follow-up strictly later', async () => {
    const { result, payload } = await runUpdate(
      { state: 'waiting', follow_up_date: '2026-07-11', chase_count: 1 },
      { follow_up_date: '2026-07-18' }
    );
    expect(result.error).toBeUndefined();
    expect(payload.follow_up_date).toBe('2026-07-18');
    expect(payload.chase_count).toBe(2);
  });

  it('does NOT increment on the first follow-up (null -> date)', async () => {
    const { payload } = await runUpdate(
      { state: 'waiting', follow_up_date: null, chase_count: 0 },
      { follow_up_date: '2026-07-18' }
    );
    expect(payload.follow_up_date).toBe('2026-07-18');
    expect(payload.chase_count).toBeUndefined();
  });

  it('does NOT increment when the new follow-up is earlier', async () => {
    const { payload } = await runUpdate(
      { state: 'waiting', follow_up_date: '2026-07-18', chase_count: 2 },
      { follow_up_date: '2026-07-12' }
    );
    expect(payload.follow_up_date).toBe('2026-07-12');
    expect(payload.chase_count).toBeUndefined();
  });

  it('does NOT increment when the new follow-up is the same date', async () => {
    const { payload } = await runUpdate(
      { state: 'waiting', follow_up_date: '2026-07-18', chase_count: 2 },
      { follow_up_date: '2026-07-18' }
    );
    expect(payload.follow_up_date).toBe('2026-07-18');
    expect(payload.chase_count).toBeUndefined();
  });

  it('does NOT increment when clearing the follow-up (date -> null)', async () => {
    const { payload } = await runUpdate(
      { state: 'waiting', follow_up_date: '2026-07-18', chase_count: 2 },
      { follow_up_date: null }
    );
    expect(payload.follow_up_date).toBeNull();
    expect(payload.chase_count).toBeUndefined();
  });

  it('does NOT increment for a non-waiting task even when moving the follow-up later', async () => {
    const { payload } = await runUpdate(
      { state: 'backlog', follow_up_date: '2026-07-11', chase_count: 0 },
      { follow_up_date: '2026-07-18' }
    );
    expect(payload.follow_up_date).toBe('2026-07-18');
    expect(payload.chase_count).toBeUndefined();
  });

  it('does NOT increment when the same update also moves the task OUT of waiting', async () => {
    // Unblocking a waiting task (state -> backlog) while pushing the follow-up
    // later must not credit a chase to a task that is leaving the waiting state.
    const { payload } = await runUpdate(
      { state: 'waiting', follow_up_date: '2026-07-11', chase_count: 0 },
      { state: 'backlog', follow_up_date: '2026-07-18' }
    );
    expect(payload.chase_count).toBeUndefined();
  });

  it('compares as date-only strings — a later time on the same day is not a chase', async () => {
    const { payload } = await runUpdate(
      { state: 'waiting', follow_up_date: '2026-07-18T09:00:00Z', chase_count: 1 },
      { follow_up_date: '2026-07-18T21:00:00Z' }
    );
    expect(payload.chase_count).toBeUndefined();
  });

  it('never lets a client set chase_count directly on a genuine chase (server computes it)', async () => {
    const { payload } = await runUpdate(
      { state: 'waiting', follow_up_date: '2026-07-11', chase_count: 0 },
      { follow_up_date: '2026-07-18', chase_count: 99 }
    );
    // The client-supplied 99 is stripped by the update allowlist; the server
    // computes the real value from the increment rule (0 + 1).
    expect(payload.chase_count).toBe(1);
  });

  it('strips a client-supplied chase_count when the update is not a chase', async () => {
    const { payload } = await runUpdate(
      { state: 'waiting', follow_up_date: '2026-07-18', chase_count: 2 },
      { name: 'Renamed', chase_count: 99 }
    );
    // chase_count is absent from TASK_UPDATE_FIELDS, so the client value is
    // dropped; with no strictly-later follow-up move the server leaves it alone.
    expect(payload.name).toBe('Renamed');
    expect(payload.chase_count).toBeUndefined();
  });
});
