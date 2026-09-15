import { validateEmailFollowUp } from '@/lib/validators';
import { handleSupabaseError } from '@/lib/errorHandler';
import { getLondonDateKey } from '@/lib/timezone';
import { addDaysToDateKey } from '@/lib/dateUtils';
import { FOLLOWUP_STATE, FOLLOWUP_DRAFT_STATUS, FOLLOWUP_CHASE_MIN_DAYS } from '@/lib/constants';

// Fields Peter owns through the UI. The sync must never touch feedback or
// urgent, so a scan can't wipe a note he has just typed.
const USER_UPDATE_FIELDS = new Set([
  'draft_status', 'feedback', 'urgent', 'proposed_draft',
  'next_chase_date', 'state', 'needs', 'customer_id',
]);

// Fields the inbox worker owns through the ingest path. Everything about the
// thread and the machine-proposed draft, but not Peter's feedback or urgent
// flag.
const SYNC_UPDATE_FIELDS = new Set([
  'mailbox', 'conversation_id', 'message_id', 'counterpart_name',
  'counterpart_email', 'subject', 'needs', 'state', 'last_message_at',
  'last_message_from', 'proposed_draft', 'draft_status', 'next_chase_date',
  'chase_count', 'sent_at', 'customer_id',
]);

function pick(source = {}, allowed) {
  const out = {};
  Object.entries(source).forEach(([key, value]) => {
    if (allowed.has(key)) out[key] = value;
  });
  return out;
}

function normaliseText(value) {
  if (value === undefined || value === null) return value;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

export async function listEmailFollowUps({ supabase, userId, filters = {} }) {
  let query = supabase
    .from('email_follow_ups')
    .select('*')
    .eq('user_id', userId);

  if (filters.state) {
    query = query.eq('state', filters.state);
  } else if (!filters.includeClosed) {
    // The dashboard is a live worklist: closed threads drop out by default.
    query = query.neq('state', 'closed');
  }

  if (filters.mailbox) {
    query = query.eq('mailbox', filters.mailbox);
  }
  if (filters.draft_status) {
    query = query.eq('draft_status', filters.draft_status);
  }

  // Urgent first, then the oldest next-chase (nulls last so awaiting_me rows
  // without a chase date do not jump the queue), then most recent activity.
  query = query
    .order('urgent', { ascending: false })
    .order('next_chase_date', { ascending: true, nullsFirst: false })
    .order('last_message_at', { ascending: false, nullsFirst: false });

  const { data, error } = await query;
  if (error) {
    return { error: { status: 500, message: handleSupabaseError(error, 'fetch') } };
  }
  return { data };
}

export async function getEmailFollowUp({ supabase, userId, id }) {
  const { data, error } = await supabase
    .from('email_follow_ups')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return { error: { status: 404, message: 'Follow-up not found' } };
  }
  return { data };
}

// Rows created awaiting a reply from the other side get a default chase date of
// today + 3 days (the standing "never chase in under 3 days" rule) unless the
// caller set one. Computed on a London date key via addDaysToDateKey, which
// uses UTC noon so a DST boundary can never shift it by a day.
function defaultChaseDate(state, provided) {
  if (provided) return provided;
  if (state === FOLLOWUP_STATE.AWAITING_THEM) {
    return addDaysToDateKey(getLondonDateKey(), FOLLOWUP_CHASE_MIN_DAYS);
  }
  return null;
}

export async function createEmailFollowUp({ supabase, userId, payload = {} }) {
  const candidate = {
    mailbox: payload.mailbox || 'orangejelly',
    conversation_id: normaliseText(payload.conversation_id) ?? null,
    message_id: normaliseText(payload.message_id) ?? null,
    counterpart_name: normaliseText(payload.counterpart_name) ?? null,
    counterpart_email: normaliseText(payload.counterpart_email) ?? null,
    subject: normaliseText(payload.subject) ?? null,
    needs: normaliseText(payload.needs) ?? null,
    state: payload.state || FOLLOWUP_STATE.AWAITING_ME,
    last_message_at: payload.last_message_at || null,
    last_message_from: payload.last_message_from || null,
    proposed_draft: payload.proposed_draft ?? null,
    draft_status: payload.draft_status || 'none',
    urgent: payload.urgent === true,
    next_chase_date: null,
    customer_id: payload.customer_id || null,
  };
  candidate.next_chase_date = defaultChaseDate(candidate.state, payload.next_chase_date);

  const { isValid, errors } = validateEmailFollowUp(candidate);
  if (!isValid) {
    return { error: { status: 400, message: 'Validation failed', details: errors } };
  }

  const { data, error } = await supabase
    .from('email_follow_ups')
    .insert({ user_id: userId, ...candidate })
    .select()
    .single();

  if (error) {
    return { error: { status: 500, message: handleSupabaseError(error, 'create') } };
  }
  return { data };
}

