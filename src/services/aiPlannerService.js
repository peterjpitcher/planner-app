import { OpenAI } from 'openai';
import { SOFT_CAPS, TODAY_SECTION } from '@/lib/constants';

// A5 (Wave 8) — AI day-planner service.
//
// draftPlanWithAI asks OpenAI to arrange the day's candidate tasks into the
// three Today sections with a one-line British-English reason each. It is
// ADVISORY and FALLBACK-SAFE: it returns null on ANY problem (no API key, no
// candidates, an API error/timeout, or an unparseable/empty response) so the
// caller always falls back to the deterministic Wave-1 rules. The soft caps are
// enforced IN CODE here — the model's output is never trusted for capacity.
//
// Reuses the journal route's OpenAI client pattern (lazy singleton, OPENAI_API_KEY,
// returns null when unconfigured). No secret and no full task content is ever
// logged at error level.

let openaiClient;

const AI_MODEL = 'gpt-4o';
// Bound the model call so a hung request cannot stall the morning cron; a
// timeout surfaces as an error and we fall back to the rules.
const AI_TIMEOUT_MS = 20000;
const AI_MAX_RETRIES = 1;
// Reasons must be short provenance labels, not paragraphs.
const MAX_REASON_WORDS = 12;
// Bound per-task text sent to the model (defence-in-depth on token cost).
const MAX_NAME_CHARS = 200;
const MAX_NOTES_CHARS = 300;

const VALID_SECTIONS = new Set([
  TODAY_SECTION.MUST_DO,
  TODAY_SECTION.GOOD_TO_DO,
  TODAY_SECTION.QUICK_WINS,
]);

const SYSTEM_PROMPT =
  'You are a concise day-planning assistant. You arrange a person\'s tasks into ' +
  'three buckets for today and give a short reason for each. Write in British ' +
  'English. Respond with strict JSON only — no prose outside the JSON.';

/**
 * Lazy OpenAI client (journal pattern). Returns null when OPENAI_API_KEY is
 * unset so callers can treat "AI unconfigured" the same as "AI failed".
 * @returns {OpenAI|null}
 */
export function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

/**
 * Whole-days between a task's entered_state_at and today (never negative).
 * Used purely as prompt context ("this has been sitting N days").
 */
function daysInState(candidate, todayKey) {
  const enteredKey = candidate?.entered_state_at
    ? String(candidate.entered_state_at).slice(0, 10)
    : null;
  if (!enteredKey || !todayKey) return null;
  const entered = Date.parse(`${enteredKey}T00:00:00Z`);
  const today = Date.parse(`${todayKey}T00:00:00Z`);
  if (Number.isNaN(entered) || Number.isNaN(today)) return null;
  return Math.max(0, Math.round((today - entered) / 86400000));
}

/**
 * Compact, bounded projection of a candidate for the prompt. Sends title +
 * notes + chips + due date + project + age (the user has consented to titles
 * and notes going to OpenAI).
 */
function compactCandidate(candidate, todayKey) {
  const chips = Array.isArray(candidate?.chips)
    ? candidate.chips
    : candidate?.chips
      ? [candidate.chips]
      : [];
  const notes =
    typeof candidate?.description === 'string' ? candidate.description.trim().slice(0, MAX_NOTES_CHARS) : '';
  const project = candidate?.projects?.name || candidate?.project_name || null;
  return {
    id: String(candidate.id),
    name: typeof candidate?.name === 'string' ? candidate.name.slice(0, MAX_NAME_CHARS) : '',
    notes,
    chips,
    due_date: candidate?.due_date ? String(candidate.due_date).slice(0, 10) : null,
    project,
    days_in_state: daysInState(candidate, todayKey),
  };
}

/**
 * Build the user prompt from the candidates and the caps.
 */
function buildPrompt({ candidates, caps, todayKey }) {
  const compact = candidates.map((c) => compactCandidate(c, todayKey));
  const capLine = `must_do: ${caps.MUST_DO ?? SOFT_CAPS.MUST_DO}, good_to_do: ${
    caps.GOOD_TO_DO ?? SOFT_CAPS.GOOD_TO_DO
  }, quick_wins: ${caps.QUICK_WINS ?? SOFT_CAPS.QUICK_WINS}`;

  return [
    `Today is ${todayKey}. Arrange these tasks into today's plan.`,
    '',
    'Sections:',
    '- must_do: due today or overdue, or otherwise the most important to do today.',
    '- good_to_do: worth doing today but not critical.',
    '- quick_wins: small, fast tasks (a few minutes each).',
    '',
    `Do NOT exceed these per-section limits (place fewer if there is less that fits): ${capLine}.`,
    'Only use the taskId values provided. You may leave a task out if it does not belong in today.',
    '',
    'Return JSON of the exact shape:',
    '{ "assignments": [ { "taskId": "<id>", "section": "must_do|good_to_do|quick_wins", "reason": "<= 12 words, British English>" } ] }',
    '',
    'Tasks:',
    JSON.stringify(compact),
  ].join('\n');
}

