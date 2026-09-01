import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callRpc, mapRpcError } from '../rpc';

describe('mapRpcError', () => {
  let consoleError;

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('maps the ownership guard to 403 rather than 500', () => {
    // fn_assert_project_owner raises 42501 when p_user_id does not own the row.
    // Without this mapping every "not yours" would surface as a server error.
    const result = mapRpcError(
      { code: '42501', message: 'project abc is not owned by user xyz' },
      'close_project'
    );

    expect(result.status).toBe(403);
    expect(result.code).toBe('42501');
  });

  it('maps a duplicate customer name to 409 so the client can offer the existing record', () => {
    const result = mapRpcError(
      { code: '23505', message: 'duplicate key value violates unique constraint' },
      'create_task_with_customer'
    );

    expect(result.status).toBe(409);
  });

  it('maps a check constraint breach to 400', () => {
    const result = mapRpcError({ code: '23514', message: 'check constraint' }, 'close_project');
    expect(result.status).toBe(400);
  });

  it('maps a missing required argument to 400', () => {
    const result = mapRpcError(
      { code: '22023', message: 'project and user are both required' },
      'close_project'
    );
    expect(result.status).toBe(400);
  });

  it('recognises a named condition when the code alone is ambiguous', () => {
    const result = mapRpcError(
      { code: 'P0001', message: 'project_closed: reopen before reassigning' },
      'reassign_project_customer'
    );

    expect(result.status).toBe(409);
  });

  it('falls back to 500 for anything unrecognised', () => {
    const result = mapRpcError({ code: 'XX000', message: 'internal' }, 'close_project');
    expect(result.status).toBe(500);
  });

  it('does not leak internals on a 500, and does log them', () => {
    const result = mapRpcError(
      { code: 'XX000', message: 'relation "secret_table" does not exist' },
      'close_project'
    );

    expect(result.message).toBe('Internal server error');
    expect(result.message).not.toContain('secret_table');
    expect(consoleError).toHaveBeenCalled();
  });

  it('passes a 4xx message through, because it is the caller who must act on it', () => {
    const result = mapRpcError(
      { code: '42501', message: 'project abc is not owned by user xyz' },
      'close_project'
    );

    expect(result.message).toContain('not owned');
  });

  it('does not log a 4xx as a server error', () => {
    mapRpcError({ code: '42501', message: 'nope' }, 'close_project');
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe('callRpc', () => {
  it('returns the data with no error on success', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: { tasksChanged: 3 }, error: null }) };

    const result = await callRpc(supabase, 'close_project', { p_project_id: 'p1' });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ tasksChanged: 3 });
    expect(supabase.rpc).toHaveBeenCalledWith('close_project', { p_project_id: 'p1' });
  });

  it('returns a mapped error rather than throwing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'not yours' } }),
    };

    const result = await callRpc(supabase, 'close_project', {});

    expect(result.data).toBeNull();
    expect(result.error.status).toBe(403);
    consoleError.mockRestore();
  });

  it('defaults params to an empty object', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) };
    await callRpc(supabase, 'some_fn');
    expect(supabase.rpc).toHaveBeenCalledWith('some_fn', {});
  });
});
