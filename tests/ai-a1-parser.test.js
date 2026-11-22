'use strict';

// Task A1 — central parser (BRIDGE_PROTOCOL §3, §5; SAFETY S-1.3).
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMessage, serializeMessage, MAX_MESSAGE_BYTES, REJECT_CODES } = require('../packages/bridge-protocol');
const fx = require('./ai-a1-fixtures');

const SHOP_TYPES = ['hello', 'heartbeat', 'snapshot', 'approval.decision'];
const CLOUD_TYPES = ['hello.ack', 'ack', 'approval.created', 'approval.updated', 'token.rotate'];

const wire = (type, payload, overrides) => JSON.stringify(fx.envelope(type, payload, overrides));

test('A1 parser: every allowed type parses in its own direction', () => {
  const payloads = fx.validPayloads();
  for (const type of SHOP_TYPES) {
    const r = parseMessage(wire(type, payloads[type]), { direction: 'shop_to_cloud' });
    assert.equal(r.ok, true, `${type}: ${JSON.stringify(r)}`);
    assert.equal(r.message.type, type);
  }
  for (const type of CLOUD_TYPES) {
    const r = parseMessage(wire(type, payloads[type]), { direction: 'cloud_to_shop' });
    assert.equal(r.ok, true, `${type}: ${JSON.stringify(r)}`);
  }
});

test('A1 parser S-1.3: unknown types are rejected as unknown_type', () => {
  const unknown = ['relay.toggle', 'table.open', 'bill.void', 'ota.update', 'firmware.flash', 'exec', 'SNAPSHOT', 'hello '];
  for (const type of unknown) {
    for (const direction of ['shop_to_cloud', 'cloud_to_shop']) {
      const r = parseMessage(wire(type, {}), { direction });
      assert.equal(r.ok, false);
      assert.equal(r.code, REJECT_CODES.UNKNOWN_TYPE, type);
      assert.equal(r.type, type);
      assert.equal(r.id, fx.ULID_A);
    }
  }
});

test('A1 parser S-1.3: a type from the other direction is unknown', () => {
  const payloads = fx.validPayloads();
  for (const type of SHOP_TYPES) {
    assert.equal(parseMessage(wire(type, payloads[type]), { direction: 'cloud_to_shop' }).code, 'unknown_type');
  }
  for (const type of CLOUD_TYPES) {
    assert.equal(parseMessage(wire(type, payloads[type]), { direction: 'shop_to_cloud' }).code, 'unknown_type');
  }
});

test('A1 parser: prototype keys are not treated as allowed types', () => {
  for (const type of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    const r = parseMessage(wire(type, {}), { direction: 'cloud_to_shop' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'unknown_type');
  }
});

test('A1 parser: envelope problems are invalid_envelope', () => {
  const d = { direction: 'cloud_to_shop' };
  assert.equal(parseMessage(wire('ack', { refId: fx.ULID_B }, { v: 2 }), d).code, 'invalid_envelope');
  assert.equal(parseMessage(wire('ack', { refId: fx.ULID_B }, { id: 'abc' }), d).code, 'invalid_envelope');
  assert.equal(parseMessage(JSON.stringify({ ...fx.envelope('ack', { refId: fx.ULID_B }), cmd: 'x' }), d).code, 'invalid_envelope');
  assert.equal(parseMessage('[]', d).code, 'invalid_envelope');
  assert.equal(parseMessage('null', d).code, 'invalid_envelope');
  assert.equal(parseMessage(JSON.stringify({ v: 1, id: fx.ULID_A, ts: '2026-11-22T15:00:00Z', payload: {} }), d).code, 'invalid_envelope');
});

test('A1 parser: bad payloads are invalid_payload', () => {
  const r = parseMessage(wire('token.rotate', { newToken: 'short' }), { direction: 'cloud_to_shop' });
  assert.equal(r.code, 'invalid_payload');
  assert.equal(r.type, 'token.rotate');
  assert.ok(Array.isArray(r.issues) && r.issues.length > 0);
  assert.equal(JSON.stringify(r).includes('short'), false, 'rejected values are not echoed');
});

test('A1 parser: bad JSON, wrong input types and oversize messages are rejected', () => {
  const d = { direction: 'shop_to_cloud' };
  assert.equal(parseMessage('{not json', d).code, 'bad_json');
  assert.equal(parseMessage({ v: 1 }, d).code, 'invalid_input');
  assert.equal(parseMessage(undefined, d).code, 'invalid_input');
  const big = wire('heartbeat', {}).replace('{}', `{"x":"${'a'.repeat(MAX_MESSAGE_BYTES)}"}`);
  assert.equal(parseMessage(big, d).code, 'too_large');
  assert.equal(parseMessage(Buffer.from(big), d).code, 'too_large');
});

test('A1 parser: Buffer input works', () => {
  const r = parseMessage(Buffer.from(wire('heartbeat', {})), { direction: 'shop_to_cloud' });
  assert.equal(r.ok, true);
});

test('A1 parser: direction is required', () => {
  assert.throws(() => parseMessage(wire('heartbeat', {})), TypeError);
  assert.throws(() => parseMessage(wire('heartbeat', {}), { direction: 'sideways' }), TypeError);
});

test('A1 serializeMessage: round-trips and refuses unknown types', () => {
  const json = serializeMessage('heartbeat', {}, { direction: 'shop_to_cloud', id: fx.ULID_A });
  const r = parseMessage(json, { direction: 'shop_to_cloud' });
  assert.equal(r.ok, true);
  assert.equal(r.message.v, 1);
  assert.throws(() => serializeMessage('relay.toggle', {}, { direction: 'cloud_to_shop', id: fx.ULID_A }),
    (e) => e.code === 'unknown_type');
  assert.throws(() => serializeMessage('heartbeat', {}, { direction: 'shop_to_cloud', id: 'nope' }),
    (e) => e.code === 'invalid_envelope');
});
