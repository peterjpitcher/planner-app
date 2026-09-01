import { describe, it, expect } from 'vitest';
import { escapeLikePattern, normalisePhone, search } from '../searchService';

function makeSupabase(results = {}) {
  const captured = { filters: {} };

  const table = (name) => {
    const api = {
      select: () => api,
      eq: () => api,
      or(expr) { captured.filters[name] = expr; return api; },
      ilike(column, pattern) { captured.filters[name] = `${column}.ilike.${pattern}`; return api; },
      order: () => api,
      limit: async () => ({ data: results[name] ?? [], error: results[`${name}Error`] ?? null }),
    };
    return api;
  };

  return { from: table, captured };
}

describe('normalisePhone', () => {
  it('reduces every format to its digits', () => {
    // 07700 900123 and +44 7700 900123 are the same number typed two ways.
    expect(normalisePhone('07700 900123')).toBe('07700900123');
    expect(normalisePhone('+44 (0)7700 900-123')).toBe('4407700900123');
  });

  it('handles empty input', () => {
    expect(normalisePhone(null)).toBe('');
    expect(normalisePhone('')).toBe('');
  });
});

describe('escapeLikePattern', () => {
  it('strips ilike wildcards, so a literal search stays literal', () => {
    // Without this, searching "50%" matches far more than it should.
    expect(escapeLikePattern('50%')).toBe('50');
    expect(escapeLikePattern('a_b')).toBe('ab');
  });

  it('strips characters that would break out of the or() filter syntax', () => {
    // A comma or bracket in the term would otherwise be read as filter
    // structure rather than as text to match.
    expect(escapeLikePattern('Acme, Ltd')).toBe('Acme Ltd');
    expect(escapeLikePattern('Acme (UK)')).toBe('Acme UK');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeLikePattern('Acme Ltd')).toBe('Acme Ltd');
    expect(escapeLikePattern('joe@acme.test')).toBe('joe@acme.test');
  });
});

describe('search', () => {
  it('returns empty for a term too short to be useful', async () => {
    // One character would match nearly everything and cost a full scan.
    const supabase = makeSupabase();
    const { data } = await search({ supabase, userId: 'u1', query: 'a' });

    expect(data).toEqual({ customers: [], notes: [], contacts: [], facts: [] });
    expect(supabase.captured.filters).toEqual({});
  });

  it('returns empty for a blank term', async () => {
    const supabase = makeSupabase();
    const { data } = await search({ supabase, userId: 'u1', query: '   ' });
    expect(data.customers).toEqual([]);
  });

  it('searches all four record types', async () => {
    const supabase = makeSupabase({
      customers: [{ id: 'c1', name: 'Acme' }],
      notes: [{ id: 'n1', content: 'Acme called' }],
      contacts: [{ id: 'ct1', name: 'Kim' }],
      customer_facts: [{ id: 'f1', label: 'VAT', value: 'Acme GB123' }],
    });

    const { data } = await search({ supabase, userId: 'u1', query: 'Acme' });

    expect(data.customers).toHaveLength(1);
    expect(data.notes).toHaveLength(1);
    expect(data.contacts).toHaveLength(1);
    expect(data.facts).toHaveLength(1);
  });

  it('searches a customer by name and by summary', async () => {
    const supabase = makeSupabase();
    await search({ supabase, userId: 'u1', query: 'Acme' });

    expect(supabase.captured.filters.customers).toContain('name.ilike');
    expect(supabase.captured.filters.customers).toContain('summary.ilike');
  });

  it('searches contacts by phone only when the term has enough digits', async () => {
    // A phone filter on "Kim" would be noise, and on "44" would match half the
    // numbers you own.
    const supabase = makeSupabase();
    await search({ supabase, userId: 'u1', query: 'Kim' });
    expect(supabase.captured.filters.contacts).not.toContain('phone.ilike');

    const withDigits = makeSupabase();
    await search({ supabase: withDigits, userId: 'u1', query: '07700 900123' });
    expect(withDigits.captured.filters.contacts).toContain('phone.ilike');
  });

  it('matches a phone regardless of how it was typed', async () => {
    const supabase = makeSupabase();
    await search({ supabase, userId: 'u1', query: '+44 (0)7700 900-123' });
    expect(supabase.captured.filters.contacts).toContain('4407700900123');
  });

  it('surfaces a failure rather than returning a partial result set', async () => {
    // Half a search silently presented as a whole one is worse than an error.
    const supabase = makeSupabase({ notesError: { message: 'boom' } });
    const { data, error } = await search({ supabase, userId: 'u1', query: 'Acme' });

    expect(data).toBeNull();
    expect(error.status).toBe(500);
  });

  it('escapes the term before it reaches the filter', async () => {
    const supabase = makeSupabase();
    await search({ supabase, userId: 'u1', query: 'Acme, Ltd' });
    expect(supabase.captured.filters.customers).not.toContain('Acme,');
  });
});
