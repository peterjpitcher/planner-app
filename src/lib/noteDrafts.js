/*
 * Unsaved note drafts, kept in this browser so closing the tab mid-call does
 * not lose them.
 *
 * One draft per place a note is written (a project, a customer, a task), in
 * localStorage, which survives the tab closing. Peter approved keeping note
 * text on the device on 17 Sep 2026; it is removed when the note is saved or
 * discarded, and every draft is wiped on sign-out. The journal keeps its draft
 * the same way.
 *
 * Every call tolerates storage being unavailable (private browsing, a full
 * quota): reads return null, writes report false so the panel can say the
 * draft is not being kept.
 */

const PREFIX = 'planner.noteDraft.v1:';

/** The storage key for the composer on a project, task or customer, or null. */
export function noteDraftKey({ projectId = null, taskId = null, customerId = null } = {}) {
  if (projectId) return `${PREFIX}project:${projectId}`;
  if (taskId) return `${PREFIX}task:${taskId}`;
  if (customerId) return `${PREFIX}customer:${customerId}`;
  return null;
}

function storage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The saved draft for a key, as { text, savedAt }, or null. */
export function readNoteDraft(key) {
  const store = storage();
  if (!key || !store) return null;
  try {
    const parsed = JSON.parse(store.getItem(key));
    if (!parsed || typeof parsed.text !== 'string' || !parsed.text.trim()) return null;
    return { text: parsed.text, savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : null };
  } catch {
    return null;
  }
}

/** Keep a draft. Returns false when the browser would not store it. */
export function writeNoteDraft(key, text, now = new Date()) {
  const store = storage();
  if (!key || !store) return false;
  try {
    store.setItem(key, JSON.stringify({ text, savedAt: now.toISOString() }));
    return true;
  } catch {
    return false;
  }
}

export function removeNoteDraft(key) {
  const store = storage();
  if (!key || !store) return;
  try {
    store.removeItem(key);
  } catch {
    // Nothing to do: a draft that cannot be removed cannot be read either.
  }
}

/** Remove every note draft in this browser. Called on sign-out. */
export function clearAllNoteDrafts() {
  const store = storage();
  if (!store) return;
  try {
    const keys = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    keys.forEach((key) => store.removeItem(key));
  } catch {
    // As above.
  }
}
