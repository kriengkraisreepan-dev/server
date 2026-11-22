'use strict';

// Envelope — BRIDGE_PROTOCOL §4.
const { z } = require('zod');
const { PROTOCOL_VERSION, Ulid, IsoUtc } = require('./primitives');

/**
 * Outer envelope with the payload left unchecked. The central parser uses it to read
 * `type` safely before choosing the payload schema from the allowlist.
 */
const BaseEnvelope = z.strictObject({
  v: z.literal(PROTOCOL_VERSION),
  type: z.string().min(1).max(64),
  id: Ulid,
  ts: IsoUtc,
  payload: z.unknown(),
});

/**
 * Build the envelope schema for one message type.
 * @template {string} T
 * @template {z.ZodType} P
 * @param {T} type
 * @param {P} payload
 */
function Envelope(type, payload) {
  return z.strictObject({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal(type),
    id: Ulid,
    ts: IsoUtc,
    payload,
  });
}

module.exports = { BaseEnvelope, Envelope };
