// src/services/customerService.js
//
// Business rules for the customer record. Lives here rather than in routes or
// components so every caller gets the same behaviour, matching how
// projectLifecycleService and taskService are structured.

import {
  ACTIVE_STATES,
  CUSTOMER_STATUS,
  PROJECT_STATUS,
} from '@/lib/constants';
import { normaliseName, validateCustomer } from '@/lib/validators';

/** Project statuses that mean the project is finished. */
export const CLOSED_PROJECT_STATUSES = [
  PROJECT_STATUS.COMPLETED,
  PROJECT_STATUS.CANCELLED,
];

/** Columns the API is allowed to write. Anything else is ignored, not rejected. */
const CUSTOMER_UPDATE_FIELDS = ['name', 'status', 'area', 'website', 'summary'];

const CUSTOMER_COLUMNS =
  'id, user_id, name, status, area, website, summary, created_at, updated_at, archived_at';

/**
 * Pick the writable fields out of a request body.
 *
 * @param {Object} payload
 * @returns {Object}
 */
export function pickCustomerUpdates(payload) {
  const updates = {};
  CUSTOMER_UPDATE_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      updates[field] = payload[field];
    }
  });
  if (typeof updates.name === 'string') {
    updates.name = normaliseName(updates.name);
  }
  return updates;
}

/**
 * A customer that can take new work without a prompt.
 *
 * Archived is the hard stop: archive means "this is finished", so filing new
 * work against one silently would defeat the point of archiving it. Status is
 * softer, and Former only warrants a flag in the UI.
 *
 * @param {Object} customer
 * @returns {boolean}
 */
export function canTakeNewWork(customer) {
  if (!customer) return false;
  return !customer.archived_at;
}

/**
 * List customers with the counts the sidebar needs.
 *
 * The counts are aggregated in JavaScript rather than SQL because PostgREST has
 * no GROUP BY and the alternative is one count query per customer. At this
 * scale (hundreds of rows, single user) two flat reads and a reduce is both
 * faster and simpler than a view.
 *
 * @param {Object} params
 * @param {Object} params.supabase service-role client
 * @param {string} params.userId
 * @param {boolean} [params.includeArchived]
 * @param {string} [params.status]
 * @param {string} [params.area]
 * @returns {Promise<{data: Array|null, error: Object|null}>}
 */
export async function listCustomers({
  supabase,
  userId,
  includeArchived = false,
  status = null,
  area = null,
}) {
  let query = supabase
    .from('customers')
    .select(CUSTOMER_COLUMNS)
    .eq('user_id', userId);

  if (!includeArchived) query = query.is('archived_at', null);
  if (status) query = query.eq('status', status);
  if (area) query = query.ilike('area', area);

  const { data: customers, error } = await query.order('name', { ascending: true });
  if (error) return { data: null, error };

  const [projectResult, taskResult] = await Promise.all([
    supabase
      .from('projects')
      .select('customer_id, status')
      .eq('user_id', userId)
      .not('customer_id', 'is', null),
    supabase
      .from('tasks')
      .select('customer_id, state')
      .eq('user_id', userId)
      .not('customer_id', 'is', null)
      .in('state', ACTIVE_STATES),
  ]);

  if (projectResult.error) return { data: null, error: projectResult.error };
  if (taskResult.error) return { data: null, error: taskResult.error };

  const openProjects = new Map();
  const closedProjects = new Map();
  (projectResult.data || []).forEach((row) => {
    const bucket = CLOSED_PROJECT_STATUSES.includes(row.status) ? closedProjects : openProjects;
    bucket.set(row.customer_id, (bucket.get(row.customer_id) || 0) + 1);
  });

  const openTasks = new Map();
  (taskResult.data || []).forEach((row) => {
    openTasks.set(row.customer_id, (openTasks.get(row.customer_id) || 0) + 1);
  });

  return {
    data: (customers || []).map((customer) => ({
      ...customer,
      open_project_count: openProjects.get(customer.id) || 0,
      closed_project_count: closedProjects.get(customer.id) || 0,
      open_task_count: openTasks.get(customer.id) || 0,
      // Populated in Phase 2, when notes gain customer_id and occurred_at.
      last_contact_at: null,
    })),
    error: null,
  };
}

