import { describe, it, expect } from 'vitest';
import {
  countParents,
  createNote,
  deleteNote,
  getNote,
  listNotes,
  refileNote,
  updateNote,
  validateNotePayload,
  NOTE_SOURCES,
} from '../noteService';
import { VALIDATION } from '@/lib/constants';

/**
 * Supabase stub. Records the filters and payloads so the tests can assert on
 * what was actually asked of the database, not just on the return value.
 */
function makeSupabase(tables = {}, { failOn = null } = {}) {
  const captured = { updated: null, inserted: null, deleted: false, or: null, filters: {} };

  function chain(table) {
    const rows = tables[table] ?? [];
    let mode = 'select';
    let payload = null;

    const api = {
      select: () => api,
      insert(values) { mode = 'insert'; payload = values; captured.inserted = values; return api; },
      update(values) { mode = 'update'; payload = values; captured.updated = values; return api; },
      delete() { mode = 'delete'; captured.deleted = true; return api; },
      eq(column, value) { captured.filters[`${table}.${column}`] = value; return api; },
      is(column) { captured.filters[`${table}.${column}`] = null; return api; },
      or(expr) { captured.or = expr; return api; },
      in: () => api,
      order: () => api,
      limit: () => api,
      result() {
        if (failOn === table) return { data: null, error: { message: 'boom' } };
        if (mode === 'insert') return { data: { id: 'new-note', ...payload }, error: null };
        if (mode === 'update') return { data: { ...rows[0], ...payload }, error: null };
        if (mode === 'delete') return { data: null, error: null };
        return { data: rows, error: null };
      },
      single() { return Promise.resolve(api.result()); },
      maybeSingle() {
        const res = api.result();
        return Promise.resolve({
          data: Array.isArray(res.data) ? res.data[0] ?? null : res.data,
          error: res.error,
        });
      },
      then(resolve, reject) { return Promise.resolve(api.result()).then(resolve, reject); },
    };
    return api;
  }

  return { from: (table) => chain(table), captured };
}

const USER = 'user-1';
const NOTE = {
  id: 'note-1',
  user_id: USER,
  content: 'Something worth remembering',
  project_id: 'proj-1',
  lifecycle_move_id: 'move-1',
};

describe('countParents', () => {
  it('counts only the parents that are set', () => {
    expect(countParents({ project_id: 'p' })).toBe(1);
    expect(countParents({ project_id: 'p', customer_id: 'c' })).toBe(2);
    expect(countParents({})).toBe(0);
  });

  it('ignores contact_id, which is who it came from, not where it lives', () => {
    expect(countParents({ customer_id: 'c', contact_id: 'x' })).toBe(1);
  });
});

describe('validateNotePayload', () => {
  it('requires content', () => {
    expect(validateNotePayload({ content: '   ' }).errors.content).toBeTruthy();
  });

  it('accepts a pasted email at the new limit', () => {
    // The old cap was 1000, which could not hold an email thread. That was the
    // whole reason notes were unusable for customer correspondence.
    const long = 'x'.repeat(VALIDATION.NOTE_MAX);
    expect(validateNotePayload({ content: long }).isValid).toBe(true);
    expect(validateNotePayload({ content: `${long}x` }).errors.content).toBeTruthy();
  });

  it('rejects more than one parent', () => {
    const result = validateNotePayload({ content: 'x', project_id: 'p', customer_id: 'c' });
    expect(result.errors.parent).toBeTruthy();
  });

  it('accepts no parent at all, which is what makes an unfiled note legal', () => {
    expect(validateNotePayload({ content: 'orphan' }).isValid).toBe(true);
  });

  it('accepts every real source and rejects invented ones', () => {
    NOTE_SOURCES.forEach((source) => {
      expect(validateNotePayload({ content: 'x', source }).isValid).toBe(true);
    });
    expect(validateNotePayload({ content: 'x', source: 'telepathy' }).errors.source).toBeTruthy();
  });

  it('rejects an unparseable occurred_at', () => {
    expect(validateNotePayload({ content: 'x', occurred_at: 'not a date' }).errors.occurred_at)
      .toBeTruthy();
  });

  it('does not demand content on an update that changes only the date', () => {
    expect(validateNotePayload({ occurred_at: '2026-08-18T12:00:00Z' }, true).isValid).toBe(true);
  });

  it('still checks content on an update that changes it', () => {
    expect(validateNotePayload({ content: '' }, true).errors.content).toBeTruthy();
  });
});

describe('listNotes', () => {
  it('widens a project query to notes that project handed to a customer', async () => {
    // A closed project moved its notes onto the customer. Without this, its page
    // shows an empty list, which looks exactly like data loss.
    const supabase = makeSupabase({ notes: [NOTE] });
    await listNotes({ supabase, userId: USER, projectId: 'proj-1' });

    expect(supabase.captured.or).toContain('project_id.eq.proj-1');
    expect(supabase.captured.or).toContain('origin_project_id.eq.proj-1');
  });

  it('can be told not to widen', async () => {
    const supabase = makeSupabase({ notes: [NOTE] });
    await listNotes({ supabase, userId: USER, projectId: 'proj-1', includeOrigin: false });

    expect(supabase.captured.or).toBeNull();
    expect(supabase.captured.filters['notes.project_id']).toBe('proj-1');
  });

  it('scopes to the user on every query', async () => {
    const supabase = makeSupabase({ notes: [] });
    await listNotes({ supabase, userId: USER, customerId: 'cust-1' });
    expect(supabase.captured.filters['notes.user_id']).toBe(USER);
  });
});