/**
 * The ONLY function that talks to OpenAI. Isolated so tests can mock the
 * 'openai' module and drive every branch without a network call.
 * @returns {Promise<string|null>} raw JSON string content, or null.
 */
async function requestAssignments({ client, candidates, caps, todayKey }) {
  const completion = await client.chat.completions.create(
    {
      model: AI_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildPrompt({ candidates, caps, todayKey }) },
      ],
    },
    { timeout: AI_TIMEOUT_MS, maxRetries: AI_MAX_RETRIES }
  );
  return completion?.choices?.[0]?.message?.content ?? null;
}

/**
 * Parse the model content into a raw assignments array, or null.
 */
function parseAssignments(content) {
  if (!content || typeof content !== 'string') return null;
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  return Array.isArray(parsed.assignments) ? parsed.assignments : null;
}

/**
 * Trim a reason to a short, single-spaced provenance label (<= 12 words).
 */
function sanitizeReason(reason) {
  if (typeof reason !== 'string') return '';
  const words = reason.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, MAX_REASON_WORDS).join(' ');
}

/**
 * Validate + cap-enforce the raw model assignments in code (the model is never
 * trusted). Keeps the model's order and:
 *   - drops assignments whose taskId is not a real candidate,
 *   - drops assignments with an invalid section,
 *   - de-duplicates repeated taskIds (first wins),
 *   - drops overflow beyond each section cap (keeping the earlier entries).
 * @returns {Array<{taskId:string, section:string, reason:string}>}
 */
function validateAndCap({ raw, candidates, caps }) {
  const validIds = new Set(candidates.map((c) => String(c.id)));
  const capFor = {
    [TODAY_SECTION.MUST_DO]: caps?.MUST_DO ?? SOFT_CAPS.MUST_DO,
    [TODAY_SECTION.GOOD_TO_DO]: caps?.GOOD_TO_DO ?? SOFT_CAPS.GOOD_TO_DO,
    [TODAY_SECTION.QUICK_WINS]: caps?.QUICK_WINS ?? SOFT_CAPS.QUICK_WINS,
  };
  const used = {
    [TODAY_SECTION.MUST_DO]: 0,
    [TODAY_SECTION.GOOD_TO_DO]: 0,
    [TODAY_SECTION.QUICK_WINS]: 0,
  };
  const seen = new Set();
  const out = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const taskId = item.taskId != null ? String(item.taskId) : null;
    const section = typeof item.section === 'string' ? item.section : null;
    if (!taskId || !validIds.has(taskId)) continue; // unknown/invalid id
    if (!section || !VALID_SECTIONS.has(section)) continue; // invalid section
    if (seen.has(taskId)) continue; // dedupe
    if (used[section] >= capFor[section]) continue; // over cap — drop overflow
    seen.add(taskId);
    used[section] += 1;
    out.push({ taskId, section, reason: sanitizeReason(item.reason) });
  }

  return out;
}

/**
 * Draft today's plan with the AI. ADVISORY + fallback-safe: returns
 * `{ assignments: [{ taskId, section, reason }] }` on a valid non-empty plan,
 * otherwise `null` (so the caller uses the deterministic rules).
 *
 * @param {object} args
 * @param {object[]} args.candidates - candidate task rows (ideally pre-ranked)
 * @param {{MUST_DO?:number,GOOD_TO_DO?:number,QUICK_WINS?:number}} [args.caps]
 *   per-section capacity to enforce in code (defaults to SOFT_CAPS)
 * @param {string} args.todayKey - YYYY-MM-DD London date
 * @returns {Promise<{assignments: Array<{taskId:string, section:string, reason:string}>}|null>}
 */
export async function draftPlanWithAI({ candidates, caps = SOFT_CAPS, todayKey } = {}) {
  const client = getOpenAIClient();
  if (!client) return null;

  const list = Array.isArray(candidates) ? candidates.filter((c) => c && c.id != null) : [];
  if (list.length === 0) return null;

  let content;
  try {
    content = await requestAssignments({ client, candidates: list, caps, todayKey });
  } catch (err) {
    // Never log the key or full task content — just a short reason. The caller
    // falls back to the rules on null.
    console.warn('aiPlannerService: AI draft failed, using rules fallback:', err?.message || 'unknown error');
    return null;
  }

  const raw = parseAssignments(content);
  if (!raw) return null;

  const assignments = validateAndCap({ raw, candidates: list, caps });
  if (assignments.length === 0) return null;

  return { assignments };
}
