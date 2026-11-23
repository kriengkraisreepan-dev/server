"use strict";

// A3: WSS client against a fake Cloud hub — hello/heartbeat/snapshot, unknown type (S-1.3),
// token.rotate + ack (G6), approval.* dedupe + ack, outbox after reconnect, revoke, network drop.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const WebSocket = require("ws");
const { BridgeConnection } = require("../electron/ai-bridge/connection");
const { createOutbox } = require("../electron/ai-bridge/outbox");
const { ulid } = require("../electron/ai-bridge/ids");
const { tempDir, memoryLogger, token, waitFor } = require("./ai-bridge-helpers");

const DEVICE = "dev_test1";

/** Minimal Cloud hub: records frames, lets the test push frames and drop connections. */
async function fakeHub({ acceptToken = () => true } = {}) {
  const server = http.createServer();
  const wss = new WebSocket.WebSocketServer({ noServer: true });
  const hub = { frames: [], sockets: [], tokensSeen: [], connections: 0, autoHelloAck: true, autoAck: true };
  server.on("upgrade", (req, socket, head) => {
    const t = String(req.headers.authorization || "").replace(/^Bearer /, "");
    hub.tokensSeen.push(t);
    if (!acceptToken(t)) { socket.write("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n"); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      hub.connections += 1;
      hub.sockets.push(ws);
      ws.on("message", data => {
        const msg = JSON.parse(String(data));
        hub.frames.push(msg);
        if (msg.type === "hello" && hub.autoHelloAck) hub.push(ws, "hello.ack", { serverTime: new Date().toISOString(), snapshotIntervalSec: 30 });
        if (msg.type === "approval.decision" && hub.autoAck) hub.push(ws, "ack", { refId: msg.id });
      });
    });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  hub.url = `ws://127.0.0.1:${server.address().port}/bridge/v1`;
  hub.push = (ws, type, payload, id = ulid()) => { ws.send(JSON.stringify({ v: 1, type, id, ts: new Date().toISOString(), payload })); return id; };
  hub.last = () => hub.sockets[hub.sockets.length - 1];
  hub.of = type => hub.frames.filter(f => f.type === type);
  hub.close = async () => { for (const ws of wss.clients) ws.terminate(); wss.close(); await new Promise(r => server.close(r)); };
  return hub;
}

function client(hub, overrides = {}) {
  const logger = memoryLogger();
  let current = overrides.token || token();
  const saved = [];
  const outbox = createOutbox({ file: path.join(tempDir(), "outbox.json") });
  const conn = new BridgeConnection({
    WebSocket, hubUrl: hub.url, deviceId: DEVICE, appVersion: "1.0.36",
    getToken: () => current, saveToken: t => { saved.push(t); current = t; },
    outbox, logger, heartbeatMs: 50, ackTimeoutMs: 100, delayFor: () => 30, ...overrides.options,
  });
  return { conn, logger, saved, outbox, token: () => current };
}

test("ai-bridge connection", async t => {
  let hub;
  t.beforeEach(async () => { hub = await fakeHub(); });
  t.afterEach(async () => { await hub.close(); });

  await t.test("sends hello with Bearer token, goes online on hello.ack, sends heartbeats", async () => {
    const c = client(hub);
    c.conn.start();
    await waitFor(() => c.conn.state === "online");
    assert.equal(hub.tokensSeen[0], c.token());
    const hello = hub.of("hello")[0];
    assert.deepEqual(hello.payload, { deviceId: DEVICE, appVersion: "1.0.36", protocolVersion: 1, timezone: "Asia/Bangkok" });
    await waitFor(() => hub.of("heartbeat").length >= 2);
    c.conn.stop();
  });

  await t.test("S-1.3: unknown / wrong-direction / malformed message → nothing happens + logged", async () => {
    const c = client(hub);
    const events = [];
    for (const e of ["approval.created", "approval.updated", "token.rotate"]) c.conn.on(e, () => events.push(e));
    c.conn.start();
    await waitFor(() => c.conn.state === "online");
    const ws = hub.last();
    hub.push(ws, "table.open", { tableNo: "1" });
    hub.push(ws, "relay.on", { relay: 1 });
    hub.push(ws, "snapshot", {}); // Shop→Cloud type sent the wrong way
    hub.push(ws, "token.rotate", { newToken: "short" }); // invalid payload
    ws.send("{not json");
    await waitFor(() => c.logger.count("bridge.unknown_message") === 3 && c.logger.count("bridge.rejected_message") === 2);
    assert.deepEqual(events, []);
    assert.deepEqual(c.saved, []);
    assert.equal(c.conn.state, "online", "connection stays up");
    assert.equal(hub.of("ack").length, 0, "nothing acked");
    assert.ok(!JSON.stringify(c.logger.events).includes("short"), "payload values never logged");
    c.conn.stop();
  });

  await t.test("G6: token.rotate → new token stored + ack; reconnect uses the new token; duplicate is not re-stored", async () => {
    const c = client(hub);
    c.conn.start();
    await waitFor(() => c.conn.state === "online");
    const newToken = token();
    const id = hub.push(hub.last(), "token.rotate", { newToken });
    await waitFor(() => hub.of("ack").some(a => a.payload.refId === id));
    assert.deepEqual(c.saved, [newToken]);
    hub.push(hub.last(), "token.rotate", { newToken }, id); // Cloud resend, same id
    await waitFor(() => hub.of("ack").filter(a => a.payload.refId === id).length === 2);
    assert.equal(c.saved.length, 1);
    assert.equal(c.conn.state, "online", "rotate does not drop the connection");
    hub.last().terminate();
    await waitFor(() => hub.connections === 2 && c.conn.state === "online");
    assert.equal(hub.tokensSeen[1], newToken);
    c.conn.stop();
  });

  await t.test("token.rotate that cannot be stored is not acked (Cloud resends, old token still valid)", async () => {
    const c = client(hub);
    c.conn.saveToken = () => { throw Object.assign(new Error("x"), { code: "SAFE_STORAGE_FAILED" }); };
    c.conn.start();
    await waitFor(() => c.conn.state === "online");
    hub.push(hub.last(), "token.rotate", { newToken: token() });
    await waitFor(() => c.logger.has("bridge.token_rotate_failed"));
    assert.equal(hub.of("ack").length, 0);
    c.conn.stop();
  });

  await t.test("approval.created / approval.updated → emitted once, acked every time", async () => {
    const c = client(hub);
    const got = [];
    c.conn.on("approval.created", p => got.push(p.approvalId));
    c.conn.on("approval.updated", p => got.push(`${p.approvalId}:${p.status}`));
    c.conn.start();
    await waitFor(() => c.conn.state === "online");
    const item = { approvalId: "apr_1", kind: "comment_reply", createdAt: "2026-11-22T10:00:00.000Z", expiresAt: "2026-11-22T12:00:00.000Z", summary: "ตอบคอมเมนต์", payload: { kind: "comment_reply", postUrl: "https://facebook.com/p/1", commentText: "เปิดกี่โมง", draftReply: "เปิดเที่ยงครับ" } };
    const id = hub.push(hub.last(), "approval.created", item);
    hub.push(hub.last(), "approval.created", item, id);
    hub.push(hub.last(), "approval.updated", { approvalId: "apr_1", status: "expired" });
    await waitFor(() => hub.of("ack").length === 3);
    assert.deepEqual(got, ["apr_1", "apr_1:expired"]);
    c.conn.stop();
  });

  await t.test("§9: approval.decision queued while offline is persisted and sent after reconnect, then cleared by ack", async () => {
    await hub.close();
    const deadUrl = hub.url;
    const c = client({ url: deadUrl });
    c.conn.start();
    await waitFor(() => c.conn.state === "offline");
    const id = c.conn.enqueueDecision({ approvalId: "apr_9", decision: "rejected", reasonCode: "table_full", decidedBy: "staff_1" });
    assert.equal(c.outbox.size(), 1);
    assert.throws(() => c.conn.enqueueDecision({ approvalId: "apr_9", decision: "rejected", decidedBy: "staff_1" }), "invalid decision is refused before queueing");
    assert.equal(c.outbox.size(), 1);
    // The Cloud comes back (new fake hub; point the client at it).
    hub = await fakeHub();
    c.conn.hubUrl = hub.url;
    await waitFor(() => c.conn.state === "online", 5000);
    await waitFor(() => c.outbox.size() === 0);
    const sent = hub.of("approval.decision");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].id, id, "same envelope id → Cloud dedupes");
    c.conn.stop();
  });

  await t.test("approval.decision without ack is resent with the same id until acked", async () => {
    hub.autoAck = false;
    const c = client(hub);
    c.conn.start();
    await waitFor(() => c.conn.state === "online");
    const id = c.conn.enqueueDecision({ approvalId: "apr_2", decision: "approved", decidedBy: "staff_1" });
    await waitFor(() => hub.of("approval.decision").length >= 3);
    assert.ok(hub.of("approval.decision").every(f => f.id === id));
    hub.push(hub.last(), "ack", { refId: id });
    await waitFor(() => c.outbox.size() === 0);
    const n = hub.of("approval.decision").length;
    await new Promise(r => setTimeout(r, 300));
    assert.equal(hub.of("approval.decision").length, n, "no more resends after ack");
    c.conn.stop();
  });

  await t.test("network drop → reconnects with backoff; shop side never throws", async () => {
    const delays = [];
    const c = client(hub, { options: { delayFor: a => { delays.push(a); return 20; } } });
    c.conn.start();
    await waitFor(() => c.conn.state === "online");
    hub.last().terminate();
    await waitFor(() => c.conn.state === "offline" || hub.connections === 2);
    await waitFor(() => hub.connections === 2 && c.conn.state === "online");
    assert.deepEqual(delays, [0]);
    assert.equal(c.conn.attempt, 0, "attempt counter reset after hello.ack");
    c.conn.stop();
  });

  await t.test("hub down for a while → attempts grow; snapshots are simply not sent", async () => {
    await hub.close();
    const delays = [];
    const c = client(hub, { options: { delayFor: a => { delays.push(a); return 10; } } });
    c.conn.start();
    await waitFor(() => delays.length >= 4);
    assert.deepEqual(delays.slice(0, 4), [0, 1, 2, 3]);
    assert.equal(c.conn.sendSnapshot({}), null, "no send while offline, no throw");
    c.conn.stop();
    hub = await fakeHub();
  });

  await t.test("revoked: close 4401 or upgrade 401 → stops, no reconnect", async () => {
    const c = client(hub);
    let revoked = 0;
    c.conn.on("revoked", () => { revoked += 1; });
    c.conn.start();
    await waitFor(() => c.conn.state === "online");
    hub.last().close(4401, "revoked");
    await waitFor(() => c.conn.state === "revoked");
    await new Promise(r => setTimeout(r, 150));
    assert.equal(hub.connections, 1, "did not reconnect");
    assert.equal(revoked, 1);

    await hub.close();
    hub = await fakeHub({ acceptToken: () => false });
    const d = client(hub);
    d.conn.start();
    await waitFor(() => d.conn.state === "revoked");
    await new Promise(r => setTimeout(r, 150));
    assert.equal(hub.tokensSeen.length, 1);
  });
});