/**
 * One customer, ownership checked.
 *
 * @returns {Promise<{data: Object|null, error: {status: number, message: string}|null}>}
 */
export async function getCustomer({ supabase, userId, customerId }) {
  const { data, error } = await supabase
    .from('customers')
    .select(CUSTOMER_COLUMNS)
    .eq('id', customerId)
    .maybeSingle();

  if (error) return { data: null, error: { status: 500, message: error.message } };
  if (!data) return { data: null, error: { status: 404, message: 'Customer not found' } };

  // Every route uses the service-role client, so RLS does not apply and this
  // check is the only thing standing between a caller and someone else's row.
  if (data.user_id !== userId) {
    return { data: null, error: { status: 403, message: 'Forbidden' } };
  }

  return { data, error: null };
}

/**
 * Find a customer by name, case-insensitively and whitespace-normalised, so it
 * matches the unique index.
 *
 * @returns {Promise<{data: Object|null, error: Object|null}>}
 */
export async function findCustomerByName({ supabase, userId, name }) {
  const normalised = normaliseName(name);
  if (!normalised) return { data: null, error: null };

  const { data, error } = await supabase
    .from('customers')
    .select(CUSTOMER_COLUMNS)
    .eq('user_id', userId)
    .ilike('name', normalised)
    .maybeSingle();

  if (error) return { data: null, error };
  return { data: data || null, error: null };
}

/**
 * Create a customer.
 *
 * @returns {Promise<{data: Object|null, error: {status: number, message: string, details?: Object}|null}>}
 */
export async function createCustomer({ supabase, userId, payload }) {
  const candidate = {
    name: normaliseName(payload?.name),
    status: payload?.status || CUSTOMER_STATUS.ACTIVE,
    area: payload?.area || null,
    website: payload?.website || null,
    summary: payload?.summary || null,
  };

  const validation = validateCustomer(candidate);
  if (!validation.isValid) {
    return {
      data: null,
      error: { status: 400, message: 'Validation failed', details: validation.errors },
    };
  }

  const { data, error } = await supabase
    .from('customers')
    .insert({ ...candidate, user_id: userId })
    .select(CUSTOMER_COLUMNS)
    .single();

  if (error) {
    // 23505 is the case-insensitive unique index. A 409 rather than a 400 so
    // the client can offer to open the existing record instead of just
    // reporting that the name is taken.
    if (error.code === '23505') {
      return {
        data: null,
        error: { status: 409, message: 'A customer with that name already exists' },
      };
    }
    return { data: null, error: { status: 500, message: error.message } };
  }

  return { data, error: null };
}

/**
 * Update a customer, including archive and unarchive.
 *
 * @returns {Promise<{data: Object|null, error: Object|null}>}
 */
export async function updateCustomer({ supabase, userId, customerId, payload }) {
  const { data: existing, error: loadError } = await getCustomer({
    supabase,
    userId,
    customerId,
  });
  if (loadError) return { data: null, error: loadError };

  const updates = pickCustomerUpdates(payload || {});

  // Archive is a separate verb from the field updates, because it has a rule:
  // a customer with live work cannot be archived.
  if (Object.prototype.hasOwnProperty.call(payload || {}, 'archived')) {
    if (payload.archived) {
      const { data: impact } = await getCustomerImpact({ supabase, userId, customerId });
      if (impact && (impact.open_projects > 0 || impact.open_tasks > 0)) {
        return {
          data: null,
          error: {
            status: 409,
            message:
              `Finish or reassign this customer's open work first: ` +
              `${impact.open_projects} project(s) and ${impact.open_tasks} task(s) are still live.`,
          },
        };
      }
      updates.archived_at = new Date().toISOString();
    } else {
      updates.archived_at = null;
    }
  }

  if (Object.keys(updates).length === 0) {
    return { data: existing, error: null };
  }

  const validation = validateCustomer({ ...existing, ...updates });
  if (!validation.isValid) {
    return {
      data: null,
      error: { status: 400, message: 'Validation failed', details: validation.errors },
    };
  }

  const { data, error } = await supabase
    .from('customers')
    .update(updates)
    .eq('id', customerId)
    .eq('user_id', userId)
    .select(CUSTOMER_COLUMNS)
    .single();

  if (error) {
    if (error.code === '23505') {
      return {
        data: null,
        error: { status: 409, message: 'A customer with that name already exists' },
      };
    }
    return { data: null, error: { status: 500, message: error.message } };
  }

  return { data, error: null };
}

