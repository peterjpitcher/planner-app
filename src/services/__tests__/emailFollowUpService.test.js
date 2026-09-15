import { describe, it, expect } from 'vitest';
import {
  createEmailFollowUp,
  updateEmailFollowUp,
  upsertFollowUpByConversation,
  listEmailFollowUps,
} from '../emailFollowUpService';
import { FOLLOWUP_STATE, FOLLOWUP_DRAFT_STATUS } from '@/lib/constants';

/**
 * Supabase query-builder stub, same shape as customerService.test.js.
 *
 * `.single()` on a select returns the first row (or a not-found error when the
 * table is empty), `.maybeSingle()` returns the first row or null, and a bare
 * await resolves to the whole array. `captured` records the last insert/update
 * payload so a test can assert what was written, not only what came back.
 */
function makeSupabase(tables = {}) {
  const captured = { inserted: null, updated: null, deleted: false };

  function chain(table) {
    const rows = tables[table] ?? [];
    let mode = 'select';
    let payload = null;

    const api = {
      select() { return api; },
      insert(values) { mode = 'insert'; payload = values; captured.inserted = values; return api; },
      update(values) { mode = 'update'; payload = values; captured.updated = values; return api; },
      delete() { mode = 'delete'; captured.deleted = true; return api; },
      eq() { return api; },
      neq() { return api; },
      order() { return api; },
      result() {
        if (mode === 'insert') return { data: { id: 'new-id', ...payload }, error: null };
        if (mode === 'update') return { data: { ...rows[0], ...payload }, error: null };
        if (mode === 'delete') return { data: null, error: null };
        return { data: rows, error: null };
      },
      single() {
        const res = api.result();
        if (Array.isArray(res.data)) {
          const first = res.data[0] ?? null;
          return Promise.resolve({
            data: first,
            error: first ? null : { code: 'PGRST116', message: 'no rows' },
          });
        }
        return Promise.resolve(res);
      },
      maybeSingle() {
        const res = api.result();
        return Promise.resolve({
          data: Array.isArray(res.data) ? res.data[0] ?? null : res.data,
          error: res.error,
        });
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

const ROW = {
  id: 'fu-1',
  user_id: USER,
  mailbox: 'orangejelly',
  conversation_id: 'conv-1',
  subject: 'Quote for the summer campaign',
  counterpart_name: 'Sam Rivers',
  counterpart_email: 'sam@example.com',
  state: FOLLOWUP_STATE.AWAITING_ME,
  draft_status: FOLLOWUP_DRAFT_STATUS.READY,
  proposed_draft: 'Draft body',
  feedback: null,
  urgent: false,
  next_chase_date: null,
  chase_count: 0,
};

describe('createEmailFollowUp', () => {
  it('rejects an invalid mailbox with a 400 and field details', async () => {
    const supabase = makeSupabase();
    const { data, error } = await createEmailFollowUp({
      supabase,
      userId: USER,
      payload: { mailbox: 'gmail', subject: 'Hi' },
    });

    expect(data).toBeUndefined();
    expect(error.status).toBe(400);
    expect(error.details.mailbox).toBeTruthy();
  });

  it('gives an awaiting_them row a default chase date but leaves awaiting_me clear', async () => {
    const supabase = makeSupabase();

    const them = await createEmailFollowUp({
      supabase, userId: USER,
      payload: { subject: 'Chase', state: FOLLOWUP_STATE.AWAITING_THEM },
    });
    expect(them.data.next_chase_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const me = await createEmailFollowUp({
      supabase, userId: USER,
      payload: { subject: 'Reply', state: FOLLOWUP_STATE.AWAITING_ME },
    });
    expect(me.data.next_chase_date).toBeNull();
  });
});

describe('updateEmailFollowUp', () => {
  it('writes only Peter-owned fields and ignores machine columns', async () => {
    const supabase = makeSupabase({ email_follow_ups: [ROW] });

    const { data, error } = await updateEmailFollowUp({
      supabase, userId: USER, id: 'fu-1',
      updates: {
        draft_status: FOLLOWUP_DRAFT_STATUS.APPROVED,
        feedback: 'Warmer, please',
        // These must be ignored: they are not Peter-writable through the UI.
        user_id: 'someone-else',
        chase_count: 99,
      },
    });

    expect(error).toBeUndefined();
    expect(supabase.captured.updated.draft_status).toBe(FOLLOWUP_DRAFT_STATUS.APPROVED);
    expect(supabase.captured.updated.feedback).toBe('Warmer, please');
    expect(supabase.captured.updated.user_id).toBeUndefined();
    expect(supabase.captured.updated.chase_count).toBeUndefined();
    expect(data).toBeTruthy();
  });

  it('404s when the row does not belong to the user', async () => {
    const supabase = makeSupabase({ email_follow_ups: [] });
    const { error } = await updateEmailFollowUp({
      supabase, userId: USER, id: 'missing', updates: { urgent: true },
    });
    expect(error.status).toBe(404);
  });
});

describe('upsertFollowUpByConversation', () => {
  it('updates the existing row and never overwrites feedback', async () => {
    const withFeedback = { ...ROW, feedback: 'Peter typed this' };
    const supabase = makeSupabase({ email_follow_ups: [withFeedback] });

    const { created } = await upsertFollowUpByConversation({
      supabase, userId: USER,
      payload: {
        conversation_id: 'conv-1',
        subject: 'Re: Quote for the summer campaign',
        state: FOLLOWUP_STATE.AWAITING_ME,
        // A sync must not carry feedback through, even if asked to.
        feedback: 'sync should not write this',
      },
    });

    expect(created).toBe(false);
    expect(supabase.captured.updated.subject).toBe('Re: Quote for the summer campaign');
    expect(supabase.captured.updated.feedback).toBeUndefined();
  });

  it('inserts a new row when the conversation is unseen', async () => {
    const supabase = makeSupabase({ email_follow_ups: [] });
    const { created, data } = await upsertFollowUpByConversation({
      supabase, userId: USER,
      payload: { conversation_id: 'conv-new', subject: 'New thread', state: FOLLOWUP_STATE.AWAITING_ME },
    });

    expect(created).toBe(true);
    expect(supabase.captured.inserted.conversation_id).toBe('conv-new');
    expect(data.id).toBe('new-id');
  });
});

describe('listEmailFollowUps', () => {
  it('returns the rows for the user', async () => {
    const supabase = makeSupabase({ email_follow_ups: [ROW, { ...ROW, id: 'fu-2' }] });
    const { data, error } = await listEmailFollowUps({ supabase, userId: USER });
    expect(error).toBeUndefined();
    expect(data).toHaveLength(2);
  });
});
