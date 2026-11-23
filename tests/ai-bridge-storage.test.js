"use strict";

// A3: token stored only via safeStorage (S-5.2); backoff schedule (BRIDGE_PROTOCOL §3); outbox persists.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createTokenStore } = require("../electron/ai-bridge/token-store");
const { createOutbox } = require("../electron/ai-bridge/outbox");
const { reconnectDelay } = require("../electron/ai-bridge/backoff");
const { fakeSafeStorage, tempDir, token } = require("./ai-bridge-helpers");

test("A3 S-5.2: token is written encrypted with safeStorage, never in plaintext", () => {
  const dir = tempDir(), file = path.join(dir, "t.bin"), t = token();
  const store = createTokenStore({ file, safeStorage: fakeSafeStorage() });
  store.save(t);
  const onDisk = fs.readFileSync(file);
  assert.ok(!onDisk.includes(Buffer.from(t)), "plaintext token must not be on disk");
  assert.ok(!onDisk.toString("latin1").includes(t));
  assert.equal(store.load(), t);
  store.clear();
  assert.equal(fs.existsSync(file), false);
  assert.equal(store.load(), null);
});

test("A3 S-5.2: without safeStorage encryption the token is refused and nothing is written", () => {
  const dir = tempDir(), file = path.join(dir, "t.bin");
  const store = createTokenStore({ file, safeStorage: fakeSafeStorage({ available: false }) });
  assert.throws(() => store.save(token()), { code: "SAFE_STORAGE_UNAVAILABLE" });
  assert.equal(fs.existsSync(file), false);
});

test("A3 S-5.2: an encryptString that returns plaintext is rejected", () => {
  const dir = tempDir(), file = path.join(dir, "t.bin");
  const store = createTokenStore({ file, safeStorage: { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() } });
  assert.throws(() => store.save(token()), { code: "SAFE_STORAGE_FAILED" });
  assert.equal(fs.existsSync(file), false);
});

test("A3 §3: reconnect backoff 1s → 2s → 4s … max 60s, jitter ±20%", () => {
  const mid = () => 0.5, low = () => 0, high = () => 1;
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 20].map(a => reconnectDelay(a, mid)), [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  assert.equal(reconnectDelay(0, low), 800);
  assert.equal(reconnectDelay(0, high), 1200);
  assert.equal(reconnectDelay(10, low), 48000);
  assert.equal(reconnectDelay(10, high), 72000);
  for (let i = 0; i < 200; i++) {
    const d = reconnectDelay(3);
    assert.ok(d >= 6400 && d <= 9600);
  }
});

test("A3 §3: outbox survives a restart (persisted on disk) and removes by id", () => {
  const dir = tempDir(), file = path.join(dir, "o.json");
  const a = createOutbox({ file });
  a.add({ id: "01J0000000000000000000000A", type: "approval.decision", ts: "x", payload: { approvalId: "a1" } });
  a.add({ id: "01J0000000000000000000000B", type: "approval.decision", ts: "x", payload: { approvalId: "a2" } });
  const b = createOutbox({ file });
  assert.equal(b.size(), 2);
  assert.equal(b.remove("01J0000000000000000000000A"), true);
  assert.equal(createOutbox({ file }).size(), 1);
  b.clear();
  assert.equal(fs.existsSync(file), false);
});
