import { describe, expect, it, vi } from 'vitest';
import { deleteTask } from '../taskService';
import { deleteOffice365Task } from '../office365SyncService';
vi.mock('../office365SyncService', () => ({ deleteOffice365Task: vi.fn(), syncOffice365Task: vi.fn() }));

function database() {
  const chain = { select: () => chain, eq: () => chain,
    single: async () => ({ data: { user_id: 'u1', project_id: null } }),
    then: resolve => Promise.resolve({ error: null }).then(resolve) };
  const remove = vi.fn(() => chain);
  return { from: () => ({ ...chain, delete: remove }), remove };
}

describe('task deletion keeps local content when remote removal fails', () => {
  it('propagates the remote failure before deleting locally', async () => {
    const supabase = database();
    deleteOffice365Task.mockResolvedValueOnce({ error: { status: 503, message: 'Try again' } });
    const result = await deleteTask({ supabase, userId: 'u1', taskId: 't1' });
    expect(result.error.status).toBe(503);
    expect(supabase.remove).not.toHaveBeenCalled();
  });
  it('fails closed on an unexpected exception', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const supabase = database();
    deleteOffice365Task.mockRejectedValueOnce(new Error('Token lookup failed'));
    const result = await deleteTask({ supabase, userId: 'u1', taskId: 't1' });
    expect(result.error.status).toBe(503);
    expect(supabase.remove).not.toHaveBeenCalled();
    warn.mockRestore();
  });
  it('deletes locally after the remote removal succeeds', async () => {
    const supabase = database();
    deleteOffice365Task.mockResolvedValueOnce({ error: null });
    const result = await deleteTask({ supabase, userId: 'u1', taskId: 't1' });
    expect(result.data.success).toBe(true);
    expect(supabase.remove).toHaveBeenCalledOnce();
  });
});
