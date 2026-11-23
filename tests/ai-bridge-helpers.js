"use strict";

// Shared fakes for the A3 ai-bridge tests (not a test file itself: no .test.js suffix).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

/** Stand-in for Electron safeStorage: real AES so the file on disk never holds the plaintext. */
function fakeSafeStorage({ available = true } = {}) {
  const key = crypto.randomBytes(32);
  return {
    isEncryptionAvailable: () => available,
    encryptString(text) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), body]);
    },
    decryptString(buf) {
      const d = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
    },
  };
}

function tempDir(prefix = "ai-bridge-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function memoryLogger() {
  const events = [];
  const push = level => (event, detail = {}) => events.push({ level, event, ...detail });
  return { events, info: push("info"), warn: push("warn"), error: push("error"), has: e => events.some(x => x.event === e), count: e => events.filter(x => x.event === e).length };
}

const token = () => crypto.randomBytes(32).toString("base64url");

function waitFor(predicate, timeoutMs = 3000, stepMs = 10) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      let value;
      try { value = predicate(); } catch { value = false; }
      if (value) return resolve(value);
      if (Date.now() - started > timeoutMs) return reject(new Error("timeout waiting for condition"));
      setTimeout(tick, stepMs);
    };
    tick();
  });
}

const WEEK = Array(7).fill({ open: "00:00", close: "23:55" });
const sampleSource = (status = "available") => ({
  tables: [{ tableId: "1", tableNo: "โต๊ะ 1", profileId: "default", status }],
  queueWaiting: 0,
  priceProfiles: [{ profileId: "default", label: "ปกติ", pricePerHourTHB: 150, rules: [] }],
});

module.exports = { fakeSafeStorage, tempDir, memoryLogger, token, waitFor, WEEK, sampleSource };
