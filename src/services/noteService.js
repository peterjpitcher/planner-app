// src/services/noteService.js
//
// Notes stopped being "a line of text on a project" in Phase 2. They carry a
// customer parent, a real "when it happened" timestamp separate from when the
// row was written, a source, a pin, and movement provenance. That is more rules
// than belong inline in a route, and the customer timeline needs the same rules
// as the project note list.

import { VALIDATION } from '@/lib/constants';

/** Where a note can be filed. Exactly one, or none (unfiled). */
export const NOTE_PARENTS = ['project_id', 'task_id', 'idea_id', 'customer_id'];

/** How a note arrived. Matches the notes_source_check constraint. */
export const NOTE_SOURCES = [
  'note',
  'email',
  'call',
  'meeting',
  'message',
  'document',
  'other',
];

const NOTE_COLUMNS =
  'id, user_id, content, project_id, task_id, idea_id, customer_id, contact_id, ' +
  'origin_project_id, lifecycle_move_id, lifecycle_moved_at, occurred_at, source, ' +
  'pinned, context_label, created_at, updated_at';

/** Fields a client may set when creating a note. */
const CREATE_FIELDS = new Set([
  'content',
  'project_id',
  'task_id',
  'idea_id',
  'customer_id',
  'contact_id',
  'occurred_at',
  'source',
  'pinned',
]);

/**
 * Fields a client may change.
 *
 * The lifecycle columns are absent on purpose: they are written only by
 * close_project, reopen_project and the delete RPC. A client that could set
 * lifecycle_move_id could make a note it wrote look like one the close moved,
 * and reopen would then drag it back.
 */
const UPDATE_FIELDS = new Set([
  'content',
  'occurred_at',
  'source',
  'pinned',
  'contact_id',
]);

function pick(payload, allowed) {
  const picked = {};
  Object.entries(payload || {}).forEach(([key, value]) => {
    if (allowed.has(key)) picked[key] = value;
  });
  return picked;
}

/**
 * How many parents a note payload names.
 *
 * @param {Object} note
 * @returns {number}
 */
export function countParents(note) {
  return NOTE_PARENTS.filter((key) => note?.[key]).length;
}

/**
 * Validate a note.
 *
 * @param {Object} note
 * @param {boolean} [isUpdate] updates do not have to restate the parent
 * @returns {{isValid: boolean, errors: Object}}
 */
export function validateNotePayload(note, isUpdate = false) {
  const errors = {};

  if (!isUpdate || Object.prototype.hasOwnProperty.call(note, 'content')) {
    const content = String(note?.content ?? '');
    if (content.trim().length === 0) {
      errors.content = 'Note content is required';
    } else if (content.length > VALIDATION.NOTE_MAX) {
      errors.content = `Note must be ${VALIDATION.NOTE_MAX} characters or fewer`;
    }
  }

  if (!isUpdate && countParents(note) > 1) {
    errors.parent = 'A note can belong to at most one of a project, task, idea or customer';
  }

  if (note?.source && !NOTE_SOURCES.includes(note.source)) {
    errors.source = 'Unknown note source';
  }

  if (note?.occurred_at) {
    const when = new Date(note.occurred_at);
    if (Number.isNaN(when.getTime())) {
      errors.occurred_at = 'Invalid date';
    }
  }

  return { isValid: Object.keys(errors).length === 0, errors };
}

/**
 * Notes for one parent.
 *
 * `includeOrigin` widens a project query to notes that this project handed to a
 * customer when it closed. Without it a closed project shows an empty note list,
 * which looks exactly like data loss even though every row is intact.
 *
 * @returns {Promise<{data: Array|null, error: Object|null}>}
 */
export async function listNotes({
  supabase,
  userId,
  projectId = null,
  taskId = null,
  customerId = null,
  includeOrigin = true,
}) {
  let query = supabase.from('notes').select(NOTE_COLUMNS).eq('user_id', userId);

  if (projectId) {
    query = includeOrigin
      ? query.or(`project_id.eq.${projectId},origin_project_id.eq.${projectId}`)
      : query.eq('project_id', projectId);
  } else if (taskId) {
    query = query.eq('task_id', taskId);
  } else if (customerId) {
    query = query.eq('customer_id', customerId);
  }

  const { data, error } = await query
    .order('pinned', { ascending: false })
    .order('occurred_at', { ascending: false });

  if (error) return { data: null, error: { status: 500, message: error.message } };
  return { data: data || [], error: null };
}

