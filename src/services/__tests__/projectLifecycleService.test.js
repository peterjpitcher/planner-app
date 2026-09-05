import { describe, it, expect, vi } from 'vitest';
import {
  changeProjectStatus,
  deleteProjectPreservingContent,
  getOpenProjectTasks,
  getReopeningProjectTasks,
  getProjectDeletionImpact,
  isClosingStatus,
  taskStateForClosingStatus,
} from '../projectLifecycleService';
import { PROJECT_STATUS, STATE, ACTIVE_STATES } from '@/lib/constants';

/**
 * The cascade itself now lives in Postgres functions, because closing a project
 * touches the project, its tasks, its notes, a close-out note and possibly some
 * facts, and separate Supabase client calls are separate PostgREST requests and
 * therefore separate transactions.
 *
 * So these tests cover what this module is still responsible for: deciding
 * which RPC to call, passing the right arguments, and shaping the result. The
 * SQL behaviour is verified against the real database instead, where a mocked
 * client could not tell you anything true about a trigger or a transaction.
 */

function makeRpcSupabase(result = {}, { error = null } = {}) {
  const rpc = vi.fn().mockResolvedValue({ data: result, error });
  return { rpc, from: () => { throw new Error('should go through the RPC'); } };
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

describe('taskStateForClosingStatus', () => {
  it('completes the work of a completed project and abandons a cancelled one', () => {
    expect(taskStateForClosingStatus(PROJECT_STATUS.COMPLETED)).toBe(STATE.DONE);
    expect(taskStateForClosingStatus(PROJECT_STATUS.CANCELLED)).toBe(STATE.CANCELLED);
  });

  it('returns null for a status that does not close', () => {
    expect(taskStateForClosingStatus(PROJECT_STATUS.OPEN)).toBeNull();
  });
});

describe('changeProjectStatus', () => {
  it('does nothing when the status has not actually changed', async () => {
    const supabase = makeRpcSupabase();
    const { data } = await changeProjectStatus({
      supabase,
      ...base,
      previousStatus: PROJECT_STATUS.OPEN,
      nextStatus: PROJECT_STATUS.OPEN,
    });

    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(data.tasksChanged).toBe(0);
  });

  it('closes through close_project, in one transaction', async () => {
    const supabase = makeRpcSupabase({ tasksChanged: 3, notesMoved: 2, taskState: 'done' });
    await changeProjectStatus({
      supabase,
      ...base,
      previousStatus: PROJECT_STATUS.OPEN,
      nextStatus: PROJECT_STATUS.COMPLETED,
    });

    expect(supabase.rpc).toHaveBeenCalledWith('close_project', {
      p_project_id: 'project-1',
      p_user_id: 'user-1',
      p_status: PROJECT_STATUS.COMPLETED,
      p_closeout_note: null,
      p_facts: null,
    });
  });

  it('passes the close-out note and facts through', async () => {
    const supabase = makeRpcSupabase({ tasksChanged: 0, notesMoved: 0, factsAdded: 1 });
    await changeProjectStatus({
      supabase,
      ...base,
      previousStatus: PROJECT_STATUS.OPEN,
      nextStatus: PROJECT_STATUS.CANCELLED,
      closeoutNote: 'Remember the invoicing quirk',
      facts: [{ label: 'PO portal', value: 'https://example.test' }],
    });

    const args = supabase.rpc.mock.calls[0][1];
    expect(args.p_closeout_note).toBe('Remember the invoicing quirk');
    expect(args.p_facts).toHaveLength(1);
  });

  it('sends null rather than an empty array when there are no facts', async () => {
    // An empty array would make the function iterate nothing and still look
    // like an intent to add facts.
    const supabase = makeRpcSupabase({});
    await changeProjectStatus({
      supabase,
      ...base,
      previousStatus: PROJECT_STATUS.OPEN,
      nextStatus: PROJECT_STATUS.COMPLETED,
      facts: [],
    });

    expect(supabase.rpc.mock.calls[0][1].p_facts).toBeNull();
  });

  it('reports how many notes moved to the customer', async () => {
    const supabase = makeRpcSupabase({ tasksChanged: 1, notesMoved: 7, taskState: 'done' });
    const { data } = await changeProjectStatus({
      supabase,
      ...base,
      previousStatus: PROJECT_STATUS.OPEN,
      nextStatus: PROJECT_STATUS.COMPLETED,
    });

    expect(data.notesMoved).toBe(7);
    expect(data.tasksChanged).toBe(1);
  });

  it('reopens through reopen_project', async () => {
    const supabase = makeRpcSupabase({ tasksRestored: 4, notesReturned: 2 });
    const { data } = await changeProjectStatus({
      supabase,
      ...base,
      previousStatus: PROJECT_STATUS.CANCELLED,
      nextStatus: PROJECT_STATUS.OPEN,
    });

    expect(supabase.rpc).toHaveBeenCalledWith('reopen_project', {
      p_project_id: 'project-1',
      p_user_id: 'user-1',
      p_status: PROJECT_STATUS.OPEN,
    });
    expect(data.tasksChanged).toBe(4);
    expect(data.notesReturned).toBe(2);
    expect(data.taskState).toBe(STATE.BACKLOG);
  });

  it('reports no landing state when a reopen restored nothing', async () => {
    const supabase = makeRpcSupabase({ tasksRestored: 0, notesReturned: 0 });
    const { data } = await changeProjectStatus({
      supabase,
      ...base,
      previousStatus: PROJECT_STATUS.COMPLETED,
      nextStatus: PROJECT_STATUS.OPEN,
    });

    expect(data.taskState).toBeNull();
  });

  it.each([
    ['Open', 'In Progress'], ['Open', 'On Hold'],
    ['In Progress', 'Open'], ['In Progress', 'On Hold'],
    ['On Hold', 'Open'], ['On Hold', 'In Progress'],
  ])('persists %s to %s without touching tasks', async (previousStatus, nextStatus) => {
    const chain = {
      update: vi.fn(() => chain), eq: vi.fn(() => chain), select: vi.fn(() => chain),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'project-1' } }),
    };
    const supabase = { from: vi.fn(() => chain), rpc: vi.fn() };
    const { data } = await changeProjectStatus({ supabase, ...base, previousStatus, nextStatus });
    expect(supabase.from).toHaveBeenCalledExactlyOnceWith('projects');
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ status: nextStatus }));
    expect(chain.eq.mock.calls).toEqual([['id', 'project-1'], ['user_id', 'user-1'], ['status', previousStatus]]);
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(data.tasksChanged).toBe(0);
  });

  it('rejects an active status change when its prior state changed concurrently', async () => {
    const chain = { update: () => chain, eq: () => chain, select: () => chain, maybeSingle: async () => ({ data: null }) };
    const result = await changeProjectStatus({ supabase: { from: () => chain }, ...base, previousStatus: 'Open', nextStatus: 'On Hold' });
    expect(result.error.status).toBe(409);
  });

  it('surfaces an ownership failure as a 403 rather than a 500', async () => {
    const supabase = makeRpcSupabase(null, {
      error: { code: '42501', message: 'project is not owned by user' },
    });

    const { error } = await changeProjectStatus({
      supabase,
      ...base,
      previousStatus: PROJECT_STATUS.OPEN,
      nextStatus: PROJECT_STATUS.COMPLETED,
    });

    expect(error.status).toBe(403);
  });
});

