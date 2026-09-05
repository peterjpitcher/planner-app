import { describe, expect, it, vi } from 'vitest';
import { promoteIdea } from '../ideaService';

describe('idea promotion transaction', () => {
  it('uses one RPC with server-owned identity and returns its task', async () => {
    const task = { id: 'task-1', source_idea_id: 'idea-1' };
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: task }), from: vi.fn() };
    expect(await promoteIdea({ supabase, userId: 'user-1', ideaId: 'idea-1' })).toEqual({ data: task });
    expect(supabase.rpc).toHaveBeenCalledExactlyOnceWith('promote_idea', { p_user_id: 'user-1', p_idea_id: 'idea-1' });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it.each([['23505', 409], ['P0002', 404], ['42501', 403], ['23514', 400]])('preserves the %s error without compensating writes', async (code, status) => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ error: { code, message: 'Rejected' } }), from: vi.fn() };
    const result = await promoteIdea({ supabase, userId: 'u1', ideaId: 'i1' });
    expect(result.error.status).toBe(status);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('fails closed when the RPC is unavailable', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = { rpc: vi.fn().mockResolvedValue({ error: { code: 'PGRST202', message: 'Function missing' } }), from: vi.fn() };
    expect((await promoteIdea({ supabase, userId: 'u1', ideaId: 'i1' })).error.status).toBe(500);
    expect(supabase.from).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
