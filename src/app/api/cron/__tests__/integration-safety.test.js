// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  client: vi.fn(), reconcile: vi.fn(), sync: vi.fn(), clear: vi.fn(), failure: vi.fn(), revalidate: vi.fn(),
}));
vi.mock('@/lib/supabaseServiceRole', () => ({ getSupabaseServiceRole: deps.client }));
vi.mock('@/services/attachmentService', () => ({ reconcileAttachments: deps.reconcile }));
vi.mock('@/services/office365SyncService', () => ({ syncOffice365All: deps.sync }));
vi.mock('@/services/office365ConnectionService', () => ({
  clearOffice365SyncFailure: deps.clear,
  recordOffice365SyncFailure: deps.failure,
}));
vi.mock('next/cache', () => ({ revalidatePath: deps.revalidate }));

import { GET as reconcile } from '../reconcile-attachments/route';
import { GET as sync } from '../office365-sync/route';

function makeTrackingDatabase({ alreadyRun = false, trackingError = null } = {}) {
  const updates = [];
  const writes = [];
  let row = null;
  return {
    updates, writes,
    from(table) {
      let operation = 'select';
      let values;
      const predicates = [];
      const execute = () => {
        if (operation === 'insert') {
          if (alreadyRun && !row) row = { id: 'run', ...values, status: 'success' };
          if (row) return { data: null, error: { code: '23505' } };
          row = { id: 'run', ...values };
          return { data: { ...row }, error: null };
        }
        if (operation === 'update' && trackingError) return { data: null, error: trackingError };
        if (!row || !predicates.every((predicate) => predicate(row))) return { data: null, error: null };
        if (operation === 'update') Object.assign(row, values);
        return { data: { ...row }, error: null };
      };
      const query = {
        select() { return query; },
        eq(key, value) { predicates.push((candidate) => candidate[key] === value); return query; },
        insert(payload) { operation = 'insert'; values = payload; writes.push({ table, operation, payload }); return query; },
        update(payload) { operation = 'update'; values = payload; writes.push({ table, operation, payload }); updates.push(payload); return query; },
        single() { return Promise.resolve(execute()); },
        maybeSingle() { return Promise.resolve(execute()); },
        then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
      };
      return query;
    },
  };
}

const request = (query = '') => new Request(`https://fixture.test/api/cron/job?token=fixture-manual${query}`);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('CRON_SECRET', 'fixture-secret');
  vi.stubEnv('CRON_MANUAL_TOKEN', 'fixture-manual');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  deps.reconcile.mockResolvedValue({ data: { stalePendingRemoved: 2, stuckDeletesCompleted: 1, failures: 0 } });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe.each([['attachments', reconcile], ['Outlook', sync]])('%s cron side effects', (_label, handler) => {
  it('does no work on an authorised dry run, even with force enabled', async () => {
    const response = await handler(request('&dryRun=true&force=true'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ dryRun: true });
    // Client construction, OAuth sync, run claims, health writes and cache
    // invalidation all sit beyond the dry-run boundary.
    Object.values(deps).forEach((dependency) => expect(dependency).not.toHaveBeenCalled());
  });

  it('rejects unauthorised callers before doing any work', async () => {
    const response = await handler(new Request('https://fixture.test/api/cron/job?dryRun=true'));
    expect(response.status).toBe(401);
    Object.values(deps).forEach((dependency) => expect(dependency).not.toHaveBeenCalled());
  });
});

