// Simple request deduplication and caching mechanism
// Prevents multiple identical requests from being made simultaneously

const pendingRequests = new Map();
const cache = new Map();
// Per-key invalidation epoch. clearCache/clearCacheByPrefix/clearAllCache bump the
// epoch so any request that was already in flight when the invalidation happened is
// prevented from re-populating the cache with pre-mutation (stale) data.
const epochs = new Map();
const CACHE_TTL = 5000; // 5 seconds cache

function getEpoch(key) {
  return epochs.get(key) || 0;
}

function bumpEpoch(key) {
  epochs.set(key, getEpoch(key) + 1);
}

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

  // Snapshot the invalidation epoch when the request starts. If clearCache runs
  // while this request is in flight, the epoch changes and we skip caching below.
  const startEpoch = getEpoch(key);

  // Create new request
  const promise = fetchFn()
    .then(data => {
      // Only cache the result if no invalidation was issued mid-flight
      if (getEpoch(key) === startEpoch) {
        cache.set(key, {
          data,
          timestamp: Date.now()
        });
      }
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
  bumpEpoch(key);
}

// Clear cache entries by key prefix
export function clearCacheByPrefix(prefix) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
  for (const key of pendingRequests.keys()) {
    if (key.startsWith(prefix)) {
      pendingRequests.delete(key);
      bumpEpoch(key);
    }
  }
}

// Clear all caches
export function clearAllCache() {
  cache.clear();
  for (const key of pendingRequests.keys()) {
    bumpEpoch(key);
  }
  pendingRequests.clear();
}

// ---------------------------------------------------------------------------
// Latest-wins request guard
// ---------------------------------------------------------------------------
//
// Shared helper used by data loaders that can fire overlapping refetches (e.g.
// two rapid mutations each dispatch 'tasks-changed'). Each loader keeps one guard
// (usually in a useRef). Call begin() at the start of a fetch to claim a token,
// then check isStale(token) after the await — if a newer fetch started in the
// meantime the token is stale and the response should be discarded, so the last
// response to *start* always wins rather than the last to *resolve*.
export function createLatestGuard() {
  let current = 0;
  return {
    begin() {
      current += 1;
      return current;
    },
    isStale(token) {
      return token !== current;
    },
  };
}
