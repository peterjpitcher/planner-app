// Simple in-memory rate limiter for API routes.
//
// ACCEPTED TECH DEBT: In serverless environments (Vercel), each function
// instance keeps its own in-memory Map, so limits are enforced per-instance
// only and are not shared across concurrent instances. Closing that gap needs
// a shared store (e.g. Upstash Redis), which is out of scope for this pass —
// this is a single-user app, so cross-instance bypass is a low-value attack
// and the in-memory limiter still stops the common single-instance case.
// Revisit if this app ever serves multiple untrusted users.
//
// What IS fixed here: the rate-limit *key*. Keying on client-supplied IP
// headers (x-forwarded-for/x-real-ip/cf-connecting-ip) is spoofable — a
// caller can rotate the header value on every request to get a fresh bucket.
// For any route that knows the authenticated user (i.e. runs after an auth
// check), always call getClientIdentifier(request, userId) with that user's
// id so the limit is keyed on something the caller cannot forge. Only omit
// userId (falling back to the IP-derived identifier) for endpoints that must
// rate-limit *before* authentication is established (e.g. login).

const rateLimit = new Map();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, requests] of rateLimit.entries()) {
    const validRequests = requests.filter(time => time > now - 60000);
    if (validRequests.length === 0) {
      rateLimit.delete(key);
    } else {
      rateLimit.set(key, validRequests);
    }
  }
}, 5 * 60 * 1000);

export function checkRateLimit(identifier, maxRequests = 10, windowMs = 60000) {
  const now = Date.now();
  const windowStart = now - windowMs;
  
  if (!rateLimit.has(identifier)) {
    rateLimit.set(identifier, []);
  }
  
  const requests = rateLimit.get(identifier).filter(time => time > windowStart);
  
  if (requests.length >= maxRequests) {
    return { 
      allowed: false, 
      retryAfter: Math.ceil((requests[0] + windowMs - now) / 1000)
    };
  }
  
  requests.push(now);
  rateLimit.set(identifier, requests);
  
  return { allowed: true };
}

// Helper to get a rate-limit identifier for a request.
// Pass the authenticated user id whenever it is known — it cannot be spoofed
// by the caller, unlike the IP headers below. Only relies on IP when userId
// is not yet available (pre-auth endpoints).
export function getClientIdentifier(request, userId = null) {
  if (userId) return `user:${userId}`;

  // Fallback for pre-auth requests only: IP derived from proxy headers.
  // These headers are client-controlled and can be rotated per request, so
  // this path gives weaker protection — never use it once a user id exists.
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const cfConnectingIp = request.headers.get('cf-connecting-ip');

  return forwarded?.split(',')[0]?.trim() || realIp || cfConnectingIp || 'unknown';
}