describe('getNote', () => {
  it('refuses another user, because the service-role client bypasses RLS', async () => {
    const supabase = makeSupabase({ notes: [NOTE] });
    const { error } = await getNote({ supabase, userId: 'someone-else', noteId: 'note-1' });
    expect(error.status).toBe(403);
  });

  it('404s a missing note', async () => {
    const supabase = makeSupabase({ notes: [] });
    const { error } = await getNote({ supabase, userId: USER, noteId: 'nope' });
    expect(error.status).toBe(404);
  });
});

describe('createNote', () => {
  it('stamps the caller as owner rather than trusting the payload', async () => {
    const supabase = makeSupabase({ notes: [], customers: [{ user_id: USER }] });
    await createNote({
      supabase,
      userId: USER,
      payload: { content: 'hello', customer_id: 'cust-1', user_id: 'someone-else' },
    });

    expect(supabase.captured.inserted.user_id).toBe(USER);
  });

  it('refuses a parent owned by someone else', async () => {
    const supabase = makeSupabase({ notes: [], projects: [{ user_id: 'someone-else' }] });
    const { error } = await createNote({
      supabase,
      userId: USER,
      payload: { content: 'hello', project_id: 'proj-1' },
    });

    expect(error.status).toBe(403);
  });

  it('404s a parent that does not exist', async () => {
    const supabase = makeSupabase({ notes: [], projects: [] });
    const { error } = await createNote({
      supabase,
      userId: USER,
      payload: { content: 'hello', project_id: 'ghost' },
    });

    expect(error.status).toBe(404);
  });

  it('ignores fields a client must not set', async () => {
    // lifecycle_move_id in particular: a client that could set it could make a
    // note it wrote look like one the close cascade moved, and reopening the
    // project would then drag it away.
    const supabase = makeSupabase({ notes: [] });
    await createNote({
      supabase,
      userId: USER,
      payload: { content: 'hello', lifecycle_move_id: 'forged', context_label: 'forged' },
    });

    expect(supabase.captured.inserted.lifecycle_move_id).toBeUndefined();
    expect(supabase.captured.inserted.context_label).toBeUndefined();
  });

  it('trims the content', async () => {
    const supabase = makeSupabase({ notes: [] });
    await createNote({ supabase, userId: USER, payload: { content: '  padded  ' } });
    expect(supabase.captured.inserted.content).toBe('padded');
  });
});

describe('updateNote', () => {
  it('clears the lifecycle marker, so reopen leaves an edited note alone', async () => {
    // This is the rule that makes reopen correct. A note the close moved and you
    // then edited is yours, not the cascade's.
    const supabase = makeSupabase({ notes: [NOTE] });
    await updateNote({
      supabase,
      userId: USER,
      noteId: 'note-1',
      payload: { content: 'edited' },
    });

    expect(supabase.captured.updated.lifecycle_move_id).toBeNull();
    expect(supabase.captured.updated.lifecycle_moved_at).toBeNull();
  });

  it('refuses to move a note between parents', async () => {
    // Re-parenting goes through refileNote, which is deliberate. Allowing it
    // here would let an edit silently break the single-parent rule.
    const supabase = makeSupabase({ notes: [NOTE] });
    const { error } = await updateNote({
      supabase,
      userId: USER,
      noteId: 'note-1',
      payload: { project_id: 'other', customer_id: 'cust-9' },
    });

    expect(error.status).toBe(400);
    expect(supabase.captured.updated).toBeNull();
  });

  it('refuses another user before writing anything', async () => {
    const supabase = makeSupabase({ notes: [NOTE] });
    const { error } = await updateNote({
      supabase,
      userId: 'someone-else',
      noteId: 'note-1',
      payload: { content: 'hijacked' },
    });

    expect(error.status).toBe(403);
    expect(supabase.captured.updated).toBeNull();
  });

  it('validates the new content', async () => {
    const supabase = makeSupabase({ notes: [NOTE] });
    const { error } = await updateNote({
      supabase,
      userId: USER,
      noteId: 'note-1',
      payload: { content: '   ' },
    });

    expect(error.status).toBe(400);
  });
});

describe('deleteNote', () => {
  it('checks ownership before deleting', async () => {
    const supabase = makeSupabase({ notes: [NOTE] });
    const { error } = await deleteNote({ supabase, userId: 'someone-else', noteId: 'note-1' });

    expect(error.status).toBe(403);
    expect(supabase.captured.deleted).toBe(false);
  });
});

describe('refileNote', () => {
  it('clears every other parent and the lifecycle marker', async () => {
    // A deliberate placement. Nothing should move it again, which is why the
    // marker goes with it.
    const supabase = makeSupabase({ notes: [NOTE], customers: [{ user_id: USER }] });
    await refileNote({ supabase, userId: USER, noteId: 'note-1', customerId: 'cust-1' });

    expect(supabase.captured.updated).toMatchObject({
      customer_id: 'cust-1',
      project_id: null,
      task_id: null,
      idea_id: null,
      origin_project_id: null,
      lifecycle_move_id: null,
      context_label: null,
    });
  });

  it('refuses a customer owned by someone else', async () => {
    const supabase = makeSupabase({ notes: [NOTE], customers: [{ user_id: 'someone-else' }] });
    const { error } = await refileNote({
      supabase,
      userId: USER,
      noteId: 'note-1',
      customerId: 'cust-1',
    });

    expect(error.status).toBe(403);
  });
});
