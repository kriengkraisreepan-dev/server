'use strict';

// A2 acceptance: WSS endpoint, snapshot cache + staleness, revoke, and the Cloud-side
// tests of BRIDGE_PROTOCOL §9.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startHub, snapshot, sleep } = require('./helpers');
const { CLOSE } = require('../src/bridge/ws-server');
const ids = require('../src/ids');

test('bridge WSS', async (t) => {
  let h;
  t.beforeEach(async () => { h = await startHub(); });
  t.afterEach(async () => { await h.close(); });

  // ---- §9: token wrong / revoked → upgrade refused ----
  await t.test('upgrade without token, with a wrong token, or a malformed header → 401', async () => {
    await assert.rejects(h.connect(null), { status: 401 });
    await assert.rejects(h.connect(ids.deviceToken()), { status: 401 });
    await assert.rejects(h.connect('not-a-token'), { status: 401 });
    assert.ok(h.logger.has('bridge.auth_rejected'));
  });

  await t.test('token in query string is not accepted', async () => {
    const { deviceToken } = await h.pairDevice();
    const WebSocket = require('ws');
    const ws = new WebSocket(`${h.wsUrl}?token=${deviceToken}`);
    const status = await new Promise((resolve) => ws.once('unexpected-response', (req, res) => resolve(res.statusCode)));
    assert.equal(status, 401);
  });

  await t.test('other paths are refused', async () => {
    const { deviceToken } = await h.pairDevice();
    const WebSocket = require('ws');
    const ws = new WebSocket(h.wsUrl.replace('/bridge/v1', '/bridge/v2'), { headers: { authorization: `Bearer ${deviceToken}` } });
    const status = await new Promise((resolve) => ws.once('unexpected-response', (req, res) => resolve(res.statusCode)));
    assert.equal(status, 404);
  });

  await t.test('hello → hello.ack with serverTime and snapshotIntervalSec 30; device online', async () => {
    const { deviceId, deviceToken } = await h.pairDevice();
    const c = await h.connect(deviceToken);
    assert.equal(h.hub.bridge.isOnline(deviceId), false, 'not online before hello');
    const ack = await c.hello(deviceId);
    assert.equal(ack.v, 1);
    assert.equal(ack.payload.snapshotIntervalSec, 30);
    assert.ok(Date.parse(ack.payload.serverTime));
    assert.match(ack.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assert.equal(h.hub.bridge.isOnline(deviceId), true);
  });

  await t.test('hello with another deviceId closes the connection (4403)', async () => {
    const { deviceToken } = await h.pairDevice();
    const c = await h.connect(deviceToken);
    c.send('hello', { deviceId: 'dev_someoneelse', appVersion: '1', protocolVersion: 1, timezone: 'Asia/Bangkok' });
    assert.equal((await c.closed()).code, CLOSE.DEVICE_MISMATCH);
  });

  await t.test('messages before hello are ignored and logged', async () => {
    const { deviceId, deviceToken } = await h.pairDevice();
    const c = await h.connect(deviceToken);
    c.send('snapshot', snapshot(h.clock, 1));
    await c.hello(deviceId);
    await c.flush();
    assert.equal(await h.hub.snapshots.latest(deviceId), null);
    assert.ok(h.logger.has('bridge.before_hello'));
  });

  // ---- snapshot: validate → store latest → stale ----
  await t.test('valid snapshot is stored and fresh (stale=false)', async () => {
    const { deviceId, client } = await h.onlineDevice();
    client.send('snapshot', snapshot(h.clock, 1));
    await client.flush();
    const latest = await h.hub.snapshots.latest(deviceId);
    assert.equal(latest.seq, 1);
    assert.equal(latest.stale, false);
    assert.equal(latest.online, true);
    assert.equal(latest.snapshot.tables.length, 2);
  });

  await t.test('newer seq replaces, older seq is ignored', async () => {
    const { deviceId, client } = await h.onlineDevice();
    client.send('snapshot', snapshot(h.clock, 5));
    client.send('snapshot', snapshot(h.clock, 3, { queue: { waiting: 9 } }));
    await client.flush();
    assert.equal((await h.hub.snapshots.latest(deviceId)).seq, 5);
    client.send('snapshot', snapshot(h.clock, 6, { queue: { waiting: 4 } }));
    await client.flush();
    const latest = await h.hub.snapshots.latest(deviceId);
    assert.equal(latest.seq, 6);
    assert.equal(latest.snapshot.queue.waiting, 4);
  });

  await t.test('stale when generatedAt is older than 90 s', async () => {
    const { deviceId, client } = await h.onlineDevice();
    client.send('snapshot', snapshot(h.clock, 1));
    await client.flush();
    h.clock.advance(90 * 1000);
    assert.equal((await h.hub.snapshots.latest(deviceId)).stale, false, 'exactly 90 s is not stale');
    h.clock.advance(1000);
    assert.equal((await h.hub.snapshots.latest(deviceId)).stale, true);
  });

  await t.test('stale when the device is offline, even with a fresh snapshot', async () => {
    const { deviceId, client } = await h.onlineDevice();
    client.send('snapshot', snapshot(h.clock, 1));
    await client.flush();
    client.ws.close();
    await client.closed();
    await sleep(50);
    const latest = await h.hub.snapshots.latest(deviceId);
    assert.equal(latest.online, false);
    assert.equal(latest.stale, true);
  });

  // ---- §9: snapshot with extra field → reject ----
  await t.test('snapshot with an extra field (or PII field) is rejected, logged, not stored', async () => {
    const { deviceId, client } = await h.onlineDevice();
    client.send('snapshot', snapshot(h.clock, 1, { customerName: 'สมชาย' }));
    const bad = snapshot(h.clock, 2);
    bad.tables[0].phone = '0812345678';
    client.send('snapshot', bad);
    await client.flush();
    assert.equal(await h.hub.snapshots.latest(deviceId), null);
    const rejected = h.logger.events.filter((e) => e.event === 'bridge.rejected_message');
    assert.equal(rejected.length, 2);
    assert.ok(rejected.every((e) => e.code === 'invalid_payload'));
    assert.ok(!JSON.stringify(h.logger.events).includes('0812345678'), 'rejected values never reach the log');
  });

  await t.test('unknown message type is rejected and logged; connection stays up', async () => {
    const { client } = await h.onlineDevice();
    client.send('table.open', { tableNo: '1' });
    client.send('token.rotate', { newToken: ids.deviceToken() }); // Cloud→Shop only
    client.raw('{not json');
    await client.flush();
    const codes = h.logger.events.filter((e) => e.event === 'bridge.rejected_message').map((e) => e.code);
    assert.deepEqual(codes, ['unknown_type', 'unknown_type', 'bad_json']);
  });

  await t.test('message larger than 256 KB closes the socket (1009)', async () => {
    const { client } = await h.onlineDevice();
    client.raw('x'.repeat(256 * 1024 + 1));
    assert.equal((await client.closed()).code, 1009);
  });

  // ---- §9: duplicate id → processed once ----
  await t.test('duplicate approval.decision id is processed once but acked each time', async () => {
    const { client } = await h.onlineDevice();
    const id = ids.ulid();
    const payload = { approvalId: 'appr_1', decision: 'rejected', reasonCode: 'table_full', decidedBy: 'staff_7' };
    client.send('approval.decision', payload, id);
    client.send('approval.decision', payload, id);
    const acks = [await client.next((m) => m.type === 'ack'), await client.next((m) => m.type === 'ack')];
    assert.ok(acks.every((a) => a.payload.refId === id));
    const received = (await h.hub.audit.recent(50)).filter((e) => e.action === 'approval.decision.received' && e.target === 'appr_1');
    assert.equal(received.length, 1);
  });

  await t.test('duplicate snapshot id is processed once', async () => {
    const { deviceId, client } = await h.onlineDevice();
    const id = ids.ulid();
    client.send('snapshot', snapshot(h.clock, 1), id);
    await client.flush();
    await h.db.query('DELETE FROM snapshots_latest');
    client.send('snapshot', snapshot(h.clock, 1), id);
    await client.flush();
    assert.equal(await h.hub.snapshots.latest(deviceId), null);
    assert.ok(h.logger.has('bridge.duplicate_message'));
  });

  // ---- §9: reconnect + queued approval.decision ----
  await t.test('after reconnect, queued decisions are acked; one already processed is not processed again', async () => {
    const { deviceId, deviceToken, client } = await h.onlineDevice();
    const sentBefore = ids.ulid();
    const p = (n) => ({ approvalId: `appr_q${n}`, decision: 'approved', decidedBy: 'staff_1' });
    client.send('approval.decision', p(0), sentBefore);
    await client.next((m) => m.type === 'ack');
    client.ws.terminate(); // network drop
    await client.closed();

    const again = await h.connect(deviceToken);
    await again.hello(deviceId);
    // The Shop's local queue resends everything it is unsure about, incl. the one already acked.
    const queue = [[sentBefore, p(0)], [ids.ulid(), p(1)], [ids.ulid(), p(2)]];
    for (const [id, payload] of queue) again.send('approval.decision', payload, id);
    for (const [id] of queue) await again.next((m) => m.type === 'ack' && m.payload.refId === id);
    const received = (await h.hub.audit.recent(100)).filter((e) => e.action === 'approval.decision.received');
    assert.deepEqual(received.map((e) => e.target).sort(), ['appr_q0', 'appr_q1', 'appr_q2']);
  });

  await t.test('a second connection for the same device replaces the first (4409)', async () => {
    const { deviceId, deviceToken, client } = await h.onlineDevice();
    const second = await h.connect(deviceToken);
    await second.hello(deviceId);
    assert.equal((await client.closed()).code, CLOSE.REPLACED);
    assert.equal(h.hub.bridge.isOnline(deviceId), true);
  });

  // ---- heartbeat ----
  await t.test('no message within the heartbeat timeout → closed and offline', async () => {
    await h.close();
    h = await startHub({ bridgeOptions: { heartbeatTimeoutMs: 150 } });
    const { deviceId, client } = await h.onlineDevice();
    for (let i = 0; i < 4; i++) {
      await sleep(80);
      client.send('heartbeat', {});
    }
    assert.equal(h.hub.bridge.isOnline(deviceId), true, 'heartbeats keep it online');
    assert.equal((await client.closed()).code, CLOSE.HEARTBEAT_TIMEOUT);
    assert.equal(h.hub.bridge.isOnline(deviceId), false);
  });

  // ---- revoke ----
  await t.test('revoke closes the live connection immediately (4401) and the token stops working', async () => {
    const { deviceId, deviceToken, client } = await h.onlineDevice();
    const admin = await h.adminLogin();
    const started = Date.now();
    assert.equal((await admin('POST', `/devices/${deviceId}/revoke`)).status, 200);
    const closed = await client.closed();
    assert.equal(closed.code, CLOSE.REVOKED);
    assert.ok(Date.now() - started < 1500, 'closed right away');
    assert.equal(h.hub.bridge.isOnline(deviceId), false);
    await assert.rejects(h.connect(deviceToken), { status: 401 });
    const { rows } = await h.db.query('SELECT token_hash, revoked_at FROM devices WHERE device_id = $1', [deviceId]);
    assert.equal(rows[0].token_hash, null);
    assert.ok(rows[0].revoked_at);
  });

  // ---- §9: token rotate ----
  await t.test('token.rotate keeps the connection; new token works; old one works for 5 minutes only', async () => {
    const { deviceId, deviceToken, client } = await h.onlineDevice();
    const r = await h.hub.bridge.rotateToken(deviceId);
    assert.deepEqual(r, { rotated: true, delivered: true });
    const msg = await client.next((m) => m.type === 'token.rotate');
    const { newToken } = msg.payload;
    assert.match(newToken, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(newToken, deviceToken);

    // Connection is still usable after the rotate.
    client.send('snapshot', snapshot(h.clock, 1));
    await client.flush();
    assert.equal(h.hub.bridge.isOnline(deviceId), true);

    // Reconnect with the new token.
    const viaNew = await h.connect(newToken);
    await viaNew.hello(deviceId);
    viaNew.ws.close();
    await viaNew.closed();

    // Old token: accepted within the 5-minute grace, refused after.
    h.clock.advance(4 * 60 * 1000);
    const viaOld = await h.connect(deviceToken);
    viaOld.ws.close();
    await viaOld.closed();
    h.clock.advance(60 * 1000 + 1);
    await assert.rejects(h.connect(deviceToken), { status: 401 });
    const viaNewLater = await h.connect(newToken);
    await viaNewLater.hello(deviceId);
  });

  await t.test('token.rotate is resent until the retry limit (no Shop→Cloud ack in protocol v1)', async () => {
    await h.close();
    h = await startHub({ bridgeOptions: { ackTimeoutMs: 50, maxSendAttempts: 3 } });
    const { deviceId, client } = await h.onlineDevice();
    await h.hub.bridge.rotateToken(deviceId);
    const first = await client.next((m) => m.type === 'token.rotate');
    const second = await client.next((m) => m.type === 'token.rotate');
    const third = await client.next((m) => m.type === 'token.rotate');
    assert.equal(first.id, second.id, 'same id → Shop can dedupe');
    assert.equal(second.id, third.id);
    assert.equal(first.payload.newToken, third.payload.newToken);
    await assert.rejects(client.next((m) => m.type === 'token.rotate', 200));
    assert.ok(h.logger.has('bridge.ack_timeout'));
  });

  // ---- kill switch: bridge ----
  await t.test('bridge kill switch off → live connections closed (4503) and new upgrades refused', async () => {
    const { deviceToken, client } = await h.onlineDevice();
    await h.hub.killSwitches.set('bridge', false);
    assert.equal((await client.closed()).code, CLOSE.BRIDGE_DISABLED);
    await assert.rejects(h.connect(deviceToken), { status: 503 });
    await h.hub.killSwitches.set('bridge', true);
    const c = await h.connect(deviceToken);
    c.ws.close();
  });

  // ---- outgoing messages are strict too ----
  await t.test('hub never sends a type outside the Cloud→Shop allowlist', async () => {
    const { client } = await h.onlineDevice();
    const allowed = new Set(['hello.ack', 'ack', 'approval.created', 'approval.updated', 'token.rotate']);
    client.send('heartbeat', {});
    await client.flush();
    assert.ok(client.inbox.every((m) => allowed.has(m.type)));
  });
});