async function applyUpdate({ supabase, userId, id, updates, allowed }) {
  const { data: existing, error: fetchError } = await supabase
    .from('email_follow_ups')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (fetchError || !existing) {
    return { error: { status: 404, message: 'Follow-up not found' } };
  }

  const filtered = pick(updates, allowed);
  ['subject', 'needs', 'counterpart_name', 'counterpart_email', 'conversation_id', 'message_id']
    .forEach((key) => {
      if (filtered[key] !== undefined) filtered[key] = normaliseText(filtered[key]);
    });

  if (Object.keys(filtered).length === 0) {
    return { error: { status: 400, message: 'No valid fields to update' } };
  }

  const validation = validateEmailFollowUp({ ...existing, ...filtered });
  if (!validation.isValid) {
    return { error: { status: 400, message: 'Validation failed', details: validation.errors } };
  }

  const { data, error } = await supabase
    .from('email_follow_ups')
    .update(filtered)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    return { error: { status: 500, message: handleSupabaseError(error, 'update') } };
  }
  return { data };
}

// Peter's edits from the UI: draft_status, feedback, urgent and the like.
export async function updateEmailFollowUp({ supabase, userId, id, updates = {} }) {
  return applyUpdate({ supabase, userId, id, updates, allowed: USER_UPDATE_FIELDS });
}

// The inbox worker's sync. Upserts on (user_id, conversation_id): updates the
// thread-owned fields on an existing row, or inserts a new one. Only ever
// touches SYNC_UPDATE_FIELDS, so Peter's feedback and urgent flag survive a
// re-scan untouched.
export async function upsertFollowUpByConversation({ supabase, userId, payload = {} }) {
  const conversationId = normaliseText(payload.conversation_id);

  if (conversationId) {
    const { data: existing, error: findError } = await supabase
      .from('email_follow_ups')
      .select('id')
      .eq('user_id', userId)
      .eq('conversation_id', conversationId)
      .maybeSingle();

    if (findError) {
      return { error: { status: 500, message: handleSupabaseError(findError, 'fetch') } };
    }

    if (existing) {
      const result = await applyUpdate({
        supabase, userId, id: existing.id, updates: payload, allowed: SYNC_UPDATE_FIELDS,
      });
      if (result.error) return result;
      return { data: result.data, created: false };
    }
  }

  const result = await createEmailFollowUp({ supabase, userId, payload });
  if (result.error) return result;
  return { data: result.data, created: true };
}

export async function deleteEmailFollowUp({ supabase, userId, id }) {
  const { data: existing, error: fetchError } = await supabase
    .from('email_follow_ups')
    .select('id')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (fetchError || !existing) {
    return { error: { status: 404, message: 'Follow-up not found' } };
  }

  const { error } = await supabase
    .from('email_follow_ups')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    return { error: { status: 500, message: handleSupabaseError(error, 'delete') } };
  }
  return { data: { success: true } };
}

// The inbox worker's own update path: it may write the thread-owned fields
// (state, sent_at, the draft, chase_count) by row id, but never feedback or
// urgent. Used by the machine bridge to mark a draft sent or advance a chase.
export async function syncUpdateEmailFollowUp({ supabase, userId, id, updates = {} }) {
  return applyUpdate({ supabase, userId, id, updates, allowed: SYNC_UPDATE_FIELDS });
}

// The worklist the inbox worker pulls each run:
//  - drafts Peter approved, to send;
//  - redraft requests, to rewrite from his feedback;
//  - awaiting_them threads whose chase date has arrived with no draft in flight.
// The dataset is one person's live correspondence, so filtering in JS is both
// simple and correct; there is no volume argument for a bespoke SQL predicate.
export async function listPendingForWorker({ supabase, userId, today }) {
  const { data, error } = await listEmailFollowUps({ supabase, userId, filters: {} });
  if (error) return { error };

  const pending = (data || []).filter((row) => {
    if (row.draft_status === FOLLOWUP_DRAFT_STATUS.APPROVED) return true;
    if (row.draft_status === FOLLOWUP_DRAFT_STATUS.EDIT_REQUESTED) return true;
    if (
      row.state === FOLLOWUP_STATE.AWAITING_THEM &&
      row.next_chase_date && today && row.next_chase_date <= today &&
      (row.draft_status === FOLLOWUP_DRAFT_STATUS.NONE || row.draft_status === FOLLOWUP_DRAFT_STATUS.SENT)
    ) return true;
    return false;
  });

  return { data: pending };
}
