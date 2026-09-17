import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../[id]/route';
import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';

vi.mock('@/lib/authServer', () => ({ getAuthContext: vi.fn() }));
vi.mock('@/lib/supabaseServiceRole', () => ({ getSupabaseServiceRole: vi.fn() }));
vi.mock('@/lib/rateLimiter', () => ({
  getClientIdentifier: () => 'u1',
  checkRateLimit: () => ({ allowed: true }),
}));
vi.mock('@/services/office365SyncService', () => ({}));
vi.mock('@/services/projectLifecycleService', () => ({}));

const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_ID = '99999999-2222-4333-8444-555555555555';

function database({ projects = [], customers = [], failOn = null } = {}) {
  const tables = { projects, customers };
  return {
    from(table) {
      let rows = tables[table];
      const chain = {
        select: () => chain,
        eq(key, value) {
          rows = rows.filter((row) => row[key] === value);
          return chain;
        },
        maybeSingle: async () =>
          failOn === table
            ? { data: null, error: { message: 'Unavailable' } }
            : { data: rows[0] || null, error: null },
      };
      return chain;
    },
  };
}

function request(id) {
  return GET(new Request(`http://localhost/api/projects/${id}`), { params: Promise.resolve({ id }) });
}

describe('GET /api/projects/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthContext.mockResolvedValue({ session: { user: { id: 'u1' } } });
  });

  it('returns the project with its customer name', async () => {
    getSupabaseServiceRole.mockReturnValue(
      database({
        projects: [{ id: PROJECT_ID, user_id: 'u1', name: 'Menu refresh', customer_id: 'c1' }],
        customers: [{ id: 'c1', user_id: 'u1', name: 'The Anchor' }],
      })
    );

    const response = await request(PROJECT_ID);

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      id: PROJECT_ID,
      name: 'Menu refresh',
      customer_name: 'The Anchor',
    });
  });

  it("answers 404 for another user's project, the same as a missing one", async () => {
    getSupabaseServiceRole.mockReturnValue(
      database({ projects: [{ id: OTHER_ID, user_id: 'u2', name: 'Not yours' }] })
    );

    const response = await request(OTHER_ID);

    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain('Not yours');
  });

  it('answers 404 for an id that is not a uuid, without querying', async () => {
    const response = await request('not-a-uuid');
    expect(response.status).toBe(404);
    expect(getSupabaseServiceRole).not.toHaveBeenCalled();
  });

  it('requires a session', async () => {
    getAuthContext.mockResolvedValue({ session: null });
    const response = await request(PROJECT_ID);
    expect(response.status).toBe(401);
  });

  it('fails visibly when the customer lookup fails', async () => {
    getSupabaseServiceRole.mockReturnValue(
      database({
        projects: [{ id: PROJECT_ID, user_id: 'u1', name: 'Menu refresh', customer_id: 'c1' }],
        failOn: 'customers',
      })
    );

    const response = await request(PROJECT_ID);
    expect(response.status).toBe(500);
  });
});
