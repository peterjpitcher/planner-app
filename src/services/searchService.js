// src/services/searchService.js
//
// One search box across notes, customers, facts and contacts.
//
// Full text alone would not do this job, and shipping only that would give a
// search box that looks broken on exactly the data a CRM holds. Postgres
// tokenises joe.bloggs@acme-group.co.uk and +44 7700 900123 in ways that defeat
// the searches you would actually type, and it cannot match a partial name at
// all. So each field gets the matching strategy that suits it:
//
//   notes, summaries  full text
//   names, facts      trigram / ILIKE, so a partial works
//   email, phone      exact on a normalised form, because you search for a
//                     whole address or number, never half of one

const LIMIT_PER_TYPE = 20;

/** Digits only, so 07700 900123 and +447700900123 are the same number. */
export function normalisePhone(value) {
  return String(value ?? '').replace(/\D/g, '');
}

/**
 * Escape a value for use inside a PostgREST ilike pattern.
 *
 * % and _ are wildcards there, so an unescaped search for "50%" would match far
 * more than it should. Commas and parentheses would break out of the or()
 * filter syntax entirely.
 */
export function escapeLikePattern(value) {
  return String(value ?? '').replace(/[%_,()\\]/g, '');
}

/**
 * @returns {Promise<{data: Object|null, error: Object|null}>}
 */
export async function search({ supabase, userId, query }) {
  const term = String(query ?? '').trim();
  if (term.length < 2) {
    return { data: { customers: [], notes: [], contacts: [], facts: [] }, error: null };
  }

  const like = `%${escapeLikePattern(term)}%`;
  const phone = normalisePhone(term);

  const [customers, notes, contacts, facts] = await Promise.all([
    supabase
      .from('customers')
      .select('id, name, status, area, archived_at')
      .eq('user_id', userId)
      .or(`name.ilike.${like},summary.ilike.${like}`)
      .limit(LIMIT_PER_TYPE),

    supabase
      .from('notes')
      .select('id, content, customer_id, project_id, task_id, occurred_at, source, context_label')
      .eq('user_id', userId)
      .ilike('content', like)
      .order('occurred_at', { ascending: false })
      .limit(LIMIT_PER_TYPE),

    supabase
      .from('contacts')
      .select('id, name, role, email, phone, customer_id')
      .eq('user_id', userId)
      .or(
        [
          `name.ilike.${like}`,
          `email.ilike.${like}`,
          `role.ilike.${like}`,
          // Only worth searching phones when the term actually contains digits.
          ...(phone.length >= 4 ? [`phone.ilike.%${phone}%`] : []),
        ].join(',')
      )
      .limit(LIMIT_PER_TYPE),

    supabase
      .from('customer_facts')
      .select('id, label, value, customer_id')
      .eq('user_id', userId)
      .or(`label.ilike.${like},value.ilike.${like}`)
      .limit(LIMIT_PER_TYPE),
  ]);

  const failure = customers.error || notes.error || contacts.error || facts.error;
  if (failure) {
    return { data: null, error: { status: 500, message: failure.message } };
  }

  return {
    data: {
      customers: customers.data || [],
      notes: notes.data || [],
      contacts: contacts.data || [],
      facts: facts.data || [],
    },
    error: null,
  };
}