/**
 * One note, ownership checked.
 */
export async function getNote({ supabase, userId, noteId }) {
  const { data, error } = await supabase
    .from('notes')
    .select(NOTE_COLUMNS)
    .eq('id', noteId)
    .maybeSingle();

  if (error) return { data: null, error: { status: 500, message: error.message } };
  if (!data) return { data: null, error: { status: 404, message: 'Note not found' } };
  if (data.user_id !== userId) {
    return { data: null, error: { status: 403, message: 'Forbidden' } };
  }
  return { data, error: null };
}

/**
 * Verify the caller owns whatever the note is being filed against.
 *
 * Every route uses the service-role client, so this is the only check between a
 * caller and someone else's project.
 */
async function assertParentOwned({ supabase, userId, note }) {
  const checks = [
    ['project_id', 'projects', 'Project'],
    ['task_id', 'tasks', 'Task'],
    ['idea_id', 'ideas', 'Idea'],
    ['customer_id', 'customers', 'Customer'],
    ['contact_id', 'contacts', 'Contact'],
  ];

  for (const [field, table, label] of checks) {
    if (!note[field]) continue;
    const { data, error } = await supabase
      .from(table)
      .select('user_id')
      .eq('id', note[field])
      .maybeSingle();

    if (error || !data) {
      return { status: 404, message: `${label} not found` };
    }
    if (data.user_id !== userId) {
      return { status: 403, message: 'Forbidden' };
    }
  }

  return null;
}

/**
 * Create a note.
 */
export async function createNote({ supabase, userId, payload }) {
  const note = pick(payload, CREATE_FIELDS);

  const validation = validateNotePayload(note);
  if (!validation.isValid) {
    return {
      data: null,
      error: { status: 400, message: 'Validation failed', details: validation.errors },
    };
  }

  const ownerError = await assertParentOwned({ supabase, userId, note });
  if (ownerError) return { data: null, error: ownerError };

  const { data, error } = await supabase
    .from('notes')
    .insert({ ...note, content: String(note.content).trim(), user_id: userId })
    .select(NOTE_COLUMNS)
    .single();

  if (error) return { data: null, error: { status: 400, message: error.message } };
  return { data, error: null };
}

/**
 * Edit a note.
 *
 * Any user edit clears lifecycle_move_id. That is what makes reopen correct: a
 * note the close moved and you then edited is yours, not the cascade's, so
 * reopening the project must leave it where it is rather than dragging it back
 * to the project.
 */
export async function updateNote({ supabase, userId, noteId, payload }) {
  const { error: loadError } = await getNote({ supabase, userId, noteId });
  if (loadError) return { data: null, error: loadError };

  const updates = pick(payload, UPDATE_FIELDS);
  if (Object.keys(updates).length === 0) {
    return { data: null, error: { status: 400, message: 'No valid fields to update' } };
  }

  const validation = validateNotePayload(updates, true);
  if (!validation.isValid) {
    return {
      data: null,
      error: { status: 400, message: 'Validation failed', details: validation.errors },
    };
  }

  if (updates.contact_id) {
    const ownerError = await assertParentOwned({ supabase, userId, note: updates });
    if (ownerError) return { data: null, error: ownerError };
  }

  if (typeof updates.content === 'string') {
    updates.content = updates.content.trim();
  }

  const { data, error } = await supabase
    .from('notes')
    .update({ ...updates, lifecycle_move_id: null, lifecycle_moved_at: null })
    .eq('id', noteId)
    .eq('user_id', userId)
    .select(NOTE_COLUMNS)
    .single();

  if (error) return { data: null, error: { status: 400, message: error.message } };
  return { data, error: null };
}

/**
 * Delete a note.
 */
export async function deleteNote({ supabase, userId, noteId }) {
  const { error: loadError } = await getNote({ supabase, userId, noteId });
  if (loadError) return { data: null, error: loadError };

  const { error } = await supabase
    .from('notes')
    .delete()
    .eq('id', noteId)
    .eq('user_id', userId);

  if (error) return { data: null, error: { status: 500, message: error.message } };
  return { data: { deleted: true }, error: null };
}

