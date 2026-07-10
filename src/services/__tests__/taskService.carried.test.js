import { describe, it, expect } from 'vitest';
import { updateTask } from '../taskService';

// Minimal Supabase query-builder stub. updateTask fetches the existing row via
// .from('tasks').select().eq().eq().single(). When a state change triggers the
// server-side sort_order append, computeAppendSortOrder runs a second select that
// chains .eq()/.not()/.is()/.order()/.limit() and is awaited directly, so the
// select chain must resolve to { data, error } as well as expose .single(). The
// write goes through .update(payload).eq().eq().select().single(); we capture the
// payload to assert the carry-forward reset (A1).
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
            limit: async () => ({ data: [], error: null }),
            single: async () => ({ data: existingTask, error: null }),
          };
          return chain;
        },
        update(payload) {
          updatePayload = payload;
          const chain = {
            eq() { return chain; },
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
  state: 'this_week',
  today_section: null,
  project_id: null,
  snoozed_until: null,
  snooze_count: 0,
  carried_count: 2,
  carried_section: 'good_to_do',
};

const opts = { skipOffice365Sync: true, skipProjectTouch: true };

async function runUpdate(existingOverrides, updates) {
  const existing = { ...baseTask, ...existingOverrides };
  const supabase = makeSupabase(existing);
  const result = await updateTask({ supabase, userId: USER_ID, taskId: existing.id, updates, options: opts });
  return { result, payload: supabase.getUpdatePayload() };
}

describe('updateTask — carry-forward reset on re-triage (A1)', () => {
  it('resets carried_count/carried_section when restoring a carried task to Today (Keep yesterday’s plan)', async () => {
    const { result, payload } = await runUpdate(
      { state: 'this_week', today_section: null, carried_count: 3, carried_section: 'quick_wins' },
      { state: 'today', today_section: 'quick_wins' }
    );
    expect(result.error).toBeUndefined();
    expect(payload.state).toBe('today');
    expect(payload.today_section).toBe('quick_wins');
    expect(payload.carried_count).toBe(0);
    expect(payload.carried_section).toBeNull();
  });

  it('resets when a Today task is re-placed into a different section (no state change)', async () => {
    const { payload } = await runUpdate(
      { state: 'today', today_section: 'good_to_do', carried_count: 2, carried_section: null },
      { today_section: 'must_do' }
    );
    expect(payload.today_section).toBe('must_do');
    expect(payload.carried_count).toBe(0);
    expect(payload.carried_section).toBeNull();
  });

  it('resets when a carried task is demoted to backlog (this_week → backlog)', async () => {
    const { payload } = await runUpdate(
      { state: 'this_week', today_section: null, carried_count: 1, carried_section: 'good_to_do' },
      { state: 'backlog' }
    );
    expect(payload.state).toBe('backlog');
    expect(payload.carried_count).toBe(0);
    expect(payload.carried_section).toBeNull();
  });

  it('does NOT touch carry markers on a plain edit (name only)', async () => {
    const { payload } = await runUpdate(
      { state: 'today', today_section: 'must_do', carried_count: 2, carried_section: null },
      { name: 'Renamed task' }
    );
    expect(payload.name).toBe('Renamed task');
    expect(payload.carried_count).toBeUndefined();
    expect(payload.carried_section).toBeUndefined();
  });

  it('never lets a client set carried_count / carried_section directly (server-managed)', async () => {
    const { payload } = await runUpdate(
      { state: 'today', today_section: 'must_do', carried_count: 2, carried_section: null },
      { name: 'Renamed', carried_count: 99, carried_section: 'quick_wins' }
    );
    // Both are absent from TASK_UPDATE_FIELDS, so the client values are stripped;
    // with no re-triage in this update the server leaves the markers untouched.
    expect(payload.carried_count).toBeUndefined();
    expect(payload.carried_section).toBeUndefined();
  });
});
