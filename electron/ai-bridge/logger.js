"use strict";

// AI Bridge log: one JSON line per event in <data>/logs/ai-bridge.log.
// S-5.3 / S-5.4: callers pass only codes, ids and counts; anything token-shaped is still masked here.
const fs = require("node:fs");
const path = require("node:path");

const MAX_BYTES = 2 * 1024 * 1024;
const TOKENISH = /[A-Za-z0-9_-]{32,}/g;
const PHONEISH = /\b0\d{8,9}\b/g;

function redact(value) {
  if (typeof value === "string") return value.replace(TOKENISH, "[REDACTED]").replace(PHONEISH, "[PHONE]");
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = /token|secret|authorization|password|key/i.test(key) ? "[REDACTED]" : redact(item);
    return out;
  }
  return value;
}

function createFileLogger(file, { now = () => new Date() } = {}) {
  const events = [];
  const write = level => (event, detail = {}) => {
    const line = { at: now().toISOString(), level, event, ...redact(detail) };
    events.push(line);
    if (events.length > 200) events.shift();
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, JSON.stringify(line) + "\n", { mode: 0o600 });
      if (fs.statSync(file).size > MAX_BYTES) fs.truncateSync(file, 0);
    } catch {
      /* logging must never break the shop */
    }
  };
  return { info: write("info"), warn: write("warn"), error: write("error"), recent: () => events.slice() };
}

module.exports = { createFileLogger, redact };
