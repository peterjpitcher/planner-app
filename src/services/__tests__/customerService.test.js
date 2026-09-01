import { describe, it, expect } from 'vitest';
import {
  canTakeNewWork,
  createCustomer,
  deleteCustomer,
  getCustomer,
  getCustomerImpact,
  getCustomerOverview,
  listCustomers,
  pickCustomerUpdates,
  updateCustomer,
} from '../customerService';
import { CUSTOMER_STATUS, PROJECT_STATUS, STATE } from '@/lib/constants';

/**
 * Supabase query-builder stub.
 *
 * Every filter method returns the chain, and the chain is thenable, so it works
 * whether the call ends in .order(), .single(), .maybeSingle() or a bare await.
 * `tables` supplies the rows each table resolves to; `captured` records what was
 * written so the tests can assert on payloads rather than only on return values.
 */
function makeSupabase(tables = {}, { failOn = null, errorCode = null } = {}) {
  const captured = { inserted: null, updated: null, deleted: false, filters: [] };

  function chain(table) {
    const rows = tables[table] ?? [];
    let mode = 'select';
    let payload = null;

    const api = {
      select() {
        return api;
      },
      insert(values) {
        mode = 'insert';
        payload = values;
        captured.inserted = values;
        return api;
      },
      update(values) {
        mode = 'update';
        payload = values;
        captured.updated = values;
        return api;
      },
      delete() {
        mode = 'delete';
        captured.deleted = true;
        return api;
      },
      eq(column, value) {
        captured.filters.push([table, column, value]);
        return api;
      },
      is() {
        return api;
      },
      ilike(column, value) {
        captured.filters.push([table, `ilike:${column}`, value]);
        return api;
      },
      not() {
        return api;
      },
      in() {
        return api;
      },
      order() {
        return api;
      },
      result() {
        if (failOn === table) {
          return { data: null, error: { code: errorCode, message: 'boom' } };
        }
        if (mode === 'insert') {
          return { data: { id: 'new-id', ...payload }, error: null };
        }
        if (mode === 'update') {
          return { data: { ...rows[0], ...payload }, error: null };
        }
        if (mode === 'delete') {
          return { data: null, error: null };
        }
        return { data: rows, error: null };
      },
      single() {
        return Promise.resolve(api.result());
      },
      maybeSingle() {
        const res = api.result();
        return Promise.resolve({ data: Array.isArray(res.data) ? res.data[0] ?? null : res.data, error: res.error });
      },
      then(resolve, reject) {
        return Promise.resolve(api.result()).then(resolve, reject);
      },
    };

    return api;
  }

  return { from: (table) => chain(table), captured };
}

const USER = 'user-1';
const CUSTOMER = {
  id: 'cust-1',
  user_id: USER,
  name: 'Acme Ltd',
  status: CUSTOMER_STATUS.ACTIVE,
  area: 'Consulting',
  website: null,
  summary: null,
  archived_at: null,
};

describe('pickCustomerUpdates', () => {
  it('ignores fields the API must not let a client write', () => {
    const updates = pickCustomerUpdates({
      name: 'Acme',
      user_id: 'someone-else',
      id: 'other-id',
      created_at: '2020-01-01',
    });

    expect(updates).toEqual({ name: 'Acme' });
  });

  it('normalises the name so it matches the unique index', () => {
    expect(pickCustomerUpdates({ name: '  Acme   Ltd  ' })).toEqual({ name: 'Acme Ltd' });
  });
});

describe('canTakeNewWork', () => {
  it('allows any status that is not archived', () => {
    expect(canTakeNewWork({ status: CUSTOMER_STATUS.FORMER, archived_at: null })).toBe(true);
    expect(canTakeNewWork({ status: CUSTOMER_STATUS.DORMANT, archived_at: null })).toBe(true);
  });

  it('refuses an archived customer whatever its status', () => {
    // Archive means "this is finished". Filing new work against one silently
    // would defeat the point of archiving it.
    expect(canTakeNewWork({ status: CUSTOMER_STATUS.ACTIVE, archived_at: '2026-01-01' })).toBe(false);
  });

  it('refuses a missing customer rather than throwing', () => {
    expect(canTakeNewWork(null)).toBe(false);
  });
});

