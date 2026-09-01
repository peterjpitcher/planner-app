import { describe, it, expect } from 'vitest';
import { findNearMiss, parseQuickTask } from '../quickTaskParser';

// Tuesday 18 August 2026.
const BASE = '2026-08-18';

const CUSTOMERS = [
  { id: 'c-acme', name: 'Acme', archived_at: null },
  { id: 'c-acme-ltd', name: 'Acme Ltd', archived_at: null },
  { id: 'c-beta', name: 'Beta Group', archived_at: null },
  { id: 'c-old', name: 'Old Client', archived_at: '2026-01-01' },
];

function parse(input, options = {}) {
  return parseQuickTask(input, { baseDateKey: BASE, customers: CUSTOMERS, ...options });
}

describe('parseQuickTask, the @ form', () => {
  it('resolves an existing customer and strips the token', () => {
    const result = parse('Send the proposal @Acme');

    expect(result.name).toBe('Send the proposal');
    expect(result.customerId).toBe('c-acme');
    expect(result.createsCustomer).toBe(false);
  });

  it('creates a customer that does not exist, because @ is a deliberate act', () => {
    const result = parse('Kick-off call @Northgate');

    expect(result.name).toBe('Kick-off call');
    expect(result.customerId).toBeNull();
    expect(result.customerName).toBe('Northgate');
    expect(result.createsCustomer).toBe(true);
  });

  it('prefers the longest existing name, so @Acme Ltd is not split', () => {
    // Without longest-match this would resolve "Acme" and leave "Ltd" stranded
    // in the task name.
    const result = parse('Send the pack @Acme Ltd');

    expect(result.customerId).toBe('c-acme-ltd');
    expect(result.name).toBe('Send the pack');
  });

  it('falls back to one word when the longer name does not exist', () => {
    const result = parse('Scope it @Northgate Group');

    expect(result.customerName).toBe('Northgate');
    expect(result.createsCustomer).toBe(true);
    expect(result.name).toBe('Scope it Group');
  });

  it('takes a quoted name literally, for a multi-word new customer', () => {
    const result = parse('Scope the work @"Northgate Group"');

    expect(result.customerName).toBe('Northgate Group');
    expect(result.createsCustomer).toBe(true);
    expect(result.name).toBe('Scope the work');
  });

  it('matches an existing customer through the quoted form too', () => {
    const result = parse('Chase it @"Beta Group"');
    expect(result.customerId).toBe('c-beta');
    expect(result.createsCustomer).toBe(false);
  });

  it('strips trailing punctuation from an unquoted name', () => {
    const result = parse('Check @Acme, then send it');
    expect(result.customerId).toBe('c-acme');
    expect(result.name).toBe('Check , then send it');
  });

  it('works with a date phrase as well', () => {
    const result = parse('Send the proposal @Acme tomorrow');

    expect(result.name).toBe('Send the proposal');
    expect(result.dueDate).toBe('2026-08-19');
    expect(result.customerId).toBe('c-acme');
  });

  it('warns that an archived customer will be restored', () => {
    const result = parse('Chase it @"Old Client"');
    expect(result.customerId).toBe('c-old');
    expect(result.warning).toContain('archived');
  });
});

describe('parseQuickTask, things that must not become customers', () => {
  it('ignores an @ inside an email address', () => {
    // The single most important rule here. Without the whitespace anchor this
    // creates a customer called "acme.com" the first time you type an email.
    const result = parse('Email joe@acme.com about the quote');

    expect(result.customerId).toBeNull();
    expect(result.createsCustomer).toBe(false);
    expect(result.name).toBe('Email joe@acme.com about the quote');
  });

  it('rejects two tokens rather than picking one', () => {
    const result = parse('Talk to @Acme @Beta');

    expect(result.error).toBeTruthy();
    expect(result.customerId).toBeNull();
    expect(result.createsCustomer).toBe(false);
  });

  it('reports an unclosed quote instead of guessing', () => {
    const result = parse('Scope it @"Northgate Group');
    expect(result.error).toBeTruthy();
  });

  it('warns about a bare @ rather than silently dropping it', () => {
    const result = parse('Send it @ the end of the week');
    expect(result.warning).toBeTruthy();
    expect(result.createsCustomer).toBe(false);
  });
});