describe('deleteProjectPreservingContent', () => {
  it('preserves content by default', async () => {
    const supabase = makeRpcSupabase({ notesKept: 12, tasksUnassigned: 8 });
    const { data } = await deleteProjectPreservingContent({ supabase, ...base });

    expect(supabase.rpc).toHaveBeenCalledWith('delete_project_preserving_content', {
      p_project_id: 'project-1',
      p_user_id: 'user-1',
      p_destroy_content: false,
    });
    expect(data.notesKept).toBe(12);
  });

  it('destroys content only on an explicit opt-in', async () => {
    const supabase = makeRpcSupabase({ notesDestroyed: 12 });
    await deleteProjectPreservingContent({ supabase, ...base, destroyContent: true });

    expect(supabase.rpc.mock.calls[0][1].p_destroy_content).toBe(true);
  });

  it('coerces a truthy value rather than passing it through', async () => {
    const supabase = makeRpcSupabase({});
    await deleteProjectPreservingContent({ supabase, ...base, destroyContent: 'yes' });

    expect(supabase.rpc.mock.calls[0][1].p_destroy_content).toBe(true);
  });
});

describe('getOpenProjectTasks', () => {
  it('asks only for the states that count as live work', async () => {
    const captured = {};
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: (column, values) => {
        captured[column] = values;
        return chain;
      },
      order: () => chain,
      then: (resolve) => Promise.resolve({ data: [{ id: 't1' }], error: null }).then(resolve),
    };
    // Two .order() calls end the chain, so the last one has to resolve.
    chain.order = () => ({ order: async () => ({ data: [{ id: 't1' }], error: null }), ...chain });

    const supabase = { from: () => chain };
    const { data } = await getOpenProjectTasks({ supabase, ...base });

    expect(captured.state).toEqual(ACTIVE_STATES);
    expect(data).toHaveLength(1);
  });
});

describe('getProjectDeletionImpact', () => {
  it('names the customer the notes will move to', async () => {
    // The dialog has to say where things go, not only what is destroyed.
    const supabase = {
      from: (table) => {
        if (table === 'tasks') {
          return {
            select: () => ({
              eq: () => ({ eq: () => ({ not: async () => ({ count: 5, error: null }) }) }),
            }),
          };
        }
        if (table === 'notes') {
          return {
            select: () => ({
              eq: () => ({ or: async () => ({ data: [{ id: 'n1' }, { id: 'n2' }], error: null }) }),
            }),
          };
        }
        if (table === 'projects') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { id: 'project-1', name: 'Rebuild', customer_id: 'cust-1' },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: 'Acme Ltd' }, error: null }) }) }),
        };
      },
    };

    const { data } = await getProjectDeletionImpact({ supabase, ...base });

    expect(data.taskCount).toBe(5);
    expect(data.noteCount).toBe(2);
    expect(data.customerName).toBe('Acme Ltd');
  });
});


describe('reopening impact', () => {
  it('lists only cancelled work carrying the lifecycle receipt', async () => {
    const chain = {
      select: vi.fn(() => chain), eq: vi.fn(() => chain), not: vi.fn(() => chain),
      order: vi.fn(async () => ({ data: [{ id: 't1', name: 'Cancelled by project' }] })),
    };
    const result = await getReopeningProjectTasks({ supabase: { from: () => chain }, ...base, status: 'Cancelled' });
    expect(chain.eq.mock.calls).toEqual([['project_id', 'project-1'], ['user_id', 'user-1'], ['state', 'cancelled']]);
    expect(chain.not).toHaveBeenCalledWith('lifecycle_move_id', 'is', null);
    expect(result.data[0].name).toBe('Cancelled by project');
  });
  it.each(['Completed', 'Open'])('does not restore work for %s projects', async status => {
    const supabase = { from: vi.fn() };
    expect(await getReopeningProjectTasks({ supabase, ...base, status })).toEqual({ data: [] });
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
