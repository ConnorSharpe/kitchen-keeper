// Short-TTL cache wrapper around an async loader function, with explicit
// manual invalidation. A throwing loadFn propagates and leaves the cache
// unpopulated (retried on the next get()) rather than caching a failure.
//
// Concurrent get() calls during a cache miss share one in-flight loadFn call
// instead of each firing their own (architect review round 2 — "stampede"
// fix). This only dedupes calls landing on the same instance/process; it's
// not a distributed lock, which this app's scale doesn't need.
export function createCachedLoader(loadFn, ttlMs) {
  let cache = null; // { value, expiresAt } | null
  let inFlight = null; // Promise<value> | null

  async function get() {
    if (cache && Date.now() < cache.expiresAt) return cache.value;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const value = await loadFn();
        cache = { value, expiresAt: Date.now() + ttlMs };
        return value;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  function invalidate() {
    cache = null;
  }

  return { get, invalidate };
}
