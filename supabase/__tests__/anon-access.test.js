/**
 * Guards what the public anon key can reach in the live database.
 *
 * The reviewed state lives in supabase/anon-access-allowlist.js. This file reads
 * the live catalogue and fails when the database grants anon anything that file
 * does not allow.
 *
 * HOW TO RUN IT AGAINST THE REAL PROJECT
 *   SUPABASE_DB_URL='postgresql://...' npx vitest run supabase/__tests__/anon-access.test.js
 *
 *   The connection string is the direct Postgres URL from the Supabase dashboard
 *   for project hufxwovthhsjmtifvign, under Project Settings, Database.
 *   DATABASE_URL is accepted as an alias.
 *
 * WITHOUT A CONNECTION STRING IT SKIPS, ON PURPOSE
 *   `npm test` must stay runnable offline and must not need production
 *   credentials, so the live checks are opt-in and say out loud that they
 *   skipped and why. Nothing else in `npm test` touches a database. The rest of
 *   this file is pure and always runs, so the comparison rules themselves are
 *   proven even when the live checks do not run.
 *
 * IT CANNOT CHANGE ANYTHING
 *   Two SELECTs, and the session is forced read-only through PGOPTIONS, so a
 *   mistake here cannot write to the database it is inspecting. psql is used
 *   rather than a driver because this repository has no Postgres client among
 *   its dependencies and adding one to run a read-only audit would be the wrong
 *   trade.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';

import {
  ANON_ALLOWLIST,
  ANON_CATALOGUE_QUERY,
  ANON_OPEN_ITEMS,
  MISSING_SEARCH_PATH_QUERY,
  NEVER_ALLOWLIST,
  TRIGGER_ONLY_FUNCTIONS,
  describeAnonAccessFindings,
  diffAnonAccess,
} from '../anon-access-allowlist.js';

// ---------------------------------------------------------------------------
// Reaching the live database, or explaining why we are not going to.
// ---------------------------------------------------------------------------

const connectionString = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? '';

function psqlAvailable() {
  const probe = spawnSync('psql', ['--version'], { encoding: 'utf8' });
  return probe.status === 0;
}

/**
 * Why the live checks are not running, or `null` when they are. Vitest prints
 * this string next to the skipped test, which is the whole point: a silent skip
 * is indistinguishable from a pass.
 *
 * @returns {string | null}
 */
function liveCheckSkipReason() {
  if (!connectionString) {
    return 'no database connection configured. Set SUPABASE_DB_URL (or DATABASE_URL) to '
      + "the planner-app project's direct Postgres URL to run the live anon-grant check. "
      + 'Skipping is expected offline and in CI.';
  }
  if (!psqlAvailable()) {
    return 'SUPABASE_DB_URL is set but psql is not on PATH, so the live catalogue cannot '
      + 'be read. Install the Postgres client (brew install libpq, or apt-get install '
      + 'postgresql-client).';
  }
  return null;
}

/**
 * Run one read-only query and parse its single JSON column.
 *
 * @param {string} query
 * @returns {unknown[]}
 */
