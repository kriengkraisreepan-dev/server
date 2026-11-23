"use strict";

// A3: pair → token in safeStorage + connect + snapshot sent; Disconnect deletes the local token and
// tells the Cloud (S-1.5); IPC handlers only for OWNER/MANAGER from our own origin.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const WebSocket = require("ws");
const { AiBridge, normalizeHubBaseUrl, checkWsUrl } = require("../electron/ai-bridge");
const { installAiBridge } = require("../electron/ai-bridge/main-integration");
const { IPC_CHANNELS } = require("../electron/security-policy");
const { fakeSafeStorage, tempDir, memoryLogger, token, waitFor, WEEK, sampleSource } = require("./ai-bridge-helpers");

async function fakeCloud() {
  const state = { token: token(), unpaired: [], pairBodies: [], snapshots: [], frames: [], wsUrlOverride: null };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      if (req.method === "POST" && req.url === "/bridge/v1/pair") {
        const b = JSON.parse(body);
        state.pairBodies.push(b);
        if (b.pairingCode !== "K7MX2QPA") { res.writeHead(400); return res.end('{"error":"invalid_code"}'); }
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ deviceId: "dev_abc", deviceToken: state.token, hubUrl: state.wsUrlOverride || `ws://127.0.0.1:${server.address().port}/bridge/v1` }));
      }
      if (req.method === "POST" && req.url === "/bridge/v1/unpair") {
        state.unpaired.push(req.headers.authorization);
        res.writeHead(200, { "content-type": "application/json" });
        for (const ws of wss.clients) ws.close(4401, "revoked");
        return res.end('{"ok":true}');
      }
      res.writeHead(404); res.end();
    });
  });
  const wss = new WebSocket.WebSocketServer({ server, path: "/bridge/v1" });
  wss.on("connection", (ws, req) => {
    state.auth = req.headers.authorization;
    ws.on("message", d => {
      const m = JSON.parse(String(d));
      state.frames.push(m);
      if (m.type === "hello") ws.send(JSON.stringify({ v: 1, type: "hello.ack", id: "01J00000000000000000000000", ts: new Date().toISOString(), payload: { serverTime: new Date().toISOString(), snapshotIntervalSec: 30 } }));
      if (m.type === "snapshot") state.snapshots.push(m.payload);
    });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  state.base = `http://127.0.0.1:${server.address().port}`;
  state.close = async () => { for (const ws of wss.clients) ws.terminate(); wss.close(); await new Promise(r => server.close(r)); };
  return state;
}

function newBridge({ safeStorage = fakeSafeStorage(), fetchSource = async () => sampleSource() } = {}) {
  const dir = tempDir();
  const bridge = new AiBridge({ configDir: path.join(dir, "config"), logsDir: path.join(dir, "logs"), safeStorage, WebSocket, appVersion: "1.0.36", fetchSource, logger: memoryLogger() });
  return { bridge, dir, tokenFile: path.join(dir, "config", "ai-bridge-token.bin"), configFile: path.join(dir, "config", "ai-bridge.json") };
}

test("ai-bridge pairing / disconnect", async t => {
  let cloud;
  t.beforeEach(async () => { cloud = await fakeCloud(); });
  t.afterEach(async () => { await cloud.close(); });

  await t.test("refuses to pair before shop hours are set, or without safeStorage", async () => {
    const { bridge } = newBridge();
    await assert.rejects(bridge.pair({ hubBaseUrl: cloud.base, pairingCode: "K7MX2QPA", deviceName: "PC" }), { code: "SHOP_HOURS_NOT_SET" });
    const noCrypto = newBridge({ safeStorage: fakeSafeStorage({ available: false }) }).bridge;
    noCrypto.saveShopInfo({ shopInfo: { weeklyHours: WEEK } });
    await assert.rejects(noCrypto.pair({ hubBaseUrl: cloud.base, pairingCode: "K7MX2QPA", deviceName: "PC" }), { code: "SAFE_STORAGE_UNAVAILABLE" });
    assert.equal(cloud.pairBodies.length, 0, "nothing sent to the Cloud");
  });

  await t.test("pair → token encrypted on disk, connects, sends a strict snapshot; Disconnect deletes the token and notifies the Cloud", async () => {
    const { bridge, tokenFile, configFile } = newBridge();
    bridge.saveShopInfo({ shopInfo: { weeklyHours: WEEK, note: "เปิดปกติ" }, tableKinds: { 1: "pool" } });
    const status = await bridge.pair({ hubBaseUrl: cloud.base, pairingCode: "k7mx2qpa", deviceName: "Front desk PC" });
    assert.equal(status.paired, true);
    assert.deepEqual(cloud.pairBodies[0], { pairingCode: "K7MX2QPA", deviceName: "Front desk PC", appVersion: "1.0.36" });
    assert.ok(fs.existsSync(tokenFile));
    assert.ok(!fs.readFileSync(tokenFile).includes(Buffer.from(cloud.token)), "S-5.2 no plaintext token on disk");
    assert.ok(!fs.readFileSync(configFile, "utf8").includes(cloud.token), "token not in config either");
    await waitFor(() => cloud.snapshots.length >= 1);
    assert.equal(cloud.auth, `Bearer ${cloud.token}`);
    assert.equal(cloud.snapshots[0].tables[0].kind, "pool");
    assert.equal(cloud.snapshots[0].shop.note, "เปิดปกติ");
    assert.equal(bridge.status().state, "online");

    const after = await bridge.disconnect();
    assert.equal(after.cloudNotified, true);
    assert.deepEqual(cloud.unpaired, [`Bearer ${cloud.token}`]);
    assert.equal(fs.existsSync(tokenFile), false, "S-1.5 token deleted");
    assert.equal(after.paired, false);
    assert.equal(after.state, "not_paired");
    assert.ok(after.shopInfo, "shop hours are kept");
  });

  await t.test("Disconnect while the Cloud is unreachable still deletes the local token", async () => {
    const { bridge, tokenFile } = newBridge();
    bridge.saveShopInfo({ shopInfo: { weeklyHours: WEEK } });
    await bridge.pair({ hubBaseUrl: cloud.base, pairingCode: "K7MX2QPA", deviceName: "PC" });
    await cloud.close();
    const after = await bridge.disconnect();
    assert.equal(after.cloudNotified, false);
    assert.equal(fs.existsSync(tokenFile), false);
    cloud = await fakeCloud();
  });

  await t.test("restart: start() reconnects with the stored token", async () => {
    const { bridge, dir } = newBridge();
    const safeStorage = fakeSafeStorage();
    const first = new AiBridge({ configDir: path.join(dir, "c2"), logsDir: path.join(dir, "l2"), safeStorage, WebSocket, appVersion: "1.0.36", fetchSource: async () => sampleSource(), logger: memoryLogger() });
    first.saveShopInfo({ shopInfo: { weeklyHours: WEEK } });
    await first.pair({ hubBaseUrl: cloud.base, pairingCode: "K7MX2QPA", deviceName: "PC" });
    await waitFor(() => first.status().state === "online");
    first.shutdown();
    const again = new AiBridge({ configDir: path.join(dir, "c2"), logsDir: path.join(dir, "l2"), safeStorage, WebSocket, appVersion: "1.0.36", fetchSource: async () => sampleSource(), logger: memoryLogger() });
    again.start();
    await waitFor(() => again.status().state === "online");
    const seqs = cloud.snapshots.map(s => s.seq);
    assert.ok(seqs.length >= 2 && seqs[seqs.length - 1] > seqs[0], "seq keeps growing across restarts");
    again.shutdown();
    bridge.shutdown();
  });

  await t.test("revoke from the Cloud clears the local token", async () => {
    const { bridge, tokenFile } = newBridge();
    bridge.saveShopInfo({ shopInfo: { weeklyHours: WEEK } });
    await bridge.pair({ hubBaseUrl: cloud.base, pairingCode: "K7MX2QPA", deviceName: "PC" });
    await waitFor(() => bridge.status().state === "online");
    await fetch(`${cloud.base}/bridge/v1/unpair`, { method: "POST" }); // closes sockets with 4401
    await waitFor(() => !fs.existsSync(tokenFile));
    assert.equal(bridge.status().paired, false);
    assert.equal(bridge.status().lastError, "REVOKED");
  });

  await t.test("wrong pairing code → error, nothing stored", async () => {
    const { bridge, tokenFile } = newBridge();
    bridge.saveShopInfo({ shopInfo: { weeklyHours: WEEK } });
    await assert.rejects(bridge.pair({ hubBaseUrl: cloud.base, pairingCode: "AAAAAAAA", deviceName: "PC" }), { code: "PAIR_HTTP_400" });
    await assert.rejects(bridge.pair({ hubBaseUrl: cloud.base, pairingCode: "AAAA0000", deviceName: "PC" }), { code: "PAIRING_CODE_INVALID" });
    assert.equal(fs.existsSync(tokenFile), false);
  });

  await t.test("hub may not redirect the bridge to another host", async () => {
    cloud.wsUrlOverride = "wss://evil.example/bridge/v1";
    const { bridge, tokenFile } = newBridge();
    bridge.saveShopInfo({ shopInfo: { weeklyHours: WEEK } });
    await assert.rejects(bridge.pair({ hubBaseUrl: cloud.base, pairingCode: "K7MX2QPA", deviceName: "PC" }), { code: "HUB_WS_URL_INVALID" });
    assert.equal(fs.existsSync(tokenFile), false);
  });
});

test("A3: hub URL must be https (http only for localhost)", () => {
  assert.equal(normalizeHubBaseUrl("https://hub.example.com/"), "https://hub.example.com");
  assert.equal(normalizeHubBaseUrl("http://localhost:8080"), "http://localhost:8080");
  assert.throws(() => normalizeHubBaseUrl("http://hub.example.com"), { code: "HUB_URL_INSECURE" });
  assert.throws(() => normalizeHubBaseUrl("https://u:p@hub.example.com"), { code: "HUB_URL_INVALID" });
  assert.equal(checkWsUrl("wss://hub.example.com/bridge/v1", "https://hub.example.com"), "wss://hub.example.com/bridge/v1");
  assert.throws(() => checkWsUrl("ws://hub.example.com/bridge/v1", "https://hub.example.com"), { code: "HUB_WS_URL_INVALID" });
});

test("A3: shop info is validated", () => {
  const { bridge } = newBridge();
  assert.throws(() => bridge.saveShopInfo({ shopInfo: { weeklyHours: WEEK.slice(0, 6) } }), { code: "SHOP_INFO_INVALID" });
  assert.throws(() => bridge.saveShopInfo({ shopInfo: { weeklyHours: WEEK, note: "x".repeat(201) } }), { code: "SHOP_INFO_INVALID" });
  assert.throws(() => bridge.saveShopInfo({ tableKinds: { 1: "carom" } }), { code: "TABLE_KINDS_INVALID" });
  assert.throws(() => bridge.saveShopInfo({ shopInfo: { weeklyHours: WEEK, phone: "0812345678" } }), { code: "SHOP_INFO_INVALID" });
});

test("A3: AI Bridge IPC only for OWNER/MANAGER from our own origin", async () => {
  const origin = "http://127.0.0.1:4555";
  const handlers = {};
  const roleFor = { good: "OWNER", mgr: "MANAGER", staff: "STAFF" };
  let cookie = "good";
  const fetchImpl = async (url, init = {}) => {
    if (url === `${origin}/api/auth/me`) {
      const v = String(init.headers?.cookie || "").replace("lucky_session=", "");
      return { ok: Boolean(roleFor[v]), json: async () => ({ user: { role: roleFor[v] } }) };
    }
    throw new Error("unexpected fetch " + url);
  };
  const dir = tempDir();
  installAiBridge({
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    session: { cookies: { get: async () => (cookie ? [{ value: cookie }] : []) } },
    safeStorage: fakeSafeStorage(),
    layout: { config: path.join(dir, "config"), logs: path.join(dir, "logs") },
    origin, sourceKey: "k".repeat(64), appVersion: "1.0.36", channels: IPC_CHANNELS,
    validateSender: e => e.senderFrame.url.startsWith(origin),
    fetchImpl,
  });
  assert.deepEqual(Object.keys(handlers).sort(), [IPC_CHANNELS.AI_BRIDGE_DISCONNECT, IPC_CHANNELS.AI_BRIDGE_PAIR, IPC_CHANNELS.AI_BRIDGE_SAVE_SHOP_INFO, IPC_CHANNELS.AI_BRIDGE_STATUS].sort());
  const ours = { senderFrame: { url: `${origin}/` } };
  const status = await handlers[IPC_CHANNELS.AI_BRIDGE_STATUS](ours);
  assert.equal(status.state, "not_paired");
  cookie = "mgr";
  assert.equal((await handlers[IPC_CHANNELS.AI_BRIDGE_SAVE_SHOP_INFO](ours, { shopInfo: { weeklyHours: WEEK } })).shopInfo.weeklyHours.length, 7);
  cookie = "staff";
  await assert.rejects(handlers[IPC_CHANNELS.AI_BRIDGE_STATUS](ours), { code: "FORBIDDEN" });
  cookie = null;
  await assert.rejects(handlers[IPC_CHANNELS.AI_BRIDGE_DISCONNECT](ours), { code: "FORBIDDEN" });
  cookie = "good";
  await assert.rejects(handlers[IPC_CHANNELS.AI_BRIDGE_STATUS]({ senderFrame: { url: "https://evil.example/" } }), { code: "IPC_REQUEST_REJECTED" });
  await assert.rejects(handlers[IPC_CHANNELS.AI_BRIDGE_PAIR](ours, { hubBaseUrl: "http://evil.example", pairingCode: "K7MX2QPA", deviceName: "x" }), { code: "HUB_URL_INSECURE" });
});
