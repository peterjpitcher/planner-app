import { describe, it, expect, vi } from 'vitest';
import { updateTask, spawnNextRecurrence } from '../taskService';
import { getLondonDateKey } from '@/lib/timezone';
import { nextRecurrenceDate } from '@/lib/recurrence';

vi.mock('@/services/office365SyncService', () => ({ syncOffice365Task: vi.fn(), deleteOffice365Task: vi.fn() }));

const baseTask = {
  id: 'task-1', user_id: 'user-1', name: 'Standup', state: 'today',
  today_section: 'must_do', project_id: null, customer_id: 'customer-1',
  due_date: '2030-03-10', recurrence: 'daily', recurrence_interval: 1,
};
const options = { skipOffice365Sync: true, skipProjectTouch: true };

function makeSupabase(existing, { rpcError = null, duplicate = false, lostRace = false } = {}) {
  let update;
  const rpc = vi.fn().mockResolvedValue({
    data: duplicate ? { spawned: false, reason: 'already_exists' } : { spawned: true, task: { id: 'next-1' } },
    error: rpcError,
  });
  const from = vi.fn(() => {
    let writing = false;
    const chain = {
      select: vi.fn(() => chain), eq: vi.fn(() => chain), neq: vi.fn(() => chain),
      not: vi.fn(() => chain), is: vi.fn(() => chain), order: vi.fn(() => chain),
      limit: vi.fn(async () => ({ data: [] })),
      update: vi.fn(payload => { update = payload; writing = true; return chain; }),
      single: vi.fn(async () => writing && lostRace
        ? { error: { code: 'PGRST116' } }
        : { data: { ...existing, ...(writing ? update : {}) } }),
    };
    return chain;
  });
  return { from, rpc, getUpdate: () => update };
}

async function runUpdate(overrides = {}, updates = { state: 'done' }, settings = {}) {
  const task = { ...baseTask, ...overrides };
  const supabase = makeSupabase(task, settings);
  const result = await updateTask({ supabase, userId: task.user_id, taskId: task.id, updates, options });
  return { result, supabase };
}

describe('recurrence completion', () => {
  it('passes the source identity and next date to the atomic RPC', async () => {
    const { result, supabase } = await runUpdate();
    expect(result.data.state).toBe('done');
    expect(result.data.customer_id).toBe('customer-1');
    expect(supabase.rpc).toHaveBeenCalledExactlyOnceWith('spawn_task_recurrence', {
      p_user_id: 'user-1', p_task_id: 'task-1', p_due_date: '2030-03-11',
    });
  });

  it('accepts an existing source receipt without creating a task locally', async () => {
    const { result, supabase } = await runUpdate({}, { state: 'done' }, { duplicate: true });
    expect(result.data.state).toBe('done');
    expect(supabase.rpc).toHaveBeenCalledOnce();
    expect(supabase.from.mock.results.every(({ value }) => !value.insert)).toBe(true);
  });

  it.each([['2020-01-01'], [null]])('advances overdue or undated work from London today (%s)', async due_date => {
    const { supabase } = await runUpdate({ due_date });
    expect(supabase.rpc.mock.calls[0][1].p_due_date).toBe(nextRecurrenceDate(getLondonDateKey(), 'daily', 1));
  });

  it('respects the recurrence interval', async () => {
    const { supabase } = await runUpdate({ recurrence: 'weekly', recurrence_interval: 2 });
    expect(supabase.rpc.mock.calls[0][1].p_due_date).toBe('2030-03-24');
  });

  it.each([
    [{ state: 'done' }, { name: 'Rename' }],
    [{ recurrence: null }, { state: 'done' }],
    [{}, { today_section: 'good_to_do' }],
  ])('does not spawn without a new recurring completion', async (overrides, updates) => {
    const { supabase } = await runUpdate(overrides, updates);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('leaves completion intact and reports an RPC failure to logs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, supabase } = await runUpdate({}, { state: 'done' }, { rpcError: { message: 'Unavailable' } });
    expect(result.data.state).toBe('done');
    expect(supabase.rpc).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore(); log.mockRestore();
  });

  it('does not duplicate the winner when completion loses its race', async () => {
    const { supabase } = await runUpdate({}, { state: 'done' }, { lostRace: true });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('keeps same-name work on different projects separate through source ids', async () => {
    const supabase = makeSupabase(baseTask);
    for (const [id, project_id] of [['a', 'project-a'], ['b', 'project-b']]) {
      await spawnNextRecurrence({ supabase, userId: 'user-1', task: { ...baseTask, id, project_id } });
    }
    expect(supabase.rpc.mock.calls.map(call => call[1].p_task_id)).toEqual(['a', 'b']);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('rejects an invalid recurrence pattern before writing', async () => {
    const { result, supabase } = await runUpdate({}, { recurrence: 'yearly' });
    expect(result.error.status).toBe(400);
    expect(supabase.getUpdate()).toBeUndefined();
  });

  it('normalises invalid intervals and allows clearing recurrence', async () => {
    const first = await runUpdate({}, { recurrence: 'weekly', recurrence_interval: 0 });
    expect(first.supabase.getUpdate().recurrence_interval).toBe(1);
    const second = await runUpdate({}, { recurrence: null });
    expect(second.supabase.getUpdate().recurrence).toBeNull();
  });
});
