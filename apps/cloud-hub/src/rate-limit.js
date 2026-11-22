'use strict';

// Fixed-window counter per key, in memory. Good enough for a single hub instance (Phase A);
// a multi-instance deployment would move this to Postgres or Redis.
function createRateLimiter({ limit, windowMs, clock }) {
  const hits = new Map();
  return {
    /** Count one attempt. Returns false when the key is over the limit. */
    hit(key) {
      const now = clock.now();
      let entry = hits.get(key);
      if (!entry || now - entry.start >= windowMs) {
        entry = { start: now, count: 0 };
        hits.set(key, entry);
      }
      entry.count += 1;
      if (hits.size > 10000) {
        for (const [k, e] of hits) if (now - e.start >= windowMs) hits.delete(k);
      }
      return entry.count <= limit;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

module.exports = { createRateLimiter };
