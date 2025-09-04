// Simple request deduplication and caching mechanism
// Prevents multiple identical requests from being made simultaneously

const pendingRequests = new Map();
const cache = new Map();
const CACHE_TTL = 5000; // 5 seconds cache

export function dedupedFetch(key, fetchFn) {
  // Check if we have a pending request for this key
  if (pendingRequests.has(key)) {
    return pendingRequests.get(key);
  }

  // Check if we have cached data that's still fresh
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return Promise.resolve(cached.data);
  }

  // Create new request
  const promise = fetchFn()
    .then(data => {
      // Cache the result
      cache.set(key, {
        data,
        timestamp: Date.now()
      });
      return data;
    })
    .finally(() => {
      // Remove from pending requests
      pendingRequests.delete(key);
    });

  // Store as pending request
  pendingRequests.set(key, promise);
  return promise;
}

// Clear cache for a specific key
export function clearCache(key) {
  cache.delete(key);
  pendingRequests.delete(key);
}

// Clear all caches
export function clearAllCache() {
  cache.clear();
  pendingRequests.clear();
}