/**
 * What deleting or archiving this customer would affect.
 *
 * Counts are broken down by where the data actually lives, because "delete
 * customer" removes the customer record, it does not erase everything visible
 * on their page. A project keeps its notes; it just stops being filed under a
 * customer that no longer exists. A single merged number would imply otherwise.
 *
 * @returns {Promise<{data: Object|null, error: Object|null}>}
 */
export async function getCustomerImpact({ supabase, userId, customerId }) {
  const [projectResult, taskResult] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, status')
      .eq('user_id', userId)
      .eq('customer_id', customerId),
    supabase
      .from('tasks')
      .select('id, state')
      .eq('user_id', userId)
      .eq('customer_id', customerId),
  ]);

  if (projectResult.error) return { data: null, error: projectResult.error };
  if (taskResult.error) return { data: null, error: taskResult.error };

  const projects = projectResult.data || [];
  const tasks = taskResult.data || [];

  const openProjects = projects.filter((p) => !CLOSED_PROJECT_STATUSES.includes(p.status));
  const openTasks = tasks.filter((t) => ACTIVE_STATES.includes(t.state));

  return {
    data: {
      projects: projects.length,
      open_projects: openProjects.length,
      open_project_names: openProjects.slice(0, 10).map((p) => p.name),
      tasks: tasks.length,
      open_tasks: openTasks.length,
    },
    error: null,
  };
}

/**
 * Delete a customer.
 *
 * Projects and tasks survive: the composite foreign keys are ON DELETE SET NULL
 * (customer_id), so the link is cleared and the row is untouched. Phase 2 adds
 * notes, facts and contacts to this path via an RPC, because from that point
 * the operation spans several tables and has to be one transaction.
 *
 * @returns {Promise<{data: Object|null, error: Object|null}>}
 */
export async function deleteCustomer({ supabase, userId, customerId }) {
  const { error: loadError } = await getCustomer({ supabase, userId, customerId });
  if (loadError) return { data: null, error: loadError };

  const { data: impact } = await getCustomerImpact({ supabase, userId, customerId });

  const { error } = await supabase
    .from('customers')
    .delete()
    .eq('id', customerId)
    .eq('user_id', userId);

  if (error) return { data: null, error: { status: 500, message: error.message } };

  return { data: { deleted: true, ...(impact || {}) }, error: null };
}

/**
 * Everything the customer workspace needs in one payload.
 *
 * Tasks are the union of those pointing straight at the customer and those
 * reaching it through a project. The fn_task_customer_sync trigger means both
 * carry customer_id, so this is one indexed read rather than a join plus a
 * deduplication pass. Getting that wrong would count a project's tasks twice.
 *
 * @returns {Promise<{data: Object|null, error: Object|null}>}
 */
export async function getCustomerOverview({ supabase, userId, customerId }) {
  const { data: customer, error: customerError } = await getCustomer({
    supabase,
    userId,
    customerId,
  });
  if (customerError) return { data: null, error: customerError };

  const [projectResult, taskResult] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, description, status, due_date, area, completed_at, updated_at')
      .eq('user_id', userId)
      .eq('customer_id', customerId)
      .order('due_date', { ascending: true, nullsFirst: false }),
    supabase
      .from('tasks')
      .select('id, name, description, state, today_section, due_date, project_id, area, task_type, chips, sort_order')
      .eq('user_id', userId)
      .eq('customer_id', customerId)
      .in('state', ACTIVE_STATES)
      .order('sort_order', { ascending: true }),
  ]);

  if (projectResult.error) {
    return { data: null, error: { status: 500, message: projectResult.error.message } };
  }
  if (taskResult.error) {
    return { data: null, error: { status: 500, message: taskResult.error.message } };
  }

  const allProjects = projectResult.data || [];

  return {
    data: {
      customer,
      openProjects: allProjects.filter((p) => !CLOSED_PROJECT_STATUSES.includes(p.status)),
      closedProjects: allProjects.filter((p) => CLOSED_PROJECT_STATUSES.includes(p.status)),
      tasks: taskResult.data || [],
    },
    error: null,
  };
}