describe('parseQuickTask, the "for" form', () => {
  it('matches an existing customer', () => {
    const result = parse('do this for Acme on 12 September');

    expect(result.customerId).toBe('c-acme');
    expect(result.name).toBe('do this');
    expect(result.dueDate).toBe('2026-09-12');
  });

  it('never creates, so ordinary prose is left alone', () => {
    // This is the whole reason the two forms differ. "for" is far too common a
    // word to trust with creation.
    const result = parse('Buy flowers for the wedding tomorrow');

    expect(result.customerId).toBeNull();
    expect(result.createsCustomer).toBe(false);
    expect(result.name).toBe('Buy flowers for the wedding');
    expect(result.dueDate).toBe('2026-08-19');
  });

  it('leaves an unmatched name in the task text', () => {
    const result = parse('Sort this for the accountant');

    expect(result.customerId).toBeNull();
    expect(result.name).toBe('Sort this for the accountant');
  });

  it('prefers the longest matching customer name', () => {
    const result = parse('Send the pack for Acme Ltd');
    expect(result.customerId).toBe('c-acme-ltd');
    expect(result.name).toBe('Send the pack');
  });
});

describe('parseQuickTask, dates still behave as before', () => {
  it('leaves a day name that is part of the task alone', () => {
    const result = parse('Discuss Friday trading');
    expect(result.name).toBe('Discuss Friday trading');
    expect(result.dueDate).toBe(BASE);
  });

  it('defaults to the base date with no phrase', () => {
    expect(parse('Call the supplier').dueDate).toBe(BASE);
  });

  it('handles an empty line without throwing', () => {
    const result = parse('   ');
    expect(result.name).toBe('');
    expect(result.error).toBeNull();
  });
});

describe('parseQuickTask on a project input', () => {
  it('refuses a token that would create, before anything is written', () => {
    // fn_task_customer_sync overwrites customer_id from the project, so
    // accepting this would create a customer and then throw the link away.
    const result = parse('Kick-off @Northgate', { allowCreate: false });

    expect(result.error).toBeTruthy();
    expect(result.createsCustomer).toBe(false);
    expect(result.customerName).toBeNull();
  });

  it('refuses a token naming an existing customer too', () => {
    const result = parse('Chase it @Acme', { allowCreate: false });
    expect(result.error).toBeTruthy();
  });

  it('refuses the prose form as well', () => {
    const result = parse('do this for Acme', { allowCreate: false });
    expect(result.error).toBeTruthy();
  });

  it('leaves an ordinary task alone', () => {
    const result = parse('Send the proposal tomorrow', { allowCreate: false });

    expect(result.error).toBeNull();
    expect(result.name).toBe('Send the proposal');
    expect(result.dueDate).toBe('2026-08-19');
  });
});

describe('findNearMiss', () => {
  it('spots a one-character typo', () => {
    expect(findNearMiss('Acmee', CUSTOMERS)?.name).toBe('Acme');
  });

  it('spots a transposition', () => {
    expect(findNearMiss('Bteagroup', [{ id: 'x', name: 'Betagroup' }])?.name).toBe('Betagroup');
  });

  it('returns nothing for an exact match, which is not a typo', () => {
    expect(findNearMiss('Acme', CUSTOMERS)).toBeNull();
  });

  it('returns nothing for a genuinely different name', () => {
    expect(findNearMiss('Northgate', CUSTOMERS)).toBeNull();
  });

  it('does not guess at very short names', () => {
    expect(findNearMiss('AB', CUSTOMERS)).toBeNull();
  });
});
