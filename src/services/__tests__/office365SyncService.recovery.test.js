import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  client: vi.fn(), token: vi.fn(), connection: vi.fn(), graph: vi.fn(), recordFailure: vi.fn(),
}));
vi.mock('@/lib/supabaseServiceRole', () => ({ getSupabaseServiceRole: deps.client }));
vi.mock('@/lib/office365/graph', () => ({ office365GraphRequest: deps.graph }));
vi.mock('@/services/office365ConnectionService', () => ({
  getOffice365Connection: deps.connection,
  getValidOffice365AccessToken: deps.token,
  recordOffice365SyncFailure: deps.recordFailure,
}));

import { deleteOffice365Task, syncOffice365All, syncOffice365Task } from '../office365SyncService';

// Stateful database fixture: failed deletes retain rows, successful deletes
// remove them, and the next full sync observes the actual previous result.
function makeDatabase() {
  const tables = {
    tasks: [{ id: 'task', user_id: 'user', project_id: 'project', name: 'Send report', state: 'done', updated_at: '2026-09-05T08:00:00Z' }],
    projects: [{ id: 'project', user_id: 'user', name: 'Project', status: 'Open', customer_id: null }],
    office365_task_items: [{ id: 'mapping', user_id: 'user', project_id: 'project', task_id: 'task', list_id: 'list', todo_task_id: 'remote', etag: 'old' }],
    office365_project_lists: [{ id: 'project-map', user_id: 'user', project_id: 'project', list_id: 'list' }],
    office365_connections: [{ id: 'connection', user_id: 'user', last_synced_at: '2026-09-05T09:00:00Z' }],
    cron_runs: [],
  };
  const mutations = [];
  const failures = new Map();
  let sequence = 0;
  const db = {
    tables, mutations, failures,
    from(table) {
      let operation = 'select';
      let payload;
      const predicates = [];
      const execute = () => {
        const injected = failures.get(`${table}:${operation}`);
        if (injected) return { data: null, error: injected };
        const rows = tables[table];
        if (!rows) throw new Error(`Unexpected fixture table: ${table}`);
        let selected = rows.filter((row) => predicates.every((predicate) => predicate(row)));
        if (operation !== 'select') mutations.push({ table, operation, payload });
        if (operation === 'insert') {
          selected = [{ id: `new-${++sequence}`, created_at: new Date().toISOString(), ...payload }];
          rows.push(...selected);
        } else if (operation === 'update') {
          selected.forEach((row) => Object.assign(row, payload));
        } else if (operation === 'delete') {
          tables[table] = rows.filter((row) => !selected.includes(row));
        }
        return { data: selected.map((row) => ({ ...row })), error: null };
      };
      const query = {
        select() { return query; },
        eq(key, value) { predicates.push((row) => row[key] === value); return query; },
        insert(values) { operation = 'insert'; payload = values; return query; },
        update(values) { operation = 'update'; payload = values; return query; },
        delete() { operation = 'delete'; return query; },
        single() { const result = execute(); return Promise.resolve({ ...result, data: result.data?.[0] || null }); },
        maybeSingle() { return query.single(); },
        then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
      };
      return query;
    },
  };
  return db;
}

let db;
let remoteExists;
let remoteFailure;
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  db = makeDatabase();
  remoteExists = true;
  remoteFailure = true;
  deps.client.mockReturnValue(db);
  deps.token.mockResolvedValue('fixture-token');
  deps.connection.mockImplementation(async () => ({ ...db.tables.office365_connections[0] }));
  deps.recordFailure.mockResolvedValue(undefined);
  deps.graph.mockImplementation(async ({ method, path }) => {
    if (method === 'PATCH' && path === '/me/todo/lists/list') return { id: 'list' };
    if (method === 'GET' && path.startsWith('/me/todo/lists/list/tasks?')) {
      return { value: remoteExists ? [{ id: 'remote', title: 'Send report', status: 'notStarted', body: { content: '' }, '@odata.etag': 'new', lastModifiedDateTime: '2026-09-05T10:00:00Z' }] : [] };
    }
    if (method === 'DELETE' && path === '/me/todo/lists/list/tasks/remote') {
      if (remoteFailure) throw new Error('Office365 Graph DELETE failed (503)');
      if (!remoteExists) throw new Error('Office365 Graph DELETE failed (404)');
      remoteExists = false;
      return null;
    }
    throw new Error(`Unexpected fixture Graph request: ${method} ${path}`);
  });
});
afterEach(() => vi.restoreAllMocks());

