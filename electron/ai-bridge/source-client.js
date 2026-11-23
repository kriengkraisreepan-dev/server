"use strict";

// Reads the Public snapshot fields from the backend's loopback-only, read-only route
// (`GET /internal/ai-bridge/snapshot-source`, index.js). S-1.2: GET only — the AI Bridge has no
// way to call any POS write route.
function createSourceClient({ baseUrl, key, fetchImpl = globalThis.fetch, timeoutMs = 3000 }) {
  return async function fetchSource() {
    const base = typeof baseUrl === "function" ? baseUrl() : baseUrl;
    if (!base) throw Object.assign(new Error("backend not ready"), { code: "BACKEND_NOT_READY" });
    const res = await fetchImpl(`${base}/internal/ai-bridge/snapshot-source`, {
      method: "GET",
      headers: { "x-lucky-ai-bridge-key": key },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw Object.assign(new Error(`snapshot source HTTP ${res.status}`), { code: `SOURCE_HTTP_${res.status}` });
    return res.json();
  };
}

module.exports = { createSourceClient };
