import { describe, it, expect } from 'vitest';
import { normaliseAutomationHealth } from '../automationStatusService';

// Wave 4 — heartbeat status normalisation. These tests exercise the PURE
// normaliser with hand-built plain data (no Supabase, no IO). The five
// automations, in order, are: morning autopilot, evening tidy, weekly tidy,
// morning digest email, Outlook sync.

const NOW_MS = Date.parse('2026-07-11T09:00:00Z');
const HOUR = 60 * 60 * 1000;
const iso = (msAgo) => new Date(NOW_MS - msAgo).toISOString();

const KEYS = ['morning_autopilot', 'evening_tidy', 'weekly_tidy', 'digest', 'outlook_sync'];

function byKey(rows) {
  return Object.fromEntries(rows.map((r) => [r.key, r]));
}

function run(overrides = {}) {
  return normaliseAutomationHealth({
    cronRuns: {},
    lastEmailRun: null,
    connection: null,
    nowMs: NOW_MS,
    settings: { autopilot_level: 'review', digest_enabled: true },
    ...overrides,
  });
}

describe('normaliseAutomationHealth', () => {
  it('returns exactly one row per automation with the expected shape', () => {
    const rows = run();
    expect(rows.map((r) => r.key)).toEqual(KEYS);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        ['description', 'detail', 'key', 'label', 'lastRunAt', 'stale', 'status'].sort()
      );
      expect(typeof row.label).toBe('string');
      expect(typeof row.description).toBe('string');
    }
  });

  it('reports "never" for cron/email automations with no run row', () => {
    const rows = byKey(run());
    expect(rows.morning_autopilot.status).toBe('never');
    expect(rows.evening_tidy.status).toBe('never');
    expect(rows.weekly_tidy.status).toBe('never');
    expect(rows.digest.status).toBe('never');
    for (const key of ['morning_autopilot', 'evening_tidy', 'weekly_tidy', 'digest']) {
      expect(rows[key].lastRunAt).toBeNull();
      expect(rows[key].stale).toBe(false);
    }
  });

  it('maps cron_runs success/partial/failed onto ok/partial/failed', () => {
    const rows = byKey(
      run({
        cronRuns: {
          'morning-autopilot': { status: 'success', created_at: iso(HOUR) },
          demote_today: { status: 'partial', error: 'one task failed', created_at: iso(HOUR) },
          demote_week: { status: 'failed', error: 'boom', created_at: iso(HOUR) },
        },
      })
    );
    expect(rows.morning_autopilot.status).toBe('ok');
    expect(rows.evening_tidy.status).toBe('partial');
    expect(rows.evening_tidy.detail).toBe('one task failed');
    expect(rows.weekly_tidy.status).toBe('failed');
    expect(rows.weekly_tidy.detail).toBe('boom');
  });

  it('treats an unexpected/claimed cron status as partial (incomplete run)', () => {
    const rows = byKey(
      run({ cronRuns: { 'morning-autopilot': { status: 'claimed', created_at: iso(HOUR) } } })
    );
    expect(rows.morning_autopilot.status).toBe('partial');
  });

  it('shows autopilot as off when autopilot_level is off, keeping its last run time', () => {
    const rows = byKey(
      run({
        settings: { autopilot_level: 'off', digest_enabled: true },
        cronRuns: { 'morning-autopilot': { status: 'success', created_at: iso(HOUR) } },
      })
    );
    expect(rows.morning_autopilot.status).toBe('off');
    expect(rows.morning_autopilot.lastRunAt).toBe(iso(HOUR));
    expect(rows.morning_autopilot.stale).toBe(false);
  });

  it('maps digest email sent/failed and honours the digest_enabled=false off switch', () => {
    const sent = byKey(run({ lastEmailRun: { status: 'sent', sent_at: iso(2 * HOUR), created_at: iso(3 * HOUR) } }));
    expect(sent.digest.status).toBe('ok');
    expect(sent.digest.lastRunAt).toBe(iso(2 * HOUR));

    const failed = byKey(run({ lastEmailRun: { status: 'failed', error: 'graph 500', created_at: iso(HOUR) } }));
    expect(failed.digest.status).toBe('failed');
    expect(failed.digest.detail).toBe('graph 500');

    const off = byKey(
      run({
        settings: { autopilot_level: 'review', digest_enabled: false },
        lastEmailRun: { status: 'sent', sent_at: iso(2 * HOUR), created_at: iso(3 * HOUR) },
      })
    );
    expect(off.digest.status).toBe('off');
    expect(off.digest.lastRunAt).toBe(iso(2 * HOUR));
  });

  it('treats a "skipped" (ran, nothing to send) digest run as healthy and not stale', () => {
    // The cron records a 'skipped' row on empty days so lastRunAt tracks the last
    // EXECUTION — a run of quiet days must not read as "hasn't run recently".
    const skipped = byKey(run({ lastEmailRun: { status: 'skipped', created_at: iso(3 * HOUR) } }));
    expect(skipped.digest.status).toBe('ok');
    expect(skipped.digest.detail).toBe('Ran — nothing to send');
    expect(skipped.digest.lastRunAt).toBe(iso(3 * HOUR));
    expect(skipped.digest.stale).toBe(false);
  });

  it('reports Outlook sync as off / failed / ok and never leaks secret fields', () => {
    expect(byKey(run({ connection: null })).outlook_sync.status).toBe('off');

    const disabled = byKey(run({ connection: { sync_enabled: false, last_synced_at: iso(HOUR) } }));
    expect(disabled.outlook_sync.status).toBe('off');

    const errored = byKey(
      run({ connection: { sync_enabled: true, last_synced_at: iso(HOUR), sync_error: 'token expired' } })
    );
    expect(errored.outlook_sync.status).toBe('failed');
    expect(errored.outlook_sync.detail).toBe('token expired');

    const ok = byKey(run({ connection: { sync_enabled: true, last_synced_at: iso(HOUR), sync_error: null } }));
    expect(ok.outlook_sync.status).toBe('ok');
    expect(ok.outlook_sync.lastRunAt).toBe(iso(HOUR));

    // The whole serialised row must not carry any token/secret id, even if a
    // caller mistakenly hands the normaliser a connection that has them.
    const withSecrets = byKey(
      run({
        connection: {
          sync_enabled: true,
          last_synced_at: iso(HOUR),
          sync_error: null,
          refresh_token_secret_id: 'secret-abc',
          access_token_secret_id: 'secret-def',
        },
      })
    );
    const serialised = JSON.stringify(withSecrets.outlook_sync);
    expect(serialised).not.toContain('secret-abc');
    expect(serialised).not.toContain('secret-def');
    expect(serialised).not.toContain('token_secret');
  });

  it('flags a daily automation stale only when its last run is older than 48h', () => {
    const fresh = byKey(run({ cronRuns: { 'morning-autopilot': { status: 'success', created_at: iso(2 * HOUR) } } }));
    expect(fresh.morning_autopilot.stale).toBe(false);

    const stale = byKey(run({ cronRuns: { 'morning-autopilot': { status: 'success', created_at: iso(50 * HOUR) } } }));
    expect(stale.morning_autopilot.status).toBe('ok');
    expect(stale.morning_autopilot.stale).toBe(true);

    // The digest (daily) is stale too when its last send is >48h old.
    const staleDigest = byKey(run({ lastEmailRun: { status: 'sent', sent_at: iso(50 * HOUR) } }));
    expect(staleDigest.digest.stale).toBe(true);
  });

  it('never flags the weekly tidy or Outlook sync as stale even after 48h', () => {
    const rows = byKey(
      run({
        cronRuns: { demote_week: { status: 'success', created_at: iso(200 * HOUR) } },
        connection: { sync_enabled: true, last_synced_at: iso(200 * HOUR), sync_error: null },
      })
    );
    expect(rows.weekly_tidy.status).toBe('ok');
    expect(rows.weekly_tidy.stale).toBe(false);
    expect(rows.outlook_sync.stale).toBe(false);
  });
});