/**
 * Re-file an unfiled note onto a customer.
 *
 * Clears the lifecycle marker for the same reason updateNote does: this is a
 * deliberate placement, not a cascade, and nothing should move it again.
 */
export async function refileNote({ supabase, userId, noteId, customerId }) {
  const { error: loadError } = await getNote({ supabase, userId, noteId });
  if (loadError) return { data: null, error: loadError };

  const ownerError = await assertParentOwned({
    supabase,
    userId,
    note: { customer_id: customerId },
  });
  if (ownerError) return { data: null, error: ownerError };

  const { data, error } = await supabase
    .from('notes')
    .update({
      customer_id: customerId,
      project_id: null,
      task_id: null,
      idea_id: null,
      origin_project_id: null,
      lifecycle_move_id: null,
      lifecycle_moved_at: null,
      context_label: null,
    })
    .eq('id', noteId)
    .eq('user_id', userId)
    .select(NOTE_COLUMNS)
    .single();

  if (error) return { data: null, error: { status: 400, message: error.message } };
  return { data, error: null };
}

/**
 * Notes with no parent at all.
 *
 * These arise when a project without a customer is deleted. They are legal (the
 * check constraint permits zero parents) but they must not become invisible, so
 * they get a panel of their own and a count badge on the nav.
 */
export async function listUnfiledNotes({ supabase, userId, limit = 100 }) {
  const { data, error } = await supabase
    .from('notes')
    .select(NOTE_COLUMNS)
    .eq('user_id', userId)
    .is('project_id', null)
    .is('task_id', null)
    .is('idea_id', null)
    .is('customer_id', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return { data: null, error: { status: 500, message: error.message } };
  return { data: data || [], error: null };
}

/**
 * The customer timeline: every note that reaches this customer.
 *
 * Three sources, because a note can be filed at three levels and hiding any of
 * them would make the customer view lie about what you know:
 *   1. filed directly on the customer
 *   2. on one of their projects, open or closed
 *   3. on one of their tasks
 *
 * Ordered pinned first, then by occurred_at. occurred_at, not created_at:
 * created_at is when the row was written, which is the audit trail, and a note
 * backdated to last Tuesday belongs on last Tuesday.
 *
 * @returns {Promise<{data: Array|null, error: Object|null}>}
 */
export async function getCustomerTimeline({ supabase, userId, customerId, limit = 100 }) {
  const [projectResult, taskResult] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, status')
      .eq('user_id', userId)
      .eq('customer_id', customerId),
    supabase
      .from('tasks')
      .select('id, name')
      .eq('user_id', userId)
      .eq('customer_id', customerId),
  ]);

  if (projectResult.error) {
    return { data: null, error: { status: 500, message: projectResult.error.message } };
  }
  if (taskResult.error) {
    return { data: null, error: { status: 500, message: taskResult.error.message } };
  }

  const projects = projectResult.data || [];
  const tasks = taskResult.data || [];
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const filters = [`customer_id.eq.${customerId}`];
  if (projects.length > 0) {
    filters.push(`project_id.in.(${projects.map((p) => p.id).join(',')})`);
  }
  if (tasks.length > 0) {
    filters.push(`task_id.in.(${tasks.map((t) => t.id).join(',')})`);
  }

  const { data, error } = await supabase
    .from('notes')
    .select(NOTE_COLUMNS)
    .eq('user_id', userId)
    .or(filters.join(','))
    .order('pinned', { ascending: false })
    .order('occurred_at', { ascending: false })
    .limit(limit);

  if (error) return { data: null, error: { status: 500, message: error.message } };

  // Decorate with where each note actually lives, so the timeline can show a
  // badge linking back rather than presenting everything as customer-level.
  const decorated = (data || []).map((note) => {
    const project = note.project_id
      ? projectById.get(note.project_id)
      : note.origin_project_id
        ? projectById.get(note.origin_project_id)
        : null;

    return {
      ...note,
      source_project: project ? { id: project.id, name: project.name, status: project.status } : null,
      source_task: note.task_id ? taskById.get(note.task_id) || null : null,
    };
  });

  return { data: decorated, error: null };
}
