"use strict";

// Reconnect backoff — BRIDGE_PROTOCOL §3: 1s → 2s → 4s … max 60s, jitter ±20%.
const BASE_MS = 1000;
const MAX_MS = 60 * 1000;
const JITTER = 0.2;

/**
 * @param {number} attempt 0 for the first retry after a drop
 * @param {() => number} random 0..1
 * @returns {number} delay in ms
 */
function reconnectDelay(attempt, random = Math.random) {
  const n = Math.max(0, Math.floor(Number(attempt) || 0));
  const base = Math.min(MAX_MS, BASE_MS * 2 ** Math.min(n, 16));
  const factor = 1 - JITTER + random() * 2 * JITTER;
  return Math.round(base * factor);
}

module.exports = { reconnectDelay, BASE_MS, MAX_MS, JITTER };
