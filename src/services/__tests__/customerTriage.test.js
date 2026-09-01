import { describe, it, expect } from 'vitest';
import { profileStakeholders } from '../customerService';

/**
 * The stakeholders column is free text typed into a comma separated box over a
 * long period, so the profile has to describe what is actually in it rather than
 * what it was supposed to contain. These tests pin the messy cases: duplicates
 * across projects, commas inside a single array element, blanks, and entries
 * that are really email addresses.
 */

const project = (id, name, stakeholders) => ({ id, name, stakeholders });

describe('profileStakeholders', () => {
  it('deduplicates a name used on several projects', () => {
    const profile = profileStakeholders([
      project('p1', 'One', ['Acme Ltd']),
      project('p2', 'Two', ['Acme Ltd']),
      project('p3', 'Three', ['Acme Ltd']),
    ]);

    expect(profile.distinctNames).toBe(1);
    expect(profile.names[0].projects).toHaveLength(3);
  });

  it('deduplicates case-insensitively, keeping the first spelling seen', () => {
    const profile = profileStakeholders([
      project('p1', 'One', ['Acme Ltd']),
      project('p2', 'Two', ['ACME LTD']),
      project('p3', 'Three', ['  acme   ltd  ']),
    ]);

    expect(profile.distinctNames).toBe(1);
    expect(profile.names[0].name).toBe('Acme Ltd');
    expect(profile.names[0].projects).toHaveLength(3);
  });

  it('splits an array element that still contains commas', () => {
    // The UI wrote comma separated text into the array, so some single elements
    // hold several names.
    const profile = profileStakeholders([project('p1', 'One', ['Acme Ltd, Beta Group'])]);

    expect(profile.distinctNames).toBe(2);
    expect(profile.entriesWithCommas).toBe(1);
    expect(profile.names.map((n) => n.name).sort()).toEqual(['Acme Ltd', 'Beta Group']);
  });

  it('counts and drops blank entries rather than creating an empty customer', () => {
    const profile = profileStakeholders([project('p1', 'One', ['Acme', '', '   '])]);

    expect(profile.blankEntries).toBe(2);
    expect(profile.distinctNames).toBe(1);
  });

  it('flags entries that look like a person rather than a company', () => {
    const profile = profileStakeholders([project('p1', 'One', ['joe@acme.com', 'Acme Ltd'])]);

    const email = profile.names.find((n) => n.name === 'joe@acme.com');
    expect(email.looksLikeEmail).toBe(true);
    expect(profile.emailLike).toBe(1);
  });

  it('orders by usage, so the likely customers are decided first', () => {
    const profile = profileStakeholders([
      project('p1', 'One', ['Rare']),
      project('p2', 'Two', ['Common']),
      project('p3', 'Three', ['Common']),
      project('p4', 'Four', ['Common']),
    ]);

    expect(profile.names[0].name).toBe('Common');
    expect(profile.names[1].name).toBe('Rare');
  });

  it('breaks a usage tie alphabetically, so the order is stable between loads', () => {
    const profile = profileStakeholders([project('p1', 'One', ['Zed', 'Alpha'])]);
    expect(profile.names.map((n) => n.name)).toEqual(['Alpha', 'Zed']);
  });

  it('does not list the same project twice for one name', () => {
    const profile = profileStakeholders([project('p1', 'One', ['Acme', 'acme'])]);
    expect(profile.names[0].projects).toHaveLength(1);
  });

  it('counts projects that actually carry stakeholders', () => {
    const profile = profileStakeholders([
      project('p1', 'One', ['Acme']),
      project('p2', 'Two', []),
      project('p3', 'Three', null),
    ]);

    expect(profile.projectsWithStakeholders).toBe(1);
    expect(profile.rawEntries).toBe(1);
  });

  it('handles an empty or missing project list', () => {
    expect(profileStakeholders([]).distinctNames).toBe(0);
    expect(profileStakeholders(null).distinctNames).toBe(0);
  });
});
