"use strict";

// A3: backend route GET /internal/ai-bridge/snapshot-source — read-only, loopback + per-launch key
// only, never through the tunnel, Public fields only (S-1.2, S-2).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const KEY = "a".repeat(64);
const pause = ms => new Promise(r => setTimeout(r, ms));

async function startBackend(env) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-aibridge-"));
  const port = 38000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ["index.js"], { cwd: root, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir, ...env }, stdio: "ignore" });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/state`)).status === 401) break; } catch {} await pause(100); }
  return { base, stop: () => { child.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}

test("A3 snapshot-source route: key + loopback only, Public fields only", async () => {
  const b = await startBackend({ LUCKY_AI_BRIDGE_SOURCE_KEY: KEY });
  try {
    const url = `${b.base}/internal/ai-bridge/snapshot-source`;
    assert.equal((await fetch(url)).status, 404, "no key → 404");
    assert.equal((await fetch(url, { headers: { "x-lucky-ai-bridge-key": "b".repeat(64) } })).status, 404, "wrong key → 404");
    assert.equal((await fetch(url, { headers: { "x-lucky-ai-bridge-key": KEY, "cf-connecting-ip": "1.2.3.4" } })).status, 404, "through the tunnel → 404");
    assert.equal((await fetch(url, { method: "POST", headers: { "x-lucky-ai-bridge-key": KEY } })).status, 404, "GET only");
    let res = await fetch(url, { headers: { "x-lucky-ai-bridge-key": KEY } });
    assert.equal(res.status, 200);
    let body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), ["generatedAt", "priceProfiles", "queueWaiting", "tables"]);
    assert.ok(body.tables.length > 0 && body.tables.every(t => t.status === "available"));
    for (const t of body.tables) assert.deepEqual(Object.keys(t).sort(), ["profileId", "status", "tableId", "tableNo"]);

    // Start table 1 as staff; the source must show it in_use and still carry no PII/bill data.
    const login = await fetch(`${b.base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "123456789" }) });
    const headers = { Cookie: login.headers.get("set-cookie").split(";")[0], "Content-Type": "application/json" };
    assert.equal((await fetch(`${b.base}/api/tables/1/start`, { method: "POST", headers, body: "{}" })).status, 200);
    res = await fetch(url, { headers: { "x-lucky-ai-bridge-key": KEY } });
    body = await res.json();
    const t1 = body.tables.find(t => t.tableId === "1");
    assert.equal(t1.status, "in_use");
    assert.equal(typeof t1.elapsedMin, "number");
    const text = JSON.stringify(body);
    for (const word of ["member", "currentPrice", "relay", "phone", "items", "rateSatang"]) assert.ok(!text.includes(word), `leaked ${word}`);
  } finally { b.stop(); }
});

test("A3 snapshot-source route does not exist without the desktop key", async () => {
  const b = await startBackend({ LUCKY_AI_BRIDGE_SOURCE_KEY: "" });
  try {
    assert.equal((await fetch(`${b.base}/internal/ai-bridge/snapshot-source`, { headers: { "x-lucky-ai-bridge-key": "" } })).status, 404);
  } finally { b.stop(); }
});
