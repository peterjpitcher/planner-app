// Simple in-memory rate limiter for API routes
// In production, consider using Redis or a similar solution

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

// Helper to get client identifier from request
export function getClientIdentifier(request) {
  // Try to get IP from various headers (considering proxies)
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const cfConnectingIp = request.headers.get('cf-connecting-ip');
  
  // Use the first available IP
  const ip = forwarded?.split(',')[0] || realIp || cfConnectingIp || 'unknown';
  
  // You could also include user ID if authenticated
  // const userId = session?.user?.id || 'anonymous';
  
  return ip;
}