describe('listCustomers', () => {
  it('counts open and closed projects separately', async () => {
    const supabase = makeSupabase({
      customers: [CUSTOMER, { ...CUSTOMER, id: 'cust-2', name: 'Beta' }],
      projects: [
        { customer_id: 'cust-1', status: PROJECT_STATUS.OPEN },
        { customer_id: 'cust-1', status: PROJECT_STATUS.IN_PROGRESS },
        { customer_id: 'cust-1', status: PROJECT_STATUS.COMPLETED },
        { customer_id: 'cust-2', status: PROJECT_STATUS.CANCELLED },
      ],
      tasks: [
        { customer_id: 'cust-1', state: STATE.TODAY },
        { customer_id: 'cust-1', state: STATE.BACKLOG },
      ],
    });

    const { data } = await listCustomers({ supabase, userId: USER });

    expect(data[0]).toMatchObject({
      id: 'cust-1',
      open_project_count: 2,
      closed_project_count: 1,
      open_task_count: 2,
    });
    expect(data[1]).toMatchObject({
      id: 'cust-2',
      open_project_count: 0,
      closed_project_count: 1,
      open_task_count: 0,
    });
  });

  it('counts a project task once, not twice', async () => {
    // fn_task_customer_sync stamps customer_id on tasks that reach the customer
    // through a project, so the union is a single read. Joining projects and
    // tasks separately and adding them would double-count every project task.
    const supabase = makeSupabase({
      customers: [CUSTOMER],
      projects: [{ customer_id: 'cust-1', status: PROJECT_STATUS.OPEN }],
      tasks: [{ customer_id: 'cust-1', state: STATE.TODAY }],
    });

    const { data } = await listCustomers({ supabase, userId: USER });
    expect(data[0].open_task_count).toBe(1);
  });

  it('reports zero rather than undefined for a customer with nothing', async () => {
    const supabase = makeSupabase({ customers: [CUSTOMER], projects: [], tasks: [] });
    const { data } = await listCustomers({ supabase, userId: USER });

    expect(data[0].open_project_count).toBe(0);
    expect(data[0].open_task_count).toBe(0);
  });

  it('surfaces a read failure instead of returning half the picture', async () => {
    const supabase = makeSupabase({ customers: [CUSTOMER] }, { failOn: 'projects' });
    const { data, error } = await listCustomers({ supabase, userId: USER });

    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });
});

describe('getCustomer', () => {
  it('returns the row for its owner', async () => {
    const supabase = makeSupabase({ customers: [CUSTOMER] });
    const { data, error } = await getCustomer({ supabase, userId: USER, customerId: 'cust-1' });

    expect(error).toBeNull();
    expect(data.id).toBe('cust-1');
  });

  it('refuses another user, because the service-role client bypasses RLS', async () => {
    const supabase = makeSupabase({ customers: [CUSTOMER] });
    const { data, error } = await getCustomer({
      supabase,
      userId: 'someone-else',
      customerId: 'cust-1',
    });

    expect(data).toBeNull();
    expect(error.status).toBe(403);
  });

  it('404s a missing customer', async () => {
    const supabase = makeSupabase({ customers: [] });
    const { error } = await getCustomer({ supabase, userId: USER, customerId: 'nope' });
    expect(error.status).toBe(404);
  });
});

describe('createCustomer', () => {
  it('stamps the caller as the owner rather than trusting the payload', async () => {
    const supabase = makeSupabase({ customers: [] });
    await createCustomer({
      supabase,
      userId: USER,
      payload: { name: 'Acme', user_id: 'someone-else' },
    });

    expect(supabase.captured.inserted.user_id).toBe(USER);
  });

  it('normalises the name before insert', async () => {
    const supabase = makeSupabase({ customers: [] });
    await createCustomer({ supabase, userId: USER, payload: { name: '  Acme   Ltd ' } });

    expect(supabase.captured.inserted.name).toBe('Acme Ltd');
  });

  it('defaults to Active', async () => {
    const supabase = makeSupabase({ customers: [] });
    await createCustomer({ supabase, userId: USER, payload: { name: 'Acme' } });

    expect(supabase.captured.inserted.status).toBe(CUSTOMER_STATUS.ACTIVE);
  });

  it('rejects a blank name', async () => {
    const supabase = makeSupabase({ customers: [] });
    const { error } = await createCustomer({ supabase, userId: USER, payload: { name: '   ' } });

    expect(error.status).toBe(400);
    expect(error.details.name).toBeTruthy();
  });

  it('rejects a javascript: website, which would execute from the header link', async () => {
    const supabase = makeSupabase({ customers: [] });
    const { error } = await createCustomer({
      supabase,
      userId: USER,
      payload: { name: 'Acme', website: 'javascript:alert(1)' },
    });

    expect(error.status).toBe(400);
    expect(error.details.website).toBeTruthy();
  });

  it('turns a duplicate name into a 409, so the client can offer the existing record', async () => {
    const supabase = makeSupabase({ customers: [] }, { failOn: 'customers', errorCode: '23505' });
    const { error } = await createCustomer({ supabase, userId: USER, payload: { name: 'Acme' } });

    expect(error.status).toBe(409);
  });
});

