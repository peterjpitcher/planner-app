import { describe, it, expect } from 'vitest';
import {
  cascadeProjectStatusToTasks,
  isClosingStatus,
  getOpenProjectTasks,
} from '../projectLifecycleService';
import { PROJECT_STATUS, STATE, ACTIVE_STATES } from '@/lib/constants';

// Supabase query-builder stub. The cascade writes via
// .from('tasks').update(payload).eq().eq().in()/.eq().select(), and reads via
// .from('tasks').select().eq().eq().in().order().order(). We capture the update
// payload and the state filter so we can assert which rows would be touched.
function makeSupabase({ rows = [], error = null } = {}) {
  const calls = { updatePayload: null, stateFilterIn: null, stateFilterEq: null, selected: false };
  const supabase = {
    from() {
      return {
        select() {
          calls.selected = true;
          const chain = {
            eq(col, val) { if (col === 'state') calls.stateFilterEq = val; return chain; },
            in(col, val) { if (col === 'state') calls.stateFilterIn = val; return chain; },
            order() { return chain; },
            then: undefined,
          };
          // Terminal await on the read path resolves to the row set.
          chain.order = () => ({
            order: async () => ({ data: rows, error }),
          });
          return chain;
        },
        update(payload) {
          calls.updatePayload = payload;
          const chain = {
            eq(col, val) { if (col === 'state') calls.stateFilterEq = val; return chain; },
            in(col, val) { if (col === 'state') calls.stateFilterIn = val; return chain; },
            select: async () => ({ data: rows, error }),
          };
          return chain;
        },
      };
    },
    calls,
  };
  return supabase;
}

const base = { userId: 'user-1', projectId: 'project-1' };

describe('isClosingStatus', () => {
  it('treats Completed and Cancelled as closing', () => {
    expect(isClosingStatus(PROJECT_STATUS.COMPLETED)).toBe(true);
    expect(isClosingStatus(PROJECT_STATUS.CANCELLED)).toBe(true);
  });

  it('treats the live statuses as non-closing', () => {
    expect(isClosingStatus(PROJECT_STATUS.OPEN)).toBe(false);
    expect(isClosingStatus(PROJECT_STATUS.IN_PROGRESS)).toBe(false);
    expect(isClosingStatus(PROJECT_STATUS.ON_HOLD)).toBe(false);
  });
});

describe('cascadeProjectStatusToTasks', () => {
  it('cancels open tasks when the project is cancelled', async () => {
    const supabase = makeSupabase({ rows: [{ id: 't1' }, { id: 't2' }] });
    const { data } = await cascadeProjectStatusToTasks({
      supabase, ...base,
      previousStatus: PROJECT_STATUS.OPEN,
      nextStatus: PROJECT_STATUS.CANCELLED,
    });

    expect(supabase.calls.updatePayload.state).toBe(STATE.CANCELLED);
    expect(data.tasksChanged).toBe(2);
    expect(data.taskState).toBe(STATE.CANCELLED);
  });

  it('completes open tasks when the project is completed', async () => {
    const supabase = makeSupabase({ rows: [{ id: 't1' }] });
    const { data } = await cascadeProjectStatusToTasks({
      supabase, ...base,
      previousStatus: PROJECT_STATUS.IN_PROGRESS,
      nextStatus: PROJECT_STATUS.COMPLETED,
    });

    expect(supabase.calls.updatePayload.state).toBe(STATE.DONE);
    expect(data.tasksChanged).toBe(1);
  });

  it('only touches active tasks, never already-closed ones', async () => {
    // Re-cancelling must not resurrect a done task into the cancelled bucket,
    // which would wrongly remove it from the completed report.
    const supabase = makeSupabase({ rows: [] });
    await cascadeProjectStatusToTasks({
      supabase, ...base,
      previousStatus: PROJECT_STATUS.OPEN,
      nextStatus: PROJECT_STATUS.CANCELLED,
    });

    expect(supabase.calls.stateFilterIn).toEqual(ACTIVE_STATES);
    expect(supabase.calls.stateFilterIn).not.toContain(STATE.DONE);
  });

  it('never writes completed_at or cancelled_at (owned by the DB trigger)', async () => {
    const supabase = makeSupabase({ rows: [{ id: 't1' }] });
    await cascadeProjectStatusToTasks({
      supabase, ...base,
      previousStatus: PROJECT_STATUS.OPEN,
      nextStatus: PROJECT_STATUS.COMPLETED,
    });

    expect(supabase.calls.updatePayload).not.toHaveProperty('completed_at');
    expect(supabase.calls.updatePayload).not.toHaveProperty('cancelled_at');
  });

  it('restores cancelled tasks to backlog when a cancelled project reopens', async () => {
    const supabase = makeSupabase({ rows: [{ id: 't1' }, { id: 't2' }, { id: 't3' }] });
    const { data } = await cascadeProjectStatusToTasks({
      supabase, ...base,
      previousStatus: PROJECT_STATUS.CANCELLED,
      nextStatus: PROJECT_STATUS.OPEN,
    });

    expect(supabase.calls.updatePayload.state).toBe(STATE.BACKLOG);
    expect(supabase.calls.stateFilterEq).toBe(STATE.CANCELLED);
    expect(data.tasksChanged).toBe(3);
  });

  it('leaves completed tasks completed when a completed project reopens', async () => {
    // Those tasks were genuinely finished, so reopening the project must not
    // drag them back into the backlog.
    const supabase = makeSupabase({ rows: [] });
    const { data } = await cascadeProjectStatusToTasks({
      supabase, ...base,
      previousStatus: PROJECT_STATUS.COMPLETED,
      nextStatus: PROJECT_STATUS.OPEN,
    });

    expect(supabase.calls.updatePayload).toBeNull();
    expect(data.tasksChanged).toBe(0);
  });

  it('does nothing when the status is unchanged', async () => {
    const supabase = makeSupabase({ rows: [] });
    const { data } = await cascadeProjectStatusToTasks({
      supabase, ...base,
      previousStatus: PROJECT_STATUS.OPEN,
      nextStatus: PROJECT_STATUS.OPEN,
    });

    expect(supabase.calls.updatePayload).toBeNull();
    expect(data.tasksChanged).toBe(0);
  });

  it('does nothing when moving between two live statuses', async () => {
    const supabase = makeSupabase({ rows: [] });
    const { data } = await cascadeProjectStatusToTasks({
      supabase, ...base,
      previousStatus: PROJECT_STATUS.OPEN,
      nextStatus: PROJECT_STATUS.ON_HOLD,
    });

    expect(supabase.calls.updatePayload).toBeNull();
    expect(data.tasksChanged).toBe(0);
  });

  it('surfaces a database error rather than reporting success', async () => {
    const supabase = makeSupabase({ rows: null, error: { message: 'boom' } });
    const { data, error } = await cascadeProjectStatusToTasks({
      supabase, ...base,
      previousStatus: PROJECT_STATUS.OPEN,
      nextStatus: PROJECT_STATUS.CANCELLED,
    });

    expect(data).toBeUndefined();
    expect(error.message).toBe('boom');
  });
});

describe('getOpenProjectTasks', () => {
  it('returns only active-state tasks, so the confirmation lists what will change', async () => {
    const rows = [{ id: 't1', name: 'Draft the brief', state: 'today', due_date: '2026-08-14' }];
    const supabase = makeSupabase({ rows });
    const { data } = await getOpenProjectTasks({ supabase, ...base });

    expect(supabase.calls.stateFilterIn).toEqual(ACTIVE_STATES);
    expect(data).toEqual(rows);
  });
});
