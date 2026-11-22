'use strict';

// Central parser — every message received or sent over the bridge goes through here.
// S-1.3: anything outside the allowlist for its direction is rejected with a code the
// caller logs (`bridge.unknown_message` on the Shop side). The parser never logs itself.
const { MAX_MESSAGE_BYTES, PROTOCOL_VERSION } = require('./primitives');
const { BaseEnvelope } = require('./envelope');
const { DIRECTIONS } = require('./messages');

const REJECT_CODES = Object.freeze({
  INVALID_INPUT: 'invalid_input',
  TOO_LARGE: 'too_large',
  BAD_JSON: 'bad_json',
  INVALID_ENVELOPE: 'invalid_envelope',
  UNKNOWN_TYPE: 'unknown_type',
  INVALID_PAYLOAD: 'invalid_payload',
});

function allowlistFor(direction) {
  const map = Object.prototype.hasOwnProperty.call(DIRECTIONS, direction) ? DIRECTIONS[direction] : null;
  if (!map) throw new TypeError(`direction must be one of: ${Object.keys(DIRECTIONS).join(', ')}`);
  return map;
}

// Only keep path + message so a rejected payload's values never reach a log (S-5.3, S-5.4).
function summarizeIssues(error) {
  return error.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message }));
}

function reject(code, extra) {
  return { ok: false, code, ...extra };
}

/**
 * Parse and validate one raw wire message.
 * @param {string | Buffer | Uint8Array} raw
 * @param {{ direction: 'shop_to_cloud' | 'cloud_to_shop' }} options direction the message travelled
 * @returns {{ ok: true, message: object } | { ok: false, code: string, type?: string, id?: string, issues?: object[] }}
 */
function parseMessage(raw, { direction } = {}) {
  const allowed = allowlistFor(direction);

  let text;
  if (typeof raw === 'string') text = raw;
  else if (raw instanceof Uint8Array) text = null;
  else return reject(REJECT_CODES.INVALID_INPUT);

  const bytes = text === null ? raw.byteLength : Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_MESSAGE_BYTES) return reject(REJECT_CODES.TOO_LARGE, { bytes });
  if (text === null) text = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('utf8');

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return reject(REJECT_CODES.BAD_JSON);
  }

  const env = BaseEnvelope.safeParse(data);
  if (!env.success) return reject(REJECT_CODES.INVALID_ENVELOPE, { issues: summarizeIssues(env.error) });

  const { type, id } = env.data;
  if (!Object.prototype.hasOwnProperty.call(allowed, type)) {
    return reject(REJECT_CODES.UNKNOWN_TYPE, { type, id });
  }

  const payload = allowed[type].safeParse(env.data.payload);
  if (!payload.success) {
    return reject(REJECT_CODES.INVALID_PAYLOAD, { type, id, issues: summarizeIssues(payload.error) });
  }

  return { ok: true, message: { ...env.data, payload: payload.data } };
}

class BridgeProtocolError extends Error {
  constructor(code, details) {
    super(`bridge protocol: ${code}`);
    this.name = 'BridgeProtocolError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Build and validate an outgoing message, then serialize it. Throws instead of sending
 * anything outside the schema (S-2.1: strict when building, not only when receiving).
 * @param {string} type
 * @param {unknown} payload
 * @param {{ direction: 'shop_to_cloud' | 'cloud_to_shop', id: string, ts?: string }} options
 * @returns {string} JSON ready for the socket
 */
function serializeMessage(type, payload, { direction, id, ts = new Date().toISOString() } = {}) {
  const allowed = allowlistFor(direction);
  if (!Object.prototype.hasOwnProperty.call(allowed, type)) {
    throw new BridgeProtocolError(REJECT_CODES.UNKNOWN_TYPE, { type });
  }
  const env = BaseEnvelope.safeParse({ v: PROTOCOL_VERSION, type, id, ts, payload });
  if (!env.success) throw new BridgeProtocolError(REJECT_CODES.INVALID_ENVELOPE, summarizeIssues(env.error));
  const parsed = allowed[type].safeParse(payload);
  if (!parsed.success) throw new BridgeProtocolError(REJECT_CODES.INVALID_PAYLOAD, summarizeIssues(parsed.error));

  const json = JSON.stringify({ v: PROTOCOL_VERSION, type, id, ts, payload: parsed.data });
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > MAX_MESSAGE_BYTES) throw new BridgeProtocolError(REJECT_CODES.TOO_LARGE, { bytes });
  return json;
}

module.exports = { parseMessage, serializeMessage, BridgeProtocolError, REJECT_CODES };