describe('attachment cron claims and tracking', () => {
  it('does not reconcile when another run already owns the date', async () => {
    const db = makeTrackingDatabase({ alreadyRun: true });
    deps.client.mockReturnValue(db);
    const response = await reconcile(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ skipped: true, reason: 'already_run' });
    expect(deps.reconcile).not.toHaveBeenCalled();
    expect(db.updates).toEqual([]);
  });

  it('records successful counts using the existing live tracking columns', async () => {
    const db = makeTrackingDatabase();
    deps.client.mockReturnValue(db);
    const response = await reconcile(request());
    expect(response.status).toBe(200);
    expect(db.updates).toEqual([{ status: 'success', tasks_affected: 3, error: null }]);
    expect(deps.reconcile).toHaveBeenCalledOnce();
  });

  it('reports partial cleanup as an unsuccessful HTTP run with retained failure counts', async () => {
    const db = makeTrackingDatabase();
    deps.client.mockReturnValue(db);
    deps.reconcile.mockResolvedValueOnce({ data: { stalePendingRemoved: 1, stuckDeletesCompleted: 0, failures: 2 } });
    const response = await reconcile(request());
    expect(response.status).toBe(500);
    expect(db.updates).toEqual([{ status: 'failed', tasks_affected: 1, error: '2 attachment cleanup operation(s) failed' }]);
  });

  it('reclaims a failed cleanup and finishes the retained files on the same date', async () => {
    const db = makeTrackingDatabase();
    const trackingFrom = db.from.bind(db);
    let rows = [{ id: 'file', status: 'pending', storage_path: 'fixture/file', upload_expires_at: '2020-01-01T00:00:00Z' }];
    let storageUnavailable = true;
    db.storage = { from: () => ({ remove: async () => ({ error: storageUnavailable ? { message: 'Storage unavailable' } : null }) }) };
    db.from = (table) => {
      if (table !== 'attachments') return trackingFrom(table);
      const predicates = [];
      let deleting = false;
      const query = {
        select() { return query; }, limit() { return query; },
        eq(key, value) { predicates.push((candidate) => candidate[key] === value); return query; },
        lt(key, value) { predicates.push((candidate) => candidate[key] < value); return query; },
        delete() { deleting = true; return query; },
        then(resolve, reject) {
          const selected = rows.filter((candidate) => predicates.every((predicate) => predicate(candidate)));
          if (deleting) rows = rows.filter((candidate) => !selected.includes(candidate));
          return Promise.resolve({ data: selected, error: null }).then(resolve, reject);
        },
      };
      return query;
    };
    const actual = await vi.importActual('@/services/attachmentService');
    deps.reconcile.mockImplementation(actual.reconcileAttachments);
    deps.client.mockReturnValue(db);

    const failed = await reconcile(request());
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ data: { stalePendingRemoved: 0, stuckDeletesCompleted: 0, failures: 1 } });
    expect(rows).toHaveLength(1);
    expect(db.updates[0]).toMatchObject({ status: 'failed', tasks_affected: 0 });

    storageUnavailable = false;
    const recovered = await reconcile(request());
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({ data: { stalePendingRemoved: 1, stuckDeletesCompleted: 0, failures: 0 } });
    expect(rows).toEqual([]);
    expect(db.updates[1]).toEqual({ status: 'claimed', error: null });
    expect(db.updates[2]).toEqual({ status: 'success', tasks_affected: 1, error: null });
    const claims = db.writes.filter((write) => write.operation === 'insert');
    expect(claims).toHaveLength(2);
    expect(claims[0].payload.run_date).toBe(claims[1].payload.run_date);

    const repeated = await reconcile(request());
    expect(await repeated.json()).toEqual({ skipped: true, reason: 'already_run' });
    expect(deps.reconcile).toHaveBeenCalledTimes(2);
  });

  it('marks a failed cleanup so a later invocation can reclaim it', async () => {
    const db = makeTrackingDatabase();
    deps.client.mockReturnValue(db);
    deps.reconcile.mockRejectedValueOnce(new Error('Candidate query failed'));
    const response = await reconcile(request());
    expect(response.status).toBe(500);
    expect(db.updates).toEqual([{ status: 'failed', error: 'Candidate query failed' }]);
  });

  it('never reports success when tracking returns a database error', async () => {
    const db = makeTrackingDatabase({ trackingError: { message: 'Database unavailable' } });
    deps.client.mockReturnValue(db);
    const response = await reconcile(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error' });
    expect(db.updates[1]).toEqual({ status: 'failed', error: 'Cron run tracking failed: Database unavailable' });
  });
});