describe('updateCustomer', () => {
  it('refuses to archive a customer with live work', async () => {
    // Archive means finished. Hiding a customer who still has open projects
    // would hide the work with them.
    const supabase = makeSupabase({
      customers: [CUSTOMER],
      projects: [{ id: 'p1', name: 'Live project', status: PROJECT_STATUS.OPEN }],
      tasks: [],
    });

    const { error } = await updateCustomer({
      supabase,
      userId: USER,
      customerId: 'cust-1',
      payload: { archived: true },
    });

    expect(error.status).toBe(409);
    expect(error.message).toContain('1 project');
  });

  it('archives a customer whose work is all finished', async () => {
    const supabase = makeSupabase({
      customers: [CUSTOMER],
      projects: [{ id: 'p1', name: 'Done', status: PROJECT_STATUS.COMPLETED }],
      tasks: [{ id: 't1', state: STATE.DONE }],
    });

    const { error } = await updateCustomer({
      supabase,
      userId: USER,
      customerId: 'cust-1',
      payload: { archived: true },
    });

    expect(error).toBeNull();
    expect(supabase.captured.updated.archived_at).toBeTruthy();
  });

  it('unarchives without checking for open work', async () => {
    const supabase = makeSupabase({
      customers: [{ ...CUSTOMER, archived_at: '2026-01-01' }],
      projects: [],
      tasks: [],
    });

    const { error } = await updateCustomer({
      supabase,
      userId: USER,
      customerId: 'cust-1',
      payload: { archived: false },
    });

    expect(error).toBeNull();
    expect(supabase.captured.updated.archived_at).toBeNull();
  });

  it('refuses another user before touching anything', async () => {
    const supabase = makeSupabase({ customers: [CUSTOMER] });
    const { error } = await updateCustomer({
      supabase,
      userId: 'someone-else',
      customerId: 'cust-1',
      payload: { name: 'Hijacked' },
    });

    expect(error.status).toBe(403);
    expect(supabase.captured.updated).toBeNull();
  });

  it('validates the merged row, not just the changed field', async () => {
    const supabase = makeSupabase({ customers: [CUSTOMER] });
    const { error } = await updateCustomer({
      supabase,
      userId: USER,
      customerId: 'cust-1',
      payload: { status: 'Nonsense' },
    });

    expect(error.status).toBe(400);
  });
});

describe('getCustomerImpact', () => {
  it('separates open work from the total, because the two mean different things', async () => {
    const supabase = makeSupabase({
      projects: [
        { id: 'p1', name: 'Live', status: PROJECT_STATUS.OPEN },
        { id: 'p2', name: 'Finished', status: PROJECT_STATUS.COMPLETED },
      ],
      tasks: [
        { id: 't1', state: STATE.TODAY },
        { id: 't2', state: STATE.DONE },
      ],
    });

    const { data } = await getCustomerImpact({ supabase, userId: USER, customerId: 'cust-1' });

    expect(data).toMatchObject({
      projects: 2,
      open_projects: 1,
      tasks: 2,
      open_tasks: 1,
    });
    expect(data.open_project_names).toEqual(['Live']);
  });
});

describe('deleteCustomer', () => {
  it('checks ownership before deleting anything', async () => {
    const supabase = makeSupabase({ customers: [CUSTOMER] });
    const { error } = await deleteCustomer({
      supabase,
      userId: 'someone-else',
      customerId: 'cust-1',
    });

    expect(error.status).toBe(403);
    expect(supabase.captured.deleted).toBe(false);
  });

  it('reports what survived, so the caller can say so', async () => {
    const supabase = makeSupabase({
      customers: [CUSTOMER],
      projects: [{ id: 'p1', name: 'Kept', status: PROJECT_STATUS.OPEN }],
      tasks: [{ id: 't1', state: STATE.TODAY }],
    });

    const { data, error } = await deleteCustomer({ supabase, userId: USER, customerId: 'cust-1' });

    expect(error).toBeNull();
    expect(data).toMatchObject({ deleted: true, projects: 1, tasks: 1 });
  });
});

describe('getCustomerOverview', () => {
  it('splits open from closed projects so closing one does not hide it', async () => {
    const supabase = makeSupabase({
      customers: [CUSTOMER],
      projects: [
        { id: 'p1', name: 'Live', status: PROJECT_STATUS.OPEN },
        { id: 'p2', name: 'Done', status: PROJECT_STATUS.COMPLETED },
        { id: 'p3', name: 'Binned', status: PROJECT_STATUS.CANCELLED },
      ],
      tasks: [{ id: 't1', name: 'Task', state: STATE.TODAY }],
    });

    const { data } = await getCustomerOverview({ supabase, userId: USER, customerId: 'cust-1' });

    expect(data.openProjects.map((p) => p.id)).toEqual(['p1']);
    expect(data.closedProjects.map((p) => p.id)).toEqual(['p2', 'p3']);
    expect(data.tasks).toHaveLength(1);
  });

  it('refuses another user', async () => {
    const supabase = makeSupabase({ customers: [CUSTOMER] });
    const { error } = await getCustomerOverview({
      supabase,
      userId: 'someone-else',
      customerId: 'cust-1',
    });

    expect(error.status).toBe(403);
  });
});
