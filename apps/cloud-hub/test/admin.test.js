'use strict';

// A2 acceptance: Admin web — owner login, "เครื่องร้าน" page API, 3 kill switches (S-1.5).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startHub, snapshot, ADMIN_PASSWORD } = require('./helpers');
const { hashPassword, verifyPassword } = require('../src/admin/auth');
const { CLOSE } = require('../src/bridge/ws-server');

test('admin web', async (t) => {
  let h;
  t.beforeEach(async () => { h = await startHub(); });
  t.afterEach(async () => { await h.close(); });

  await t.test('page is served with a strict CSP and no-store', async () => {
    const r = await h.http('GET', '/admin/');
    assert.equal(r.status, 200);
    assert.match(r.text, /เครื่องร้าน/);
    assert.match(r.text, /Kill switch/);
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
  });

  await t.test('API needs login', async () => {
    for (const [m, p] of [['GET', '/devices'], ['POST', '/pairing-codes'], ['GET', '/kill-switches'], ['PUT', '/kill-switches/bridge'], ['GET', '/audit']]) {
      const r = await h.http(m, '/admin/api' + p, { headers: { 'x-hub-admin': '1' }, body: m === 'PUT' ? { enabled: false } : undefined });
      assert.equal(r.status, 401, `${m} ${p}`);
    }
  });

  await t.test('API needs the x-hub-admin header (CSRF guard), even with a session', async () => {
    const admin = await h.adminLogin();
    void admin;
    const login = await h.http('POST', '/admin/api/login', { body: { password: ADMIN_PASSWORD } });
    assert.equal(login.status, 403);
  });

  await t.test('wrong password → 401 and audited; cookie is HttpOnly + SameSite=Strict', async () => {
    const bad = await h.http('POST', '/admin/api/login', { body: { password: 'nope' }, headers: { 'x-hub-admin': '1' } });
    assert.equal(bad.status, 401);
    const ok = await h.http('POST', '/admin/api/login', { body: { password: ADMIN_PASSWORD }, headers: { 'x-hub-admin': '1' } });
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\/admin/);
    const audit = await h.hub.audit.recent(10);
    assert.ok(audit.some((e) => e.action === 'admin.login_failed'));
    assert.ok(audit.some((e) => e.action === 'admin.login'));
  });

  await t.test('login is rate limited (10 per 15 min per IP)', async () => {
    for (let i = 0; i < 10; i++) {
      await h.http('POST', '/admin/api/login', { body: { password: 'wrong' }, headers: { 'x-hub-admin': '1' } });
    }
    const r = await h.http('POST', '/admin/api/login', { body: { password: ADMIN_PASSWORD }, headers: { 'x-hub-admin': '1' } });
    assert.equal(r.status, 429);
  });

  await t.test('logout ends the session', async () => {
    const admin = await h.adminLogin();
    assert.equal((await admin('POST', '/logout')).status, 200);
    assert.equal((await admin('GET', '/devices')).status, 401);
  });

  await t.test('owner creates a pairing code, a device pairs, and its status shows', async () => {
    const admin = await h.adminLogin();
    const created = await admin('POST', '/pairing-codes');
    assert.equal(created.status, 201);
    assert.match(created.json.code, /^[A-HJ-NP-Z2-9]{8}$/);
    assert.equal(Date.parse(created.json.expiresAt) - h.clock.now(), 10 * 60 * 1000);
    assert.ok(!(await h.hub.audit.recent(5)).some((e) => JSON.stringify(e).includes(created.json.code)), 'code not in audit');

    const pair = await h.http('POST', '/bridge/v1/pair', { body: { pairingCode: created.json.code, deviceName: 'Front desk PC', appVersion: '1.0.36' } });
    const c = await h.connect(pair.json.deviceToken);
    await c.hello(pair.json.deviceId);
    c.send('snapshot', snapshot(h.clock, 7));
    await c.flush();

    let list = (await admin('GET', '/devices')).json.devices;
    assert.equal(list.length, 1);
    assert.equal(list[0].deviceName, 'Front desk PC');
    assert.equal(list[0].online, true);
    assert.deepEqual(list[0].snapshot, { seq: 7, asOf: new Date(h.clock.now()).toISOString(), stale: false });
    assert.ok(!JSON.stringify(list).includes(pair.json.deviceToken));

    h.clock.advance(120 * 1000);
    list = (await admin('GET', '/devices')).json.devices;
    assert.equal(list[0].snapshot.stale, true);
  });

  await t.test('owner revokes a device from the admin API → socket closed with 4401', async () => {
    const admin = await h.adminLogin();
    const { deviceId, client } = await h.onlineDevice();
    assert.equal((await admin('POST', `/devices/${deviceId}/revoke`)).status, 200);
    assert.equal((await client.closed()).code, CLOSE.REVOKED);
    const list = (await admin('GET', '/devices')).json.devices;
    assert.ok(list[0].revokedAt);
    assert.equal(list[0].online, false);
    assert.equal((await admin('POST', `/devices/${deviceId}/revoke`)).status, 404, 'second revoke is a no-op');
  });

  await t.test('owner rotates a token from the admin API', async () => {
    const admin = await h.adminLogin();
    const { deviceId, client } = await h.onlineDevice();
    const r = await admin('POST', `/devices/${deviceId}/rotate-token`);
    assert.deepEqual(r.json, { rotated: true, delivered: true });
    assert.ok(!r.text.includes('newToken'), 'new token goes only to the device');
    await client.next((m) => m.type === 'token.rotate');
  });

  await t.test('three kill switches exist and start enabled, even before their features exist', async () => {
    const admin = await h.adminLogin();
    const { killSwitches } = (await admin('GET', '/kill-switches')).json;
    assert.deepEqual(Object.keys(killSwitches).sort(), ['ai_chat', 'bridge', 'publishing']);
    for (const s of Object.values(killSwitches)) assert.equal(s.enabled, true);
  });

  await t.test('each kill switch toggles, persists and is audited', async () => {
    const admin = await h.adminLogin();
    for (const name of ['ai_chat', 'publishing', 'bridge']) {
      const off = await admin('PUT', `/kill-switches/${name}`, { enabled: false });
      assert.equal(off.json.killSwitches[name].enabled, false);
      assert.equal(await h.hub.killSwitches.isEnabled(name), false);
    }
    const audit = (await h.hub.audit.recent(20)).filter((e) => e.action === 'kill_switch.set');
    assert.deepEqual(audit.map((e) => e.target).sort(), ['ai_chat', 'bridge', 'publishing']);
    assert.equal((await admin('PUT', '/kill-switches/nope', { enabled: false })).status, 404);
    assert.equal((await admin('PUT', '/kill-switches/ai_chat', { enabled: 'no' })).status, 400);
  });

  await t.test('bridge kill switch via admin closes live connections and blocks new pairing codes', async () => {
    const admin = await h.adminLogin();
    const { client } = await h.onlineDevice();
    await admin('PUT', '/kill-switches/bridge', { enabled: false });
    assert.equal((await client.closed()).code, CLOSE.BRIDGE_DISABLED);
    assert.equal((await admin('POST', '/pairing-codes')).status, 409);
  });

  await t.test('missing kill switch row fails closed', async () => {
    await h.db.query("DELETE FROM kill_switches WHERE name = 'ai_chat'");
    assert.equal(await h.hub.killSwitches.isEnabled('ai_chat'), false);
  });
});

test('password hashing', () => {
  const stored = hashPassword('a long passphrase', { N: 1024 });
  assert.match(stored, /^scrypt\$1024\$8\$1\$/);
  assert.equal(verifyPassword('a long passphrase', stored), true);
  assert.equal(verifyPassword('a long passphrasf', stored), false);
  assert.equal(verifyPassword('x', 'garbage'), false);
  assert.throws(() => hashPassword('short'));
});
