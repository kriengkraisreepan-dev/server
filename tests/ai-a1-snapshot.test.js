'use strict';

// Task A1 — Snapshot schema (BRIDGE_PROTOCOL §6, SAFETY S-2.1, S-2.2).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Snapshot, parseMessage, serializeMessage } = require('../packages/bridge-protocol');
const { validSnapshot, envelope, ULID_A } = require('./ai-a1-fixtures');

function rejects(data) {
  assert.equal(Snapshot.safeParse(data).success, false);
}

test('A1 snapshot: a valid snapshot passes', () => {
  const result = Snapshot.safeParse(validSnapshot());
  assert.equal(result.success, true, JSON.stringify(result.error?.issues));
  assert.deepEqual(result.data, validSnapshot());
});

test('A1 snapshot: minimal snapshot (closed, no tables) passes', () => {
  const s = validSnapshot();
  s.shop = { isOpenNow: false, todayHours: null };
  s.tables = [];
  s.priceList = [];
  s.promotions = [];
  assert.equal(Snapshot.safeParse(s).success, true);
});

test('A1 snapshot S-2.1: an extra field is rejected at every level', () => {
  const cases = [
    (s) => { s.extra = 1; },
    (s) => { s.shop.extra = 1; },
    (s) => { s.shop.todayHours.extra = 1; },
    (s) => { s.tables[0].extra = 1; },
    (s) => { s.queue.extra = 1; },
    (s) => { s.priceList[0].extra = 1; },
    (s) => { s.promotions[0].extra = 1; },
  ];
  for (const mutate of cases) {
    const s = validSnapshot();
    mutate(s);
    rejects(s);
  }
});

test('A1 snapshot S-2.2: PII / never-leave-the-shop fields are rejected', () => {
  const forbidden = [
    'customerName', 'name', 'phone', 'tel', 'mobile', 'memberId', 'memberName',
    'staffName', 'staffId', 'billId', 'billTotal', 'amount', 'revenue',
    'deviceId', 'deviceIp', 'ip', 'mac', 'relayChannel', 'token', 'apiKey',
  ];
  const placements = [
    (s, k) => { s[k] = 'x'; },
    (s, k) => { s.shop[k] = 'x'; },
    (s, k) => { s.tables[1][k] = 'x'; },
    (s, k) => { s.queue[k] = 'x'; },
  ];
  for (const key of forbidden) {
    for (const place of placements) {
      const s = validSnapshot();
      place(s, key);
      rejects(s);
    }
  }
});

test('A1 snapshot: queue entries with customer names are rejected', () => {
  const s = validSnapshot();
  s.queue = { waiting: 1, entries: [{ name: 'สมชาย', phone: '0812345678' }] };
  rejects(s);
});

test('A1 snapshot: wrong types, enums and formats are rejected', () => {
  const cases = [
    (s) => { s.seq = -1; },
    (s) => { s.seq = 1.5; },
    (s) => { s.generatedAt = '2026-11-22 15:00'; },
    (s) => { s.generatedAt = '2026-11-22T22:00:00+07:00'; },
    (s) => { s.shop.todayHours.open = '25:00'; },
    (s) => { s.tables[0].kind = 'carom'; },
    (s) => { s.tables[0].status = 'paused'; },
    (s) => { s.tables[0].tableNo = '12345678901'; },
    (s) => { s.tables[0].elapsedMin = 10; },          // only for in_use
    (s) => { s.tables[1].reservedFrom = '20:00'; },   // only for reserved
    (s) => { s.priceList[0].pricePerHourTHB = -5; },
    (s) => { s.promotions[0].days = [7]; },
    (s) => { s.promotions[0].validFrom = 'tomorrow'; },
    (s) => { s.shop.note = 'x'.repeat(201); },
    (s) => { s.tables = Array.from({ length: 101 }, (_, i) => ({ tableNo: String(i), kind: 'pool', status: 'available' })); },
    (s) => { delete s.queue; },
  ];
  for (const mutate of cases) {
    const s = validSnapshot();
    mutate(s);
    rejects(s);
  }
});

test('A1 snapshot S-2.1: building a snapshot message with an extra field throws', () => {
  const s = validSnapshot();
  s.tables[0].customerName = 'สมชาย';
  assert.throws(
    () => serializeMessage('snapshot', s, { direction: 'shop_to_cloud', id: ULID_A }),
    (err) => err.code === 'invalid_payload',
  );
});

test('A1 snapshot S-2.1: receiving a snapshot message with an extra field is rejected', () => {
  const s = validSnapshot();
  s.tables[0].phone = '0812345678';
  const r = parseMessage(JSON.stringify(envelope('snapshot', s)), { direction: 'shop_to_cloud' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'invalid_payload');
  // The rejected value must not leak into the result that gets logged (S-5.4).
  assert.equal(JSON.stringify(r).includes('0812345678'), false);
});
