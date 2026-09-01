import { describe, it, expect, vi } from 'vitest';
import {
  findProbableDuplicates,
  setPrimaryContact,
  updateContact,
  validateContact,
} from '../contactService';
import { validateFact } from '../customerService';

function makeSupabase(rows = [], { captured = {} } = {}) {
  function chain() {
    let payload = null;
    const api = {
      select: () => api,
      update(values) { payload = values; captured.updated = values; return api; },
      eq: () => api,
      is: () => api,
      order: () => api,
      single: async () => ({ data: { ...rows[0], ...payload }, error: null }),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then(resolve, reject) {
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return api;
  }
  return { from: () => chain(), captured };
}

describe('validateContact', () => {
  it('requires a name', () => {
    expect(validateContact({ name: '  ' }).errors.name).toBeTruthy();
  });

  it('accepts a contact with nothing but a name', () => {
    // Most people you record are a name and nothing else at first.
    expect(validateContact({ name: 'Kim' }).isValid).toBe(true);
  });

  it('rejects a malformed email', () => {
    expect(validateContact({ name: 'Kim', email: 'not-an-email' }).errors.email).toBeTruthy();
    expect(validateContact({ name: 'Kim', email: 'kim@acme.co.uk' }).isValid).toBe(true);
  });

  it('enforces the same limits as the database check constraints', () => {
    expect(validateContact({ name: 'x'.repeat(121) }).errors.name).toBeTruthy();
    expect(validateContact({ name: 'Kim', role: 'x'.repeat(121) }).errors.role).toBeTruthy();
    expect(validateContact({ name: 'Kim', notes: 'x'.repeat(2001) }).errors.notes).toBeTruthy();
  });

  it('does not demand a name on a partial update', () => {
    expect(validateContact({ role: 'Finance' }, true).isValid).toBe(true);
  });
});

describe('findProbableDuplicates', () => {
  const existing = [
    { id: 'c1', name: 'Kim Smith', email: 'kim@acme.test', phone: '07700 900123' },
    { id: 'c2', name: 'Kim Smith', email: 'other@acme.test', phone: '07700 900999' },
  ];

  it('flags a match on name plus email', () => {
    const found = findProbableDuplicates({ name: 'Kim Smith', email: 'kim@acme.test' }, existing);
    expect(found.map((c) => c.id)).toEqual(['c1']);
  });

  it('flags a match on name plus phone, ignoring formatting', () => {
    const found = findProbableDuplicates({ name: 'Kim Smith', phone: '+447700900999' }, existing);
    expect(found).toHaveLength(0);

    const exact = findProbableDuplicates({ name: 'Kim Smith', phone: '07700900999' }, existing);
    expect(exact.map((c) => c.id)).toEqual(['c2']);
  });

  it('does NOT flag a shared name alone', () => {
    // Two people at one company really can share a name. Refusing to store the
    // second would be worse than showing both, so name alone is not enough.
    expect(findProbableDuplicates({ name: 'Kim Smith' }, existing)).toHaveLength(0);
  });

  it('does not flag the contact against itself', () => {
    const found = findProbableDuplicates(
      { id: 'c1', name: 'Kim Smith', email: 'kim@acme.test' },
      existing
    );
    expect(found).toHaveLength(0);
  });

  it('is case insensitive on both name and email', () => {
    const found = findProbableDuplicates({ name: 'KIM SMITH', email: 'KIM@ACME.TEST' }, existing);
    expect(found.map((c) => c.id)).toEqual(['c1']);
  });

  it('returns nothing for a blank name', () => {
    expect(findProbableDuplicates({ name: '   ' }, existing)).toHaveLength(0);
  });
});

describe('updateContact', () => {
  it('clears the primary flag when archiving', async () => {
    // The partial unique index excludes archived rows, so leaving the flag set
    // would make a customer look like it has a primary contact that is not
    // shown anywhere.
    const captured = {};
    const supabase = makeSupabase([{ id: 'c1', user_id: 'u1', name: 'Kim', is_primary: true }], { captured });

    await updateContact({
      supabase,
      userId: 'u1',
      contactId: 'c1',
      payload: { archived: true },
    });

    expect(captured.updated.is_primary).toBe(false);
    expect(captured.updated.archived_at).toBeTruthy();
  });

  it('refuses another user', async () => {
    const supabase = makeSupabase([{ id: 'c1', user_id: 'someone-else', name: 'Kim' }]);
    const { error } = await updateContact({
      supabase,
      userId: 'u1',
      contactId: 'c1',
      payload: { name: 'Hijacked' },
    });

    expect(error.status).toBe(403);
  });
});

describe('setPrimaryContact', () => {
  it('goes through the RPC, because it is a swap not an update', async () => {
    // Setting the new primary before clearing the old leaves two for an
    // instant, and the partial unique index refuses that. Two client PATCH
    // calls cannot avoid it; one transaction can.
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: { contactId: 'c2' }, error: null }) };

    await setPrimaryContact({
      supabase,
      userId: 'u1',
      customerId: 'cust-1',
      contactId: 'c2',
    });

    expect(supabase.rpc).toHaveBeenCalledWith('set_primary_contact', {
      p_customer_id: 'cust-1',
      p_contact_id: 'c2',
      p_user_id: 'u1',
    });
  });

  it('maps a rejected archived contact to a 400', async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: '23514', message: 'an archived contact cannot be primary' },
      }),
    };

    const { error } = await setPrimaryContact({
      supabase,
      userId: 'u1',
      customerId: 'cust-1',
      contactId: 'c2',
    });

    expect(error.status).toBe(400);
  });
});

describe('validateFact', () => {
  it('requires both a label and a value', () => {
    // A fact that is a label with nothing behind it is not a fact.
    expect(validateFact({ label: 'VAT', value: '   ' }).errors.value).toBeTruthy();
    expect(validateFact({ label: '  ', value: 'GB123' }).errors.label).toBeTruthy();
    expect(validateFact({ label: 'VAT', value: 'GB123' }).isValid).toBe(true);
  });

  it('enforces the same limits as the database check constraints', () => {
    expect(validateFact({ label: 'x'.repeat(81), value: 'v' }).errors.label).toBeTruthy();
    expect(validateFact({ label: 'l', value: 'x'.repeat(2001) }).errors.value).toBeTruthy();
  });
});
