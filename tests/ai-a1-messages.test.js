'use strict';

// Task A1 — Envelope, ApprovalItem and per-type message schemas (BRIDGE_PROTOCOL §4, §5, §7).
const test = require('node:test');
const assert = require('node:assert/strict');
const bp = require('../packages/bridge-protocol');
const fx = require('./ai-a1-fixtures');

const ok = (schema, data) => {
  const r = schema.safeParse(data);
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
};
const bad = (schema, data) => assert.equal(schema.safeParse(data).success, false);

test('A1 exports Envelope, Snapshot, ApprovalItem and every allowlisted type', () => {
  assert.equal(typeof bp.Envelope, 'function');
  assert.ok(bp.Snapshot);
  assert.ok(bp.ApprovalItem);
  // `ack` Shop → Cloud: Gate G6 approved by the owner 2026-11-22 (Task A3).
  assert.deepEqual(Object.keys(bp.SHOP_TO_CLOUD).sort(), ['ack', 'approval.decision', 'heartbeat', 'hello', 'snapshot']);
  assert.deepEqual(
    Object.keys(bp.CLOUD_TO_SHOP).sort(),
    ['ack', 'approval.created', 'approval.updated', 'hello.ack', 'token.rotate'],
  );
  assert.deepEqual(
    Object.keys(bp.MESSAGE_SCHEMAS).sort(),
    [...new Set([...Object.keys(bp.SHOP_TO_CLOUD), ...Object.keys(bp.CLOUD_TO_SHOP)])].sort(),
  );
});

test('A1 envelope: valid envelope for every type passes', () => {
  for (const [type, payload] of Object.entries(fx.validPayloads())) {
    ok(bp.MESSAGE_SCHEMAS[type], fx.envelope(type, payload));
  }
});

test('A1 envelope: wrong v, id, ts, type or extra field is rejected', () => {
  const schema = bp.Envelope('heartbeat', bp.HeartbeatPayload);
  bad(schema, fx.envelope('heartbeat', {}, { v: 2 }));
  bad(schema, fx.envelope('heartbeat', {}, { id: 'not-a-ulid' }));
  bad(schema, fx.envelope('heartbeat', {}, { id: '01JD000000000000000000000I' })); // I is not Crockford
  bad(schema, fx.envelope('heartbeat', {}, { ts: '2026-11-22' }));
  bad(schema, fx.envelope('hello', {}));
  bad(schema, { ...fx.envelope('heartbeat', {}), extra: true });
  bad(schema, { v: 1, type: 'heartbeat', id: fx.ULID_A, ts: '2026-11-22T15:00:00Z' }); // no payload
});

test('A1 ApprovalItem: all three payload kinds pass', () => {
  ok(bp.ApprovalItem, fx.validBookingItem());
  ok(bp.ApprovalItem, fx.validPostItem());
  ok(bp.ApprovalItem, fx.validCommentItem());
});

test('A1 ApprovalItem: extra fields, kind mismatch and bad values are rejected', () => {
  const cases = [
    (i) => { i.extra = 1; },
    (i) => { i.payload.extra = 1; },
    (i) => { i.payload.customerPhone = '0812345678'; },
    (i) => { i.kind = 'post'; },                       // kind != payload.kind
    (i) => { i.payload.kind = 'refund'; },
    (i) => { i.payload.phoneMasked = '0812345678'; }, // full number
    (i) => { i.payload.phoneMasked = '***-***-12345'; },
    (i) => { i.payload.partySize = 0; },
    (i) => { i.payload.time = '8pm'; },
    (i) => { i.payload.date = '23/11/2026'; },
    (i) => { i.expiresAt = i.createdAt; },
    (i) => { i.summary = ''; },
  ];
  for (const mutate of cases) {
    const item = fx.validBookingItem();
    mutate(item);
    bad(bp.ApprovalItem, item);
  }
  const post = fx.validPostItem();
  post.payload.mediaUrls = ['http://insecure.example.com/a.png'];
  bad(bp.ApprovalItem, post);
});

test('A1 ApprovalStatus and RejectReasonCode match the spec', () => {
  assert.deepEqual(bp.ApprovalStatus.options, ['pending', 'approved', 'rejected', 'expired', 'cancelled', 'done']);
  assert.deepEqual(bp.RejectReasonCode.options, ['table_full', 'closed', 'wrong_info', 'off_brand', 'wrong_numbers', 'other']);
});

test('A1 hello: protocolVersion, timezone and deviceId are enforced', () => {
  const p = fx.validPayloads().hello;
  ok(bp.HelloPayload, p);
  bad(bp.HelloPayload, { ...p, protocolVersion: 2 });
  bad(bp.HelloPayload, { ...p, timezone: 'UTC' });
  bad(bp.HelloPayload, { ...p, deviceId: 'abc' });
  bad(bp.HelloPayload, { ...p, deviceIp: '192.168.1.10' });
});

test('A1 heartbeat: payload must be an empty object', () => {
  ok(bp.HeartbeatPayload, {});
  bad(bp.HeartbeatPayload, { load: 1 });
});

test('A1 approval.decision: reason rules and opaque staff id', () => {
  const S = bp.ApprovalDecisionPayload;
  ok(S, { approvalId: 'apr_1', decision: 'rejected', reasonCode: 'table_full', decidedBy: 'staff_7' });
  ok(S, { approvalId: 'apr_1', decision: 'approved', decidedBy: 'staff_7', note: 'ok',
    editedPayload: fx.validPostItem().payload });
  bad(S, { approvalId: 'apr_1', decision: 'rejected', decidedBy: 'staff_7' });             // missing reason
  bad(S, { approvalId: 'apr_1', decision: 'approved', reasonCode: 'other', decidedBy: 'staff_7' });
  bad(S, { approvalId: 'apr_1', decision: 'rejected', reasonCode: 'other', decidedBy: 'staff_7',
    editedPayload: fx.validPostItem().payload });
  bad(S, { approvalId: 'apr_1', decision: 'maybe', decidedBy: 'staff_7' });
  bad(S, { approvalId: 'apr_1', decision: 'approved', decidedBy: 'staff_7', staffName: 'สมหญิง' });
  bad(S, { approvalId: 'apr_1', decision: 'approved', decidedBy: 'x'.repeat(65) });
});

test('A1 Cloud -> Shop payloads', () => {
  ok(bp.HelloAckPayload, { serverTime: '2026-11-22T15:00:00Z', snapshotIntervalSec: 30 });
  bad(bp.HelloAckPayload, { serverTime: '2026-11-22T15:00:00Z', snapshotIntervalSec: 0 });
  ok(bp.AckPayload, { refId: fx.ULID_B });
  bad(bp.AckPayload, { refId: 'x' });
  ok(bp.ApprovalUpdatedPayload, { approvalId: 'apr_1', status: 'expired' });
  bad(bp.ApprovalUpdatedPayload, { approvalId: 'apr_1', status: 'deleted' });
  ok(bp.TokenRotatePayload, { newToken: fx.TOKEN });
  bad(bp.TokenRotatePayload, { newToken: 'short' });
  bad(bp.TokenRotatePayload, { newToken: fx.TOKEN, oldToken: fx.TOKEN });
});

test('A1 ACK_REQUIRED matches the ack column of §5', () => {
  assert.deepEqual({ ...bp.ACK_REQUIRED }, {
    hello: 'hello.ack',
    'approval.decision': 'ack',
    'approval.created': 'ack',
    'approval.updated': 'ack',
    'token.rotate': 'ack',
  });
});
