import { validateIdea } from '@/lib/validators';
import { handleSupabaseError } from '@/lib/errorHandler';
import { getLondonDateKey } from '@/lib/timezone';
import { callRpc } from '@/lib/rpc';

const IDEA_UPDATE_FIELDS = new Set([
  'title', 'notes', 'area', 'idea_state',
  'why_it_matters', 'smallest_step', 'review_date', 'updated_at',
]);

function filterIdeaUpdates(updates = {}) {
  const filtered = {};
  Object.entries(updates).forEach(([key, value]) => {
    if (IDEA_UPDATE_FIELDS.has(key)) {
      filtered[key] = value;
    }
  });
  return filtered;
}

function normalizeArea(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function listIdeas({ supabase, userId, filters = {} }) {
  let query = supabase
    .from('ideas')
    .select('*')
    .eq('user_id', userId)
    .neq('idea_state', 'promoted')
    .order('created_at', { ascending: false });

  if (filters.idea_state) {
    query = query.eq('idea_state', filters.idea_state);
  }

  const { data, error } = await query;
  if (error) {
    const errorMessage = handleSupabaseError(error, 'fetch');
    return { error: { status: 500, message: errorMessage } };
  }
  return { data };
}

// F4: ideas due for review — "Ready Later" ideas whose review_date has arrived.
// Without this the vault is a black hole: a review_date is set but never
// resurfaced. Surfaced at the top of the vault (and in the A4 digest) so the
// idea returns for a decision. "Today" is the London date key, never a raw UTC
// Date, so the comparison flips at midnight London time.
export async function listIdeasDueForReview({ supabase, userId }) {
  const today = getLondonDateKey();

  const { data, error } = await supabase
    .from('ideas')
    .select('*')
    .eq('user_id', userId)
    .eq('idea_state', 'ready_later')
    .not('review_date', 'is', null)
    .lte('review_date', today)
    .order('review_date', { ascending: true });

  if (error) {
    const errorMessage = handleSupabaseError(error, 'fetch');
    return { error: { status: 500, message: errorMessage } };
  }
  return { data };
}

export async function createIdea({ supabase, userId, payload }) {
  const { isValid, errors } = validateIdea(payload);
  if (!isValid) {
    return { error: { status: 400, details: errors } };
  }

  const { data, error } = await supabase
    .from('ideas')
    .insert({
      user_id: userId,
      title: payload.title.trim(),
      notes: payload.notes || null,
      area: normalizeArea(payload.area),
      idea_state: 'captured',
      why_it_matters: payload.why_it_matters || null,
      smallest_step: payload.smallest_step || null,
      review_date: payload.review_date || null,
    })
    .select()
    .single();

  if (error) {
    const errorMessage = handleSupabaseError(error, 'create');
    return { error: { status: 500, message: errorMessage } };
  }
  return { data };
}

export async function updateIdea({ supabase, userId, ideaId, updates }) {
  const { data: existing, error: fetchError } = await supabase
    .from('ideas')
    .select('*')
    .eq('id', ideaId)
    .eq('user_id', userId)
    .single();

  if (fetchError || !existing) {
    return { error: { status: 404, message: 'Idea not found' } };
  }

  if (existing.user_id !== userId) {
    return { error: { status: 403, message: 'Forbidden' } };
  }

  const filtered = filterIdeaUpdates(updates);
  if (Object.keys(filtered).length === 0) {
    return { error: { status: 400, message: 'No valid fields to update' } };
  }

  if (filtered.area !== undefined) {
    filtered.area = normalizeArea(filtered.area);
  }

  // FF-028: promotion must go through promoteIdea so a task is created and the
  // state flip is guarded. Reject a direct PATCH that tries to mark a not-yet-
  // promoted idea as 'promoted' — otherwise it silently disappears from the
  // vault (listIdeas excludes promoted) with no task ever created.
  if (
    Object.prototype.hasOwnProperty.call(filtered, 'idea_state') &&
    filtered.idea_state === 'promoted' &&
    existing.idea_state !== 'promoted'
  ) {
    return { error: { status: 400, message: 'Ideas must be promoted via the promote action, not a direct update' } };
  }

  // FF-028: validate the merged row before writing (same pattern as
  // taskService.updateTask) so invalid values return a 400 with field details
  // instead of a generic 500 from a DB CHECK constraint.
  const candidate = { ...existing, ...filtered };
  const validation = validateIdea(candidate);
  if (!validation.isValid) {
    return { error: { status: 400, message: 'Validation failed', details: validation.errors } };
  }

  filtered.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('ideas')
    .update(filtered)
    .eq('id', ideaId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    const errorMessage = handleSupabaseError(error, 'update');
    return { error: { status: 500, message: errorMessage } };
  }
  return { data };
}

export async function deleteIdea({ supabase, userId, ideaId }) {
  const { data: existing, error: fetchError } = await supabase
    .from('ideas')
    .select('id, user_id')
    .eq('id', ideaId)
    .eq('user_id', userId)
    .single();

  if (fetchError || !existing) {
    return { error: { status: 404, message: 'Idea not found' } };
  }

  if (existing.user_id !== userId) {
    return { error: { status: 403, message: 'Forbidden' } };
  }

  const { error } = await supabase
    .from('ideas')
    .delete()
    .eq('id', ideaId)
    .eq('user_id', userId);

  if (error) {
    const errorMessage = handleSupabaseError(error, 'delete');
    return { error: { status: 500, message: errorMessage } };
  }
  return { data: { success: true } };
}

export async function promoteIdea({ supabase, userId, ideaId }) {
  // The idea lock, task insert and state change share one transaction.
  const { data, error } = await callRpc(supabase, 'promote_idea', {
    p_user_id: userId,
    p_idea_id: ideaId,
  });
  if (error) return { error };
  return { data };
}