describe('Outlook deletion recovery', () => {
  it('keeps completed work closed through failed deletion, full sync and recovery', async () => {
    await expect(syncOffice365Task({ userId: 'user', taskId: 'task' })).rejects.toThrow('Outlook could not remove');
    expect(db.tables.office365_task_items).toHaveLength(1);
    expect(deps.recordFailure).toHaveBeenCalled();
    expect(db.tables.office365_connections[0].last_synced_at).toBe('2026-09-05T09:00:00Z');

    // The remote item is newer than both the completion and last sync. It
    // must still never reopen the local task while remote deletion is pending.
    await expect(syncOffice365All({ userId: 'user' })).rejects.toThrow('Outlook cleanup failed');
    expect(db.tables.tasks).toHaveLength(1);
    expect(db.tables.tasks[0].state).toBe('done');
    expect(db.tables.office365_task_items).toHaveLength(1);

    remoteFailure = false;
    const result = await syncOffice365All({ userId: 'user' });
    expect(result.pulledCreatedTasks).toBe(0);
    expect(result.pulledUpdatedTasks).toBe(0);
    expect(remoteExists).toBe(false);
    expect(db.tables.office365_task_items).toHaveLength(0);
    expect(db.tables.tasks).toHaveLength(1);
    expect(db.tables.tasks[0].state).toBe('done');
    expect(db.mutations.filter((m) => m.table === 'tasks')).toEqual([]);
    expect(db.tables.cron_runs).toEqual([]);
  });

  it('retains a failed explicit deletion mapping until the deletion is retried', async () => {
    db.tables.tasks[0].state = 'backlog';
    expect((await deleteOffice365Task({ userId: 'user', taskId: 'task' })).error.status).toBe(503);
    expect(db.tables.office365_task_items).toHaveLength(1);
    expect(db.tables.tasks).toHaveLength(1);
    remoteFailure = false;
    expect(await deleteOffice365Task({ userId: 'user', taskId: 'task' })).toEqual({ error: null });
    expect(remoteExists).toBe(false);
    expect(db.tables.office365_task_items).toHaveLength(0);
  });

  it('does not resolve or refresh a token when the task has no mapping', async () => {
    db.tables.office365_task_items = [];
    expect(await deleteOffice365Task({ userId: 'user', taskId: 'task' })).toEqual({ error: null });
    expect(deps.token).not.toHaveBeenCalled();
    expect(deps.graph).not.toHaveBeenCalled();
  });

  it('treats an already absent remote item as successfully deleted', async () => {
    remoteExists = false;
    remoteFailure = false;
    expect(await deleteOffice365Task({ userId: 'user', taskId: 'task' })).toEqual({ error: null });
    expect(db.tables.office365_task_items).toHaveLength(0);
  });

  it.each(['select', 'delete'])('reports a returned mapping %s error and keeps the retry record', async (operation) => {
    remoteFailure = false;
    db.failures.set(`office365_task_items:${operation}`, { message: 'Database unavailable' });
    expect((await deleteOffice365Task({ userId: 'user', taskId: 'task' })).error.status).toBe(503);
    expect(db.tables.office365_task_items).toHaveLength(1);
  });

  it('keeps the mapping when token refresh fails', async () => {
    deps.token.mockRejectedValueOnce(new Error('Token refresh failed'));
    expect((await deleteOffice365Task({ userId: 'user', taskId: 'task' })).error.status).toBe(503);
    expect(db.tables.office365_task_items).toHaveLength(1);
    expect(deps.graph).not.toHaveBeenCalled();
  });
});
