import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import crypto from 'crypto';
import { signActionToken, verifyActionToken, EMAIL_ACTIONS } from '../emailActionToken';

// Wave 8 — signed, single-use, expiring email action tokens. These tests set
// EMAIL_ACTION_SECRET at runtime (both sign + verify read process.env at call
// time, so no module reload is needed).

const SECRET = 'unit-test-email-action-secret';
const OTHER_SECRET = 'a-different-secret-entirely';
const ORIGINAL = process.env.EMAIL_ACTION_SECRET;

beforeEach(() => {
  process.env.EMAIL_ACTION_SECRET = SECRET;
});

afterAll(() => {
  if (ORIGINAL === undefined) delete process.env.EMAIL_ACTION_SECRET;
  else process.env.EMAIL_ACTION_SECRET = ORIGINAL;
});

describe('signActionToken / verifyActionToken', () => {
  it('signs then verifies a valid token and returns the payload', () => {
    const token = signActionToken({ userId: 'user-1', action: 'task_done', taskId: 'task-9' });
    expect(typeof token).toBe('string');

    const result = verifyActionToken(token);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.payload.uid).toBe('user-1');
    expect(result.payload.act).toBe('task_done');
    expect(result.payload.tid).toBe('task-9');
    expect(typeof result.payload.jti).toBe('string');
    expect(typeof result.payload.exp).toBe('number');
  });

  it('carries a null tid for a task-less action (confirm_plan)', () => {
    const token = signActionToken({ userId: 'user-1', action: 'confirm_plan' });
    const result = verifyActionToken(token);
    expect(result.valid).toBe(true);
    expect(result.payload.tid).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const token = signActionToken({ userId: 'user-1', action: 'confirm_plan' });
    const [payloadB64, sigB64] = token.split('.');
    // Flip a whole byte of the decoded signature (deterministic — flipping the
    // last base64url char alone could land in that char's non-significant
    // padding bits and decode to the identical bytes, which made this flaky).
    const sigBytes = Buffer.from(sigB64, 'base64url');
    sigBytes[0] ^= 0xff;
    const tampered = `${payloadB64}.${sigBytes.toString('base64url')}`;

    const result = verifyActionToken(tampered);
    expect(result.valid).toBe(false);
    expect(result.payload).toBeNull();
    expect(result.reason).toBe('bad_signature');
  });

  it('rejects a tampered payload (signature no longer matches)', () => {
    const token = signActionToken({ userId: 'user-1', action: 'task_done', taskId: 'task-9' });
    const [, sigB64] = token.split('.');
    // Re-encode a payload that claims a different user, keeping the old signature.
    const forgedPayload = Buffer.from(
      JSON.stringify({ jti: 'x', uid: 'attacker', act: 'task_done', tid: 'task-9', exp: 9999999999 })
    ).toString('base64url');
    const forged = `${forgedPayload}.${sigB64}`;

    const result = verifyActionToken(forged);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('bad_signature');
  });

  it('rejects an expired token', () => {
    // ttlMinutes in the past → exp already elapsed.
    const token = signActionToken({ userId: 'user-1', action: 'confirm_plan', ttlMinutes: -10 });
    const result = verifyActionToken(token);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('rejects a token signed with a different secret', () => {
    const token = signActionToken({ userId: 'user-1', action: 'confirm_plan' });
    process.env.EMAIL_ACTION_SECRET = OTHER_SECRET;
    const result = verifyActionToken(token);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('bad_signature');
  });

  it('rejects a well-signed token carrying an unknown action', () => {
    // Manually sign a payload with an out-of-range action using the real secret.
    const payloadB64 = Buffer.from(
      JSON.stringify({ jti: 'j', uid: 'user-1', act: 'delete_everything', tid: null, exp: 9999999999 })
    ).toString('base64url');
    const sigB64 = crypto.createHmac('sha256', SECRET).update(payloadB64).digest('base64url');
    const result = verifyActionToken(`${payloadB64}.${sigB64}`);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('unknown_action');
  });

  it('rejects a malformed token', () => {
    expect(verifyActionToken('not-a-token').valid).toBe(false);
    expect(verifyActionToken('').valid).toBe(false);
    expect(verifyActionToken(null).valid).toBe(false);
  });

  it('is off when the secret is unset: sign returns null, verify rejects', () => {
    delete process.env.EMAIL_ACTION_SECRET;
    expect(signActionToken({ userId: 'user-1', action: 'confirm_plan' })).toBeNull();
    const result = verifyActionToken('anything.here');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('secret_unset');
  });

  it('refuses to sign an out-of-range action', () => {
    expect(signActionToken({ userId: 'user-1', action: 'bogus' })).toBeNull();
  });

  it('exposes exactly the three allowed actions', () => {
    expect(EMAIL_ACTIONS).toEqual(['confirm_plan', 'task_done', 'task_defer']);
  });
});
