/**
 * Helpers for reading the /api/planning-candidates payload.
 *
 * The payload is a map of bucket name -> task array with one non-array member
 * (`reviewBacklogTotal`, a plain count). Every reader has to know that, so the
 * shape knowledge lives here once instead of being re-derived inline at each
 * call site.
 */

/**
 * The task arrays in a candidates payload, ignoring any scalar members.
 * @param {Object|null} candidates
 * @returns {Array<Array<Object>>}
 */
function candidateBuckets(candidates) {
  if (!candidates || typeof candidates !== 'object') return [];
  return Object.values(candidates).filter(Array.isArray);
}

/**
 * Count distinct tasks across every bucket.
 *
 * De-duplicated by id: the buckets are built to be mutually exclusive, but a
 * query change that broke that would otherwise silently inflate the count shown
 * to the user.
 *
 * @param {Object|null} candidates
 * @returns {number}
 */
export function countCandidates(candidates) {
  const ids = new Set();
  let unidentified = 0;
  for (const bucket of candidateBuckets(candidates)) {
    for (const task of bucket) {
      if (!task) continue;
      if (task.id) ids.add(task.id);
      else unidentified += 1;
    }
  }
  return ids.size + unidentified;
}

/**
 * True when there is at least one task awaiting a planning decision.
 * @param {Object|null} candidates
 * @returns {boolean}
 */
export function hasCandidates(candidates) {
  return countCandidates(candidates) > 0;
}

/**
 * Count candidates captured AFTER a planning session completed, i.e. genuinely
 * new work the existing plan has never seen.
 *
 * This is deliberately derived from durable data (the session's `completed_at`
 * and each task's `created_at`) rather than from a client-side count taken at
 * planning time. A count held in memory resets on every reload and is unknown
 * on a second device, which made an already-planned day look like it had a pile
 * of unplanned work and prompted the user to plan it again.
 *
 * Note it counts newly *captured* tasks only. A task moved back into the
 * candidate pool by hand is not new work, and re-flagging it would reintroduce
 * the same nagging.
 *
 * @param {Object|null} candidates
 * @param {string|null|undefined} completedAt - ISO timestamp the plan was made
 * @returns {number}
 */
export function countNewCandidates(candidates, completedAt) {
  if (!completedAt) return 0;
  const since = new Date(completedAt).getTime();
  if (Number.isNaN(since)) return 0;

  const ids = new Set();
  let unidentified = 0;
  for (const bucket of candidateBuckets(candidates)) {
    for (const task of bucket) {
      if (!task?.created_at) continue;
      const createdAt = new Date(task.created_at).getTime();
      if (Number.isNaN(createdAt) || createdAt <= since) continue;
      if (task.id) ids.add(task.id);
      else unidentified += 1;
    }
  }
  return ids.size + unidentified;
}