function readJsonColumn(query) {
  const result = spawnSync(
    'psql',
    ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', query, connectionString],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        // Belt and braces: this session cannot write, whatever the query says.
        PGOPTIONS: '-c default_transaction_read_only=on',
      },
    },
  );

  if (result.error) {
    throw new Error(`could not run psql: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`psql exited ${result.status}: ${(result.stderr || '').trim()}`);
  }

  const output = (result.stdout || '').trim();
  if (!output) {
    throw new Error('psql returned no rows, which should be impossible for this query');
  }

  return JSON.parse(output);
}

const skipReason = liveCheckSkipReason();

// ---------------------------------------------------------------------------
// The live checks.
// ---------------------------------------------------------------------------

describe('live database', () => {
  it('grants anon nothing beyond supabase/anon-access-allowlist.js', (ctx) => {
    if (skipReason) {
      ctx.skip(skipReason);
      return;
    }

    const reachable = /** @type {import('../anon-access-allowlist.js').AnonCatalogueEntry[]} */ (
      readJsonColumn(ANON_CATALOGUE_QUERY)
    );

    const { findings, stale } = diffAnonAccess(reachable);

    for (const key of stale) {
      console.warn(
        `[anon-access] allowlist entry no longer reachable by anon: ${key}. `
        + 'The database got tighter; trim the allowlist.',
      );
    }

    expect(findings, describeAnonAccessFindings(findings)).toEqual([]);
  });

  it('pins an explicit search_path on every function this repository owns', (ctx) => {
    if (skipReason) {
      ctx.skip(skipReason);
      return;
    }

    const missing = /** @type {{name: string, security: string}[]} */ (
      readJsonColumn(MISSING_SEARCH_PATH_QUERY)
    );

    if (missing.length > 0) {
      console.warn(
        '[anon-access] functions in public with no explicit search_path:\n'
        + missing.map((f) => `  ${f.security.padEnd(8)} ${f.name}`).join('\n'),
      );
    }

    const message = [
      `${missing.length} function(s) in schema public have no explicit search_path.`,
      '',
      ...missing.map((f) => `  ${f.security.padEnd(8)} ${f.name}`),
      '',
      'Without one, unqualified names resolve against whatever the caller\'s path happens',
      'to be, which matters most for SECURITY DEFINER. Every function this repository',
      'owns carried search_path=public, pg_catalog when this baseline was taken on',
      '4 September 2026, so a failure here is new drift. Fix it in a migration with',
      'ALTER FUNCTION ... SET search_path = ..., not by editing this test. Extension-owned',
      'functions are already excluded, so pg_trgm is not what this is reporting.',
    ].join('\n');

    expect(missing, message).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rules about the allowlist itself. These need no database and always run.
// ---------------------------------------------------------------------------

describe('the allowlist itself', () => {
  it('never contains a Vault, lifecycle or arbitrary-SQL function', () => {
    const banned = new Set(NEVER_ALLOWLIST);

    const offenders = ANON_ALLOWLIST
      .filter((entry) => entry.kind === 'function' && banned.has(entry.name.split('(')[0]))
      .map((entry) => entry.name);

    expect(
      offenders,
      'These reach the Vault, run arbitrary SQL, delete user content or are the ownership '
      + `gate itself, and must never be allowlisted for anon: ${offenders.join(', ')}. If the `
      + 'live database grants one of them, write a migration that revokes it from PUBLIC and '
      + 'anon. Do not add it here.',
    ).toEqual([]);
  });

  it('allowlists no function that can actually be called', () => {
    const triggerOnly = new Set(TRIGGER_ONLY_FUNCTIONS);

    const callable = ANON_ALLOWLIST
      .filter((entry) => entry.kind === 'function')
      .map((entry) => entry.name)
      .filter((name) => !triggerOnly.has(name) && !/^(gin_|gtrgm_|set_limit|show_limit|show_trgm|similarity|strict_word_similarity|word_similarity)/.test(name));

    expect(
      callable,
      'Every allowlisted function must either return `trigger`, and so be impossible to '
      + 'invoke directly, or belong to the pg_trgm extension. These do neither: '
      + `${callable.join(', ')}. A callable RPC reachable by anon is drift, not a `
      + 'configuration choice. Revoke it in a migration.',
    ).toEqual([]);
  });

  it('gives every entry a reason and at least one privilege', () => {
    for (const entry of ANON_ALLOWLIST) {
      expect(entry.why.trim().length, `${entry.kind} ${entry.name} has no reason recorded`)
        .toBeGreaterThan(0);
      expect(
        entry.privileges.length,
        `${entry.kind} ${entry.name} is allowlisted with no privileges, so it should be removed`,
      ).toBeGreaterThan(0);
    }
  });

  it('lists no object twice', () => {
    const keys = ANON_ALLOWLIST.map((entry) => `${entry.kind} ${entry.name}`);
    const duplicates = keys.filter((key, i) => keys.indexOf(key) !== i);

    expect(duplicates, `duplicated allowlist entries: ${duplicates.join(', ')}`).toEqual([]);
  });

  it('never also lists an open item, because that would bless it', () => {
    const allowed = new Set(ANON_ALLOWLIST.map((entry) => `${entry.kind} ${entry.name}`));

    for (const item of ANON_OPEN_ITEMS) {
      expect(
        allowed.has(`${item.kind} ${item.name}`),
        `${item.kind} ${item.name} is recorded as an unresolved open item and must not `
        + 'appear in ANON_ALLOWLIST',
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// The catalogue query itself. This one guards a bug that is invisible without a
// database, which is exactly the kind that gets reintroduced.
// ---------------------------------------------------------------------------

describe('the catalogue query', () => {
  it('casts every name column to text, so long function signatures survive', () => {
    const nameSelects = ANON_CATALOGUE_QUERY
      .split('\n')
      .filter((line) => /\bas name\b/.test(line));

    expect(nameSelects, 'expected a name column in each of the rel, seq and fn branches')
      .toHaveLength(3);

    const message =
      'A name column in the catalogue query is not cast to text. pg_class.relname is of '
      + 'type `name`, which is 63 bytes. Union that with the text the function branch '
      + 'produces and Postgres resolves the whole column to `name`, silently truncating '
      + 'every function signature at 63 characters. Two overloads differing only after '
      + 'character 63 then collapse to the same key and one hides behind the other, which '
      + 'is the exact failure this query exists to prevent. Put the ::text casts back.';

    for (const line of nameSelects) {
      expect(line, message).toMatch(/::text/);
    }
  });

  it('keys functions by their identity arguments, not by bare name', () => {
    expect(ANON_CATALOGUE_QUERY).toContain('pg_get_function_identity_arguments');
  });

  it('reads privileges through has_*_privilege rather than raw ACL arrays', () => {
    expect(ANON_CATALOGUE_QUERY).toContain('has_table_privilege');
    expect(ANON_CATALOGUE_QUERY).toContain('has_sequence_privilege');
    expect(ANON_CATALOGUE_QUERY).toContain('has_function_privilege');
    expect(
      ANON_CATALOGUE_QUERY,
      'reading relacl directly misses everything anon inherits through PUBLIC',
    ).not.toContain('relacl');
  });
});

// ---------------------------------------------------------------------------
// The comparison rules, proven with fixtures so they hold even when the live
// checks skip. Without these, an offline run proves nothing at all.
// ---------------------------------------------------------------------------

describe('diffAnonAccess', () => {
  const fixtureAllowlist = [
    { kind: 'table', name: 'tasks', privileges: ['SELECT'], why: 'fixture' },
  ];

  it('passes when the live state matches the allowlist', () => {
    const { findings, stale } = diffAnonAccess(
      [{ kind: 'table', name: 'tasks', privileges: ['SELECT'] }],
      fixtureAllowlist,
      [],
    );

    expect(findings).toEqual([]);
    expect(stale).toEqual([]);
  });

  it('fails and names the object when anon reaches something unlisted', () => {
    const { findings } = diffAnonAccess(
      [{ kind: 'table', name: 'salaries', privileges: ['SELECT', 'DELETE'] }],
      fixtureAllowlist,
      [],
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].name).toBe('salaries');
    expect(findings[0].problem).toBe('unlisted');
    expect(findings[0].extraPrivileges).toEqual(['DELETE', 'SELECT']);

    const message = describeAnonAccessFindings(findings);
    expect(message).toContain('salaries');
    expect(message).toContain('NOT ALLOWLISTED');
  });

  it('fails when a listed object gains a privilege it was not allowed', () => {
    const { findings } = diffAnonAccess(
      [{ kind: 'table', name: 'tasks', privileges: ['SELECT', 'DELETE'] }],
      fixtureAllowlist,
      [],
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].problem).toBe('widened');
    expect(findings[0].extraPrivileges).toEqual(['DELETE']);
    expect(describeAnonAccessFindings(findings)).toContain('WIDENED');
  });

  it('does not let a function overload hide behind a sibling', () => {
    const { findings } = diffAnonAccess(
      [
        { kind: 'function', name: 'f(a uuid)', privileges: ['EXECUTE'] },
        { kind: 'function', name: 'f(a uuid, b uuid)', privileges: ['EXECUTE'] },
      ],
      [{ kind: 'function', name: 'f(a uuid)', privileges: ['EXECUTE'], why: 'fixture' }],
      [],
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].name).toBe('f(a uuid, b uuid)');
  });

  it('still fails on a known open item, but says it is known', () => {
    const { findings } = diffAnonAccess(
      [{ kind: 'function', name: 'stray(x jsonb)', privileges: ['EXECUTE'] }],
      [],
      [{ kind: 'function', name: 'stray(x jsonb)', why: 'reviewed, revoke pending an owner decision' }],
    );

    expect(findings, 'an open item must still fail the test, not be excused by it').toHaveLength(1);
    expect(findings[0].knownOpenItem).toBe('reviewed, revoke pending an owner decision');
    expect(describeAnonAccessFindings(findings)).toContain('reviewed, revoke pending an owner decision');
  });

  it('reports, without failing, an entry the database no longer grants', () => {
    const { findings, stale } = diffAnonAccess([], fixtureAllowlist, []);

    expect(findings, 'a tighter database is not a failure').toEqual([]);
    expect(stale).toEqual(['table tasks']);
  });
});
