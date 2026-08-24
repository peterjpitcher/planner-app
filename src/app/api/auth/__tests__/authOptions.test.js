import { describe, it, expect } from 'vitest';

// The route module reads Supabase config at import time, so this has to run
// before the dynamic import below rather than in a beforeAll hook.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.NEXTAUTH_SECRET ||= 'test-secret';

const { authOptions } = await import('../[...nextauth]/route');

const ATTACKER = { id: 'attacker-uuid', email: 'attacker@example.com', sub: 'attacker-uuid' };

describe('NextAuth jwt callback', () => {
  it('takes identity from the user object on first sign-in', async () => {
    const token = await authOptions.callbacks.jwt({
      token: {},
      user: { id: 'real-uuid', email: 'real@example.com' },
    });
    expect(token.id).toBe('real-uuid');
    expect(token.email).toBe('real@example.com');
  });

  it('ignores a client-supplied session update that tries to change the user id', async () => {
    // NextAuth v4 passes the raw POST body of /api/auth/session in as `session`.
    // Merging it into the token let a signed-in caller reissue their own cookie
    // as another user, and every API route scopes its queries on that id while
    // using the service-role client, so RLS would not catch it.
    const token = await authOptions.callbacks.jwt({
      token: { ...ATTACKER },
      trigger: 'update',
      session: { id: 'victim-uuid' },
    });
    expect(token.id).toBe('attacker-uuid');
  });

  it('ignores a client-supplied session update that tries to claim an admin email', async () => {
    const token = await authOptions.callbacks.jwt({
      token: { ...ATTACKER },
      trigger: 'update',
      session: { email: 'admin@example.com' },
    });
    expect(token.email).toBe('attacker@example.com');
  });

  it('ignores a client-supplied session update that tries to overwrite sub', async () => {
    const token = await authOptions.callbacks.jwt({
      token: { ...ATTACKER },
      trigger: 'update',
      session: { sub: 'victim-uuid', id: 'victim-uuid', email: 'victim@example.com' },
    });
    expect(token.sub).toBe('attacker-uuid');
    expect(token.id).toBe('attacker-uuid');
    expect(token.email).toBe('attacker@example.com');
  });
});

describe('NextAuth session callback', () => {
  it('derives the session identity from the token', async () => {
    const session = await authOptions.callbacks.session({
      session: { expires: '2026-12-01T00:00:00.000Z' },
      token: { id: 'real-uuid', email: 'real@example.com' },
    });
    expect(session.user).toEqual({ id: 'real-uuid', email: 'real@example.com' });
  });

  it('falls back to sub when the token carries no explicit id', async () => {
    const session = await authOptions.callbacks.session({
      session: {},
      token: { sub: 'real-uuid', email: 'real@example.com' },
    });
    expect(session.user.id).toBe('real-uuid');
  });

  it('never exposes tokens to the client', async () => {
    const session = await authOptions.callbacks.session({
      session: {},
      token: { id: 'real-uuid', email: 'real@example.com', accessToken: 'secret', refreshToken: 'secret' },
    });
    expect(JSON.stringify(session)).not.toContain('secret');
  });
});
