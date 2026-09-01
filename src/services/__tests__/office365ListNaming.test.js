import { describe, it, expect } from 'vitest';
import {
  LIST_NAME_SEPARATOR,
  attachCustomerNames,
  buildListDisplayName,
  resolveUnambiguousList,
} from '../office365SyncService';

const project = (overrides = {}) => ({
  id: 'a3fd7ac2-1d1d-4042-b687-7fea13426786',
  name: 'Website Rebuild',
  status: 'Open',
  ...overrides,
});

describe('buildListDisplayName', () => {
  it('prefixes the customer', () => {
    expect(buildListDisplayName(project(), 'Acme Ltd')).toBe('Acme Ltd: Website Rebuild');
  });

  it('leaves a project with no customer alone', () => {
    expect(buildListDisplayName(project(), null)).toBe('Website Rebuild');
    expect(buildListDisplayName(project(), '  ')).toBe('Website Rebuild');
  });

  it('keeps the separator in one place', () => {
    expect(buildListDisplayName(project(), 'Acme')).toContain(LIST_NAME_SEPARATOR);
  });

  it('truncates the customer first, so the project name survives intact', () => {
    const longCustomer = 'C'.repeat(200);
    const result = buildListDisplayName(project(), longCustomer);

    expect(result.length).toBeLessThanOrEqual(100);
    expect(result).toContain('Website Rebuild');
  });

  it('adds a stable id suffix when it truncates, so two long names cannot collide', () => {
    // Without the suffix, two different long project names under one customer
    // truncate to the same string, and adoption matches on name.
    const longCustomer = 'C'.repeat(200);
    const a = buildListDisplayName(project({ id: 'aaaa1111', name: 'X'.repeat(60) }), longCustomer);
    const b = buildListDisplayName(project({ id: 'bbbb2222', name: 'X'.repeat(60) }), longCustomer);

    expect(a).not.toBe(b);
    expect(a).toContain('#aaaa');
    expect(b).toContain('#bbbb');
  });

  it('truncates a project name that busts the cap on its own', () => {
    const result = buildListDisplayName(project({ name: 'P'.repeat(300) }), 'Acme');
    expect(result.length).toBeLessThanOrEqual(100);
  });

  it('truncates a very long project name even with no customer', () => {
    const result = buildListDisplayName(project({ name: 'P'.repeat(300) }), null);
    expect(result.length).toBeLessThanOrEqual(100);
  });

  it('handles a missing project without throwing', () => {
    expect(buildListDisplayName(null, null)).toBe('');
  });
});

describe('resolveUnambiguousList', () => {
  const index = new Map([
    ['website rebuild', ['list-1', 'list-2']],
    ['acme ltd: website rebuild', ['list-3']],
    ['unique project', ['list-4']],
  ]);

  it('adopts a name that matches exactly one remote list', () => {
    expect(resolveUnambiguousList(index, 'Unique Project')).toBe('list-4');
  });

  it('is case and whitespace insensitive', () => {
    expect(resolveUnambiguousList(index, '  UNIQUE project ')).toBe('list-4');
  });

  it('refuses a name matching two lists rather than taking the first', () => {
    // Project names are not unique in this database, so "first match wins"
    // could attach one project's sync to another project's list. That is tasks
    // going to the wrong place, not a cosmetic problem.
    expect(resolveUnambiguousList(index, 'Website Rebuild')).toBeNull();
  });

  it('returns null for an unknown name', () => {
    expect(resolveUnambiguousList(index, 'Nothing here')).toBeNull();
  });

  it('handles a missing index or name', () => {
    expect(resolveUnambiguousList(null, 'x')).toBeNull();
    expect(resolveUnambiguousList(index, '')).toBeNull();
    expect(resolveUnambiguousList(index, '   ')).toBeNull();
  });

  it('finds the composed name when the bare one is ambiguous', () => {
    // The fallback order matters: composed first, bare second. A project with a
    // customer resolves cleanly here even though its bare name does not.
    expect(resolveUnambiguousList(index, 'Acme Ltd: Website Rebuild')).toBe('list-3');
  });
});

describe('attachCustomerNames', () => {
  function makeSupabase(customers, { error = null } = {}) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: () => Promise.resolve({ data: customers, error }),
          }),
        }),
      }),
    };
  }

  it('resolves ids to names', async () => {
    const supabase = makeSupabase([{ id: 'c1', name: 'Acme Ltd' }]);
    const result = await attachCustomerNames({
      supabase,
      userId: 'u1',
      projects: [project({ customer_id: 'c1' })],
    });

    expect(result[0].customer_name).toBe('Acme Ltd');
  });

  it('leaves a customerless project alone without querying', async () => {
    // No customer ids means no query at all, which matters because this runs on
    // every sync.
    const supabase = { from: () => { throw new Error('should not query'); } };
    const result = await attachCustomerNames({
      supabase,
      userId: 'u1',
      projects: [project()],
    });

    expect(result[0].customer_name).toBeUndefined();
  });

  it('degrades to the bare name when the lookup fails', async () => {
    // A Graph sync must not fall over because a list title could not be
    // decorated.
    const supabase = makeSupabase(null, { error: { message: 'boom' } });
    const result = await attachCustomerNames({
      supabase,
      userId: 'u1',
      projects: [project({ customer_id: 'c1' })],
    });

    expect(result[0].customer_name).toBeUndefined();
    expect(buildListDisplayName(result[0], result[0].customer_name)).toBe('Website Rebuild');
  });

  it('sets null for a customer id that no longer resolves', async () => {
    const supabase = makeSupabase([]);
    const result = await attachCustomerNames({
      supabase,
      userId: 'u1',
      projects: [project({ customer_id: 'gone' })],
    });

    expect(result[0].customer_name).toBeNull();
  });

  it('queries once for many projects sharing a customer', async () => {
    let calls = 0;
    const supabase = {
      from: () => {
        calls += 1;
        return {
          select: () => ({
            eq: () => ({ in: () => Promise.resolve({ data: [{ id: 'c1', name: 'Acme' }], error: null }) }),
          }),
        };
      },
    };

    const result = await attachCustomerNames({
      supabase,
      userId: 'u1',
      projects: [
        project({ id: 'p1', customer_id: 'c1' }),
        project({ id: 'p2', customer_id: 'c1' }),
        project({ id: 'p3', customer_id: 'c1' }),
      ],
    });

    expect(calls).toBe(1);
    expect(result.every((p) => p.customer_name === 'Acme')).toBe(true);
  });

  it('handles a non-array input', async () => {
    const supabase = makeSupabase([]);
    expect(await attachCustomerNames({ supabase, userId: 'u1', projects: null })).toEqual([]);
  });
});
