import { describe, it, expect } from 'vitest';
import { updateTask } from '../taskService';

// Minimal Supabase query-builder stub. updateTask fetches the existing row via
// .from('tasks').select().eq().eq().single(); may probe the append sort_order via
// .select('sort_order').eq()...not()...order().limit(); then writes via
// .from('tasks').update(payload).eq().eq().select().single(). We capture the
// update payload so we can assert the server-managed inbox-clear behaviour.
function makeSupabase(existingTask) {
  let updatePayload = null;
  function makeSelectChain() {
    const chain = {
      eq() { return chain; },
      not() { return chain; },
      is() { return chain; },
      order() { return chain; },
      // computeAppendSortOrder awaits .order().limit(); an empty bucket is fine.
      limit: async () => ({ data: [], error: null }),
      // existing-row fetch awaits .single().
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
  name: 'A captured task',
  state: 'backlog',
  today_section: null,
  due_date: null,
  project_id: null,
  snoozed_until: null,
  snooze_count: 0,
  inbox: true,
};

const opts = { skipOffice365Sync: true, skipProjectTouch: true };

async function runUpdate(existingOverrides, updates) {
  const existing = { ...baseTask, ...existingOverrides };
  const supabase = makeSupabase(existing);
  const result = await updateTask({ supabase, userId: USER_ID, taskId: existing.id, updates, options: opts });
  return { result, payload: supabase.getUpdatePayload() };
}

describe('updateTask — capture inbox clear-on-triage (F3)', () => {
  it('clears inbox when the task is placed into a section (state change)', async () => {
    const { result, payload } = await runUpdate(
      { state: 'backlog', inbox: true },
      { state: 'today', today_section: 'must_do' }
    );
    expect(result.error).toBeUndefined();
    expect(payload.inbox).toBe(false);
  });

  it('clears inbox when the task is completed (state -> done)', async () => {
    const { payload } = await runUpdate(
      { state: 'backlog', inbox: true },
      { state: 'done' }
    );
    expect(payload.inbox).toBe(false);
  });

  it('clears inbox when the due date is set (defer)', async () => {
    const { payload } = await runUpdate(
      { state: 'backlog', due_date: null, inbox: true },
      { due_date: '2026-07-20' }
    );
    expect(payload.inbox).toBe(false);
  });

  it('does NOT clear inbox when the task is only snoozed (deferral, not triage)', async () => {
    // Snoozing must keep inbox set so the capture re-surfaces in the inbox bucket
    // once the snooze expires, instead of vanishing from the triage flow.
    const { payload } = await runUpdate(
      { state: 'backlog', snoozed_until: null, inbox: true },
      { snoozed_until: '2026-07-20' }
    );
    expect(payload.inbox).toBeUndefined();
  });

  it('clears inbox on a section-only move within Today', async () => {
    const { payload } = await runUpdate(
      { state: 'today', today_section: 'good_to_do', inbox: true },
      { today_section: 'must_do' }
    );
    expect(payload.inbox).toBe(false);
  });

  it('does NOT clear inbox on a plain rename', async () => {
    const { payload } = await runUpdate(
      { state: 'backlog', inbox: true },
      { name: 'Renamed but not triaged' }
    );
    expect(payload.inbox).toBeUndefined();
  });

  it('does NOT clear inbox on a description/area edit', async () => {
    const { payload } = await runUpdate(
      { state: 'backlog', inbox: true },
      { description: 'more detail', area: 'Ops' }
    );
    expect(payload.inbox).toBeUndefined();
  });

  it('is a no-op for a task that is not in the inbox', async () => {
    const { payload } = await runUpdate(
      { state: 'backlog', inbox: false },
      { state: 'today', today_section: 'must_do' }
    );
    // Never writes inbox for a task that was not flagged in the first place.
    expect(payload.inbox).toBeUndefined();
  });

  it('does NOT clear inbox when a no-op state value matches the current state', async () => {
    const { payload } = await runUpdate(
      { state: 'backlog', inbox: true },
      { state: 'backlog' }
    );
    expect(payload.inbox).toBeUndefined();
  });
});
