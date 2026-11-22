'use strict';

// Test harness: a real hub (Express + ws) on an ephemeral port, backed by in-process PGlite.
const WebSocket = require('ws');
const { createHub } = require('../src/app');
const { hashPassword } = require('../src/admin/auth');
const { openDatabase } = require('../src/db');
const ids = require('../src/ids');

const ADMIN_PASSWORD = 'correct horse battery';
const ADMIN_HASH = hashPassword(ADMIN_PASSWORD, { N: 1024 });

function makeClock(start = Date.parse('2026-11-22T15:00:00.000Z')) {
  return {
    t: start,
    now() {
      return this.t;
    },
    advance(ms) {
      this.t += ms;
    },
  };
}

function captureLogger() {
  const events = [];
  const push = (level) => (event, detail = {}) => events.push({ level, event, ...detail });
  return { events, info: push('info'), warn: push('warn'), error: push('error'), has: (e) => events.some((x) => x.event === e) };
}

/**
 * PGlite by default. Set TEST_DATABASE_URL to run the same tests against real Postgres:
 * each hub then gets its own throwaway schema so parallel test files do not collide.
 */
async function testDatabase() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return openDatabase();
  const schema = 't_' + require('node:crypto').randomBytes(6).toString('hex');
  const admin = await openDatabase({ databaseUrl: url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.close();
  const u = new URL(url);
  u.searchParams.set('options', `-c search_path=${schema}`);
  const db = await openDatabase({ databaseUrl: u.toString() });
  const close = db.close;
  db.close = async () => {
    await close();
    const a = await openDatabase({ databaseUrl: url });
    await a.query(`DROP SCHEMA ${schema} CASCADE`);
    await a.close();
  };
  return db;
}

async function startHub({ bridgeOptions = {}, clock = makeClock() } = {}) {
  const db = await testDatabase();
  const logger = captureLogger();
  const config = {
    port: 0,
    host: '127.0.0.1',
    adminPasswordHash: ADMIN_HASH,
    publicWsUrl: 'ws://127.0.0.1/bridge/v1',
    trustProxy: 0,
    secureCookies: false,
  };
  const hub = await createHub(config, { db, clock, logger, bridgeOptions: { heartbeatTimeoutMs: 60000, ackTimeoutMs: 10000, ...bridgeOptions } });
  const addr = await hub.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}`;
  const wsUrl = `ws://127.0.0.1:${addr.port}/bridge/v1`;
  const sockets = new Set();

  const h = {
    hub, db, clock, logger, base, wsUrl,

    async http(method, path, { body, headers = {} } = {}) {
      const res = await fetch(base + path, {
        method,
        headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
        body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
        redirect: 'manual',
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* not json */ }
      return { status: res.status, headers: res.headers, json, text };
    },

    async adminLogin() {
      const r = await h.http('POST', '/admin/api/login', { body: { password: ADMIN_PASSWORD }, headers: { 'x-hub-admin': '1' } });
      if (r.status !== 200) throw new Error('login failed ' + r.status);
      const cookie = r.headers.get('set-cookie').split(';')[0];
      return (method, path, body) => h.http(method, '/admin/api' + path, { body, headers: { 'x-hub-admin': '1', cookie } });
    },

    async newCode() {
      return (await hub.devices.createPairingCode('test')).code;
    },

    async pairDevice(name = 'Front desk PC') {
      const code = await h.newCode();
      const r = await h.http('POST', '/bridge/v1/pair', { body: { pairingCode: code, deviceName: name, appVersion: '1.0.36' } });
      if (r.status !== 200) throw new Error('pair failed ' + r.status + ' ' + r.text);
      return r.json;
    },

    /** Open a bridge socket. Resolves with a client, or rejects with the HTTP status of a refused upgrade. */
    connect(token) {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl, { headers: token ? { authorization: `Bearer ${token}` } : {} });
        sockets.add(ws);
        const client = makeClient(ws);
        ws.once('open', () => resolve(client));
        ws.once('unexpected-response', (req, res) => {
          const e = new Error('upgrade refused ' + res.statusCode);
          e.status = res.statusCode;
          reject(e);
        });
        ws.once('error', (err) => reject(err));
      });
    },

    /** Pair + connect + hello. */
    async onlineDevice(name) {
      const paired = await h.pairDevice(name);
      const c = await h.connect(paired.deviceToken);
      await c.hello(paired.deviceId);
      return { ...paired, client: c };
    },

    async close() {
      for (const ws of sockets) ws.terminate();
      await hub.close();
      await db.close();
    },
  };
  return h;
}

function makeClient(ws) {
  const inbox = [];
  const waiters = [];
  let closed = null;
  const closeWaiters = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString('utf8'));
    inbox.push(msg);
    for (const w of [...waiters]) if (w.match(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
  });
  ws.on('close', (code, reason) => {
    closed = { code, reason: reason.toString() };
    for (const w of closeWaiters.splice(0)) w(closed);
  });
  const client = {
    ws,
    inbox,
    send(type, payload, id = ids.ulid()) {
      ws.send(JSON.stringify({ v: 1, type, id, ts: new Date().toISOString(), payload }));
      return id;
    },
    raw(text) {
      ws.send(text);
    },
    next(match = () => true, timeoutMs = 2000) {
      const found = inbox.find(match);
      if (found) { inbox.splice(inbox.indexOf(found), 1); return Promise.resolve(found); }
      return new Promise((resolve, reject) => {
        const w = { match, resolve: (m) => { clearTimeout(t); inbox.splice(inbox.indexOf(m), 1); resolve(m); } };
        const t = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error('timeout waiting for message')); }, timeoutMs);
        waiters.push(w);
      });
    },
    async hello(deviceId) {
      client.send('hello', { deviceId, appVersion: '1.0.36', protocolVersion: 1, timezone: 'Asia/Bangkok' });
      return client.next((m) => m.type === 'hello.ack');
    },
    closed(timeoutMs = 3000) {
      if (closed) return Promise.resolve(closed);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout waiting for close')), timeoutMs);
        closeWaiters.push((c) => { clearTimeout(t); resolve(c); });
      });
    },
    /** Round-trip barrier: everything sent before this has been processed by the hub. */
    async flush(deviceId) {
      const id = client.send('approval.decision', { approvalId: 'flush_' + ids.ulid(), decision: 'approved', decidedBy: 'staff_test' });
      await client.next((m) => m.type === 'ack' && m.payload.refId === id);
      void deviceId;
    },
  };
  return client;
}

function snapshot(clock, seq = 1, extra = {}) {
  return {
    seq,
    generatedAt: new Date(clock.now()).toISOString(),
    shop: { isOpenNow: true, todayHours: { open: '12:00', close: '02:00' } },
    tables: [
      { tableNo: '1', kind: 'snooker', status: 'available' },
      { tableNo: '2', kind: 'snooker', status: 'in_use', elapsedMin: 35 },
    ],
    queue: { waiting: 0 },
    priceList: [{ kind: 'snooker', label: 'ปกติ', pricePerHourTHB: 120 }],
    promotions: [],
    ...extra,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { testDatabase, startHub, makeClock, snapshot, sleep, ADMIN_PASSWORD };
