'use strict';

// A2 acceptance: pairing per BRIDGE_PROTOCOL §2, incl. rate limit and single-use codes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startHub } = require('./helpers');
const { PAIRING_ALPHABET } = require('../src/ids');

const body = (pairingCode, extra = {}) => ({ pairingCode, deviceName: 'Front desk PC', appVersion: '1.0.36', ...extra });

test('pairing', async (t) => {
  let h;
  t.beforeEach(async () => { h = await startHub(); });
  t.afterEach(async () => { await h.close(); });

  await t.test('code is 8 chars from A–Z/2–9 without O, 0, I, 1', async () => {
    assert.equal(PAIRING_ALPHABET.length, 32);
    for (const ch of 'O0I1') assert.ok(!PAIRING_ALPHABET.includes(ch));
    for (let i = 0; i < 200; i++) assert.match(await h.newCode(), /^[A-HJ-NP-Z2-9]{8}$/);
  });

  await t.test('valid code pairs and returns deviceId, 32-byte base64url token, hubUrl', async () => {
    const code = await h.newCode();
    const r = await h.http('POST', '/bridge/v1/pair', { body: body(code) });
    assert.equal(r.status, 200);
    assert.match(r.json.deviceId, /^dev_/);
    assert.match(r.json.deviceToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(r.json.deviceToken, 'base64url').length, 32);
    assert.equal(r.json.hubUrl, 'ws://127.0.0.1/bridge/v1');
    assert.deepEqual(Object.keys(r.json).sort(), ['deviceId', 'deviceToken', 'hubUrl']);
  });

  await t.test('a code can be used only once', async () => {
    const code = await h.newCode();
    assert.equal((await h.http('POST', '/bridge/v1/pair', { body: body(code) })).status, 200);
    const again = await h.http('POST', '/bridge/v1/pair', { body: body(code) });
    assert.equal(again.status, 400);
    assert.equal(again.json.error, 'invalid_code');
  });

  await t.test('concurrent use of one code pairs exactly one device', async () => {
    const code = await h.newCode();
    const results = await Promise.all([1, 2, 3].map(() => h.http('POST', '/bridge/v1/pair', { body: body(code) })));
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    const { rows } = await h.db.query('SELECT count(*)::int AS n FROM devices');
    assert.equal(rows[0].n, 1);
  });

  await t.test('code expires after 10 minutes', async () => {
    const code = await h.newCode();
    h.clock.advance(10 * 60 * 1000 + 1);
    const r = await h.http('POST', '/bridge/v1/pair', { body: body(code) });
    assert.equal(r.status, 400);
  });

  await t.test('code still works just before 10 minutes', async () => {
    const code = await h.newCode();
    h.clock.advance(10 * 60 * 1000 - 1000);
    assert.equal((await h.http('POST', '/bridge/v1/pair', { body: body(code) })).status, 200);
  });

  await t.test('rate limit: 5 attempts per hour per IP, then 429', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await h.http('POST', '/bridge/v1/pair', { body: body('AAAAAAAA') });
      assert.equal(r.status, 400);
    }
    const code = await h.newCode();
    const blocked = await h.http('POST', '/bridge/v1/pair', { body: body(code) });
    assert.equal(blocked.status, 429);
    h.clock.advance(60 * 60 * 1000);
    // Window over. (The 5 failures in a row also cancelled outstanding codes → need a new one.)
    const fresh = await h.newCode();
    assert.equal((await h.http('POST', '/bridge/v1/pair', { body: body(fresh) })).status, 200);
  });

  await t.test('5 wrong attempts in a row cancel outstanding codes', async () => {
    const code = await h.newCode();
    // Different IPs are not possible from one test client, so call the service directly.
    for (let i = 0; i < 5; i++) {
      await assert.rejects(h.hub.devices.pair(body('ZZZZZZZZ'), { ip: `10.0.0.${i}` }), { code: 'invalid_code' });
    }
    await assert.rejects(h.hub.devices.pair(body(code), { ip: '10.0.0.9' }), { code: 'invalid_code' });
    const { rows } = await h.db.query('SELECT cancelled_at FROM pairing_codes WHERE code = $1', [code]);
    assert.ok(rows[0].cancelled_at);
    const audit = await h.hub.audit.recent(20);
    assert.ok(audit.some((e) => e.action === 'pairing_code.cancelled_all'));
  });

  await t.test('a success resets the consecutive-failure count', async () => {
    for (let i = 0; i < 4; i++) await assert.rejects(h.hub.devices.pair(body('ZZZZZZZZ'), { ip: 'x' }));
    await h.hub.devices.pair(body(await h.newCode()), { ip: 'x' });
    const later = await h.newCode();
    await assert.rejects(h.hub.devices.pair(body('ZZZZZZZZ'), { ip: 'x' }));
    await h.hub.devices.pair(body(later), { ip: 'x' });
  });

  await t.test('strict request body: extra fields and bad code format rejected', async () => {
    const code = await h.newCode();
    assert.equal((await h.http('POST', '/bridge/v1/pair', { body: body(code, { phone: '0812345678' }) })).status, 400);
    assert.equal((await h.http('POST', '/bridge/v1/pair', { body: body('k7mx2qpa') })).status, 400);
    assert.equal((await h.http('POST', '/bridge/v1/pair', { body: '{not json' })).status, 400);
  });

  await t.test('bridge kill switch off → pairing refused', async () => {
    const code = await h.newCode();
    await h.hub.killSwitches.set('bridge', false);
    const r = await h.http('POST', '/bridge/v1/pair', { body: body(code) });
    assert.equal(r.status, 503);
  });
});
