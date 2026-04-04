import { validateIdea } from '@/lib/validators';
import { handleSupabaseError } from '@/lib/errorHandler';

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

  const filtered = filterIdeaUpdates(updates);
  if (Object.keys(filtered).length === 0) {
    return { error: { status: 400, message: 'No valid fields to update' } };
  }

  if (filtered.area !== undefined) {
    filtered.area = normalizeArea(filtered.area);
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
  const { data: idea, error: fetchError } = await supabase
    .from('ideas')
    .select('*')
    .eq('id', ideaId)
    .eq('user_id', userId)
    .single();

  if (fetchError || !idea) {
    return { error: { status: 404, message: 'Idea not found or unauthorized' } };
  }

  if (idea.idea_state === 'promoted') {
    return { error: { status: 409, message: 'Already promoted' } };
  }

  // Build task description from idea fields
  const description = [idea.why_it_matters, idea.smallest_step, idea.notes]
    .filter(Boolean).join('\n\n');

  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .insert({
      user_id: userId,
      name: idea.title,
      description: description || null,
      state: 'backlog',
      area: idea.area,
      source_idea_id: idea.id,
      sort_order: 0,
      entered_state_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (taskError) {
    const errorMessage = handleSupabaseError(taskError, 'create');
    return { error: { status: 500, message: errorMessage } };
  }

  // Mark idea as promoted (canonical link is tasks.source_idea_id)
  const { error: updateError } = await supabase
    .from('ideas')
    .update({ idea_state: 'promoted', updated_at: new Date().toISOString() })
    .eq('id', ideaId)
    .eq('user_id', userId);

  if (updateError) {
    const errorMessage = handleSupabaseError(updateError, 'update');
    return { error: { status: 500, message: errorMessage } };
  }

  return { data: task };
}
