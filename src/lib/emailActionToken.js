import crypto from 'crypto';

// Wave 8 — signed, single-use, expiring email action tokens.
//
// A token is `base64url(payload).base64url(HMAC-SHA256(payloadB64, secret))`.
// The signed payload is the SOLE authority for the action route (no app session),
// so verification must be strict: HMAC checked with a timing-safe compare, expiry
// enforced, required fields and the action allow-list validated. The secret lives
// only in EMAIL_ACTION_SECRET; when it is unset the whole feature is off
// (fail-safe) — signing returns null and verification rejects everything.

// The only actions a token may authorise. Exported so callers/tests share one
// source of truth and can never sign or accept an out-of-range action.
export const EMAIL_ACTIONS = ['confirm_plan', 'task_done', 'task_defer'];
const ALLOWED_ACTIONS = new Set(EMAIL_ACTIONS);

// Default token lifetime: 48h (2880 minutes) — long enough for a next-day tap,
// short enough to bound the single-use window.
const DEFAULT_TTL_MINUTES = 2880;

function getSecret() {
  const secret = process.env.EMAIL_ACTION_SECRET;
  return typeof secret === 'string' && secret.length > 0 ? secret : null;
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

/**
 * Sign an email action token. Returns the token string, or `null` when the
 * feature is off (EMAIL_ACTION_SECRET unset) or the inputs are invalid — a null
 * return is the caller's cue to render no action link.
 *
 * @param {object} args
 * @param {string} args.userId    owning user (stored as `uid`)
 * @param {string} args.action    one of EMAIL_ACTIONS
 * @param {string|null} [args.taskId]  task the action targets (stored as `tid`)
 * @param {number} [args.ttlMinutes]   lifetime in minutes (default 48h)
 * @returns {string|null}
 */
export function signActionToken({ userId, action, taskId = null, ttlMinutes = DEFAULT_TTL_MINUTES } = {}) {
  const secret = getSecret();
  if (!secret) return null;
  if (!userId || !ALLOWED_ACTIONS.has(action)) return null;

  // Only fall back to the default when ttlMinutes is not a real number; a caller
  // (or test) may deliberately pass a past ttl to mint an already-expired token.
  const ttl = Number.isFinite(ttlMinutes) ? ttlMinutes : DEFAULT_TTL_MINUTES;
  const exp = Math.floor(Date.now() / 1000) + Math.floor(ttl * 60);

  const payload = {
    jti: crypto.randomUUID(),
    uid: userId,
    act: action,
    tid: taskId ?? null,
    exp,
  };

  const payloadB64 = base64url(JSON.stringify(payload));
  const sigB64 = base64url(crypto.createHmac('sha256', secret).update(payloadB64).digest());
  return `${payloadB64}.${sigB64}`;
}

/**
 * Verify an email action token. Never throws — always returns
 * `{ valid, payload, reason }`. `payload` is null unless `valid` is true.
 *
 * Rejects when: the secret is unset, the token is malformed, the signature does
 * not match (timing-safe), the token is expired, required fields are missing, or
 * the action is unknown.
 *
 * @param {string} token
 * @returns {{ valid: boolean, payload: object|null, reason: string|null }}
 */
export function verifyActionToken(token) {
  try {
    const secret = getSecret();
    if (!secret) return { valid: false, payload: null, reason: 'secret_unset' };
    if (typeof token !== 'string' || token.length === 0) {
      return { valid: false, payload: null, reason: 'malformed' };
    }

    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return { valid: false, payload: null, reason: 'malformed' };
    }
    const [payloadB64, sigB64] = parts;

    // Timing-safe signature check. timingSafeEqual throws on unequal-length
    // buffers, so guard the length first (a length mismatch is itself a
    // signature failure).
    const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest();
    const providedSig = Buffer.from(sigB64, 'base64url');
    if (providedSig.length !== expectedSig.length) {
      return { valid: false, payload: null, reason: 'bad_signature' };
    }
    if (!crypto.timingSafeEqual(providedSig, expectedSig)) {
      return { valid: false, payload: null, reason: 'bad_signature' };
    }

    let payload;
    try {
      payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
      return { valid: false, payload: null, reason: 'malformed' };
    }
    if (!payload || typeof payload !== 'object') {
      return { valid: false, payload: null, reason: 'malformed' };
    }

    const { jti, uid, act, exp } = payload;
    if (!jti || !uid || !act || typeof exp !== 'number') {
      return { valid: false, payload: null, reason: 'missing_fields' };
    }
    if (!ALLOWED_ACTIONS.has(act)) {
      return { valid: false, payload: null, reason: 'unknown_action' };
    }
    if (exp < Math.floor(Date.now() / 1000)) {
      return { valid: false, payload: null, reason: 'expired' };
    }

    return { valid: true, payload, reason: null };
  } catch {
    // Defensive: verification must never throw, whatever the input.
    return { valid: false, payload: null, reason: 'error' };
  }
}
