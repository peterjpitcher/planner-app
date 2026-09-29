// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// The evening and Sunday tidy jobs used to email a "Daily Review" and a
// "Weekly Review". Both emails were retired on 29 Sep 2026 at the owner's
// request; the tidying itself carries on. These tests run each job end to end
// with every email setting present and assert the tasks still move and nothing
// is sent.

const deps = vi.hoisted(() => ({ client: vi.fn(), send: vi.fn(), updateTask: vi.fn() }));
vi.mock('@/lib/supabaseServiceRole', () => ({ getSupabaseServiceRole: deps.client }));
vi.mock('@/lib/microsoftGraph', () => ({ sendMicrosoftEmail: deps.send }));
vi.mock('@/services/taskService', () => ({ updateTask: deps.updateTask }));

import { GET as eveningTidy } from '../demote-today-tasks/route';
import { GET as sundayTidy } from '../demote-week-tasks/route';

function makeDatabase({ todayTasks = [], weekTasks = [] } = {}) {
  const taskUpdates = [];
  const cronRunPatches = [];
  return {
    taskUpdates,
    cronRunPatches,
    from(table) {
      const filters = {};
      let operation = 'select';
      let payload = null;
      let limited = false;
      const result = () => {
        if (table === 'cron_runs') {
          if (operation === 'insert') return { data: { id: 'run-1' }, error: null };
          if (operation === 'update') cronRunPatches.push(payload);
          return { data: null, error: null };
        }
        if (table === 'tasks') {
          if (operation === 'update') {
            taskUpdates.push({ id: filters.id, patch: payload });
            return { data: null, error: null };
          }
          if (limited) return { data: null, error: null }; // This Week sort_order lookup
          if (filters.state === 'today') return { data: todayTasks, error: null };
          if (filters.state === 'this_week') return { data: weekTasks, error: null };
        }
        return { data: null, error: null }; // planning_sessions: no plan made yet
      };
      const query = {
        select() { return query; },
        insert(values) { operation = 'insert'; payload = values; return query; },
        update(values) { operation = 'update'; payload = values; return query; },
        eq(key, value) { filters[key] = value; return query; },
        lt() { return query; },
        not() { return query; },
        in() { return query; },
        order() { return query; },
        limit() { limited = true; return query; },
        single() { return Promise.resolve(result()); },
        maybeSingle() { return Promise.resolve(result()); },
        then(onFulfilled, onRejected) { return Promise.resolve(result()).then(onFulfilled, onRejected); },
      };
      return query;
    },
  };
}

const forcedRun = () => new Request('https://fixture.test/api/cron/job?token=fixture-manual&force=true');

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('CRON_SECRET', 'fixture-secret');
  vi.stubEnv('CRON_MANUAL_TOKEN', 'fixture-manual');
  vi.stubEnv('DIGEST_USER_ID', 'user-1');
  // Every setting the old review emails needed, so only the code decides.
  vi.stubEnv('DAILY_TASK_EMAIL_FROM', 'from@fixture.test');
  vi.stubEnv('DAILY_TASK_EMAIL_TO', 'to@fixture.test');
  vi.stubEnv('DIGEST_USER_EMAIL', 'to@fixture.test');
  vi.stubEnv('MICROSOFT_USER_EMAIL', 'from@fixture.test');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('evening tidy', () => {
  it('keeps Must Do in Today, moves the rest to This Week, and sends no email', async () => {
    const db = makeDatabase({
      todayTasks: [
        { id: 'must', today_section: 'must_do', carried_count: 0 },
        { id: 'good', today_section: 'good_to_do', carried_count: 0 },
      ],
    });
    deps.client.mockReturnValue(db);

    const response = await eveningTidy(forcedRun());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kept: 1, moved: 1 });
    expect(db.taskUpdates.find((u) => u.id === 'good').patch).toMatchObject({ state: 'this_week' });
    expect(db.taskUpdates.find((u) => u.id === 'must').patch).toEqual({ carried_count: 1 });
    expect(db.cronRunPatches.at(-1)).toMatchObject({ status: 'success', tasks_affected: 2 });
    expect(deps.send).not.toHaveBeenCalled();
  });
});

describe('Sunday tidy', () => {
  it('moves stale This Week tasks to Backlog and sends no email', async () => {
    const db = makeDatabase({ weekTasks: [{ id: 'stale', carried_section: null }] });
    deps.client.mockReturnValue(db);
    deps.updateTask.mockResolvedValue({ data: { id: 'stale' }, error: null });

    const response = await sundayTidy(forcedRun());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ demoted: 1 });
    expect(deps.updateTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'stale',
      updates: { state: 'backlog' },
    }));
    expect(db.cronRunPatches.at(-1)).toMatchObject({ status: 'success', tasks_affected: 1 });
    expect(deps.send).not.toHaveBeenCalled();
  });
});
