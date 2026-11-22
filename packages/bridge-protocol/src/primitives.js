'use strict';

// Shared primitive schemas for bridge protocol v1 (docs/ai-assistant/BRIDGE_PROTOCOL.md).
const { z } = require('zod');

/** Envelope protocol version. Bump only together with the `/v1` path (BRIDGE_PROTOCOL §1). */
const PROTOCOL_VERSION = 1;

/** Largest message accepted on the wire, in bytes (BRIDGE_PROTOCOL §3). */
const MAX_MESSAGE_BYTES = 256 * 1024;

/** Crockford base32 ULID, 26 chars (BRIDGE_PROTOCOL §4). */
const Ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'must be a ULID');

/** ISO-8601 UTC timestamp, `Z` suffix only (BRIDGE_PROTOCOL §4). */
const IsoUtc = z.iso.datetime();

/** ISO calendar date `YYYY-MM-DD`. */
const IsoDate = z.iso.date();

/** 24h clock `HH:MM`, Thai local time. */
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM');

/** base64url of 32 random bytes = 43 chars, no padding (S-5.2). */
const DeviceToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'must be base64url of 32 bytes');

/**
 * Masked phone: at least two mask characters followed by exactly the last 4 digits,
 * e.g. `***-***-1234`. A full number can never pass (S-5.4, BRIDGE_PROTOCOL §7).
 */
const PhoneMasked = z.string().max(20).regex(/^[*xX\- ]{2,}\d{4}$/, 'must show only the last 4 digits');

/** Opaque identifier (approval, content, template, staff id). */
const OpaqueId = z.string().min(1).max(64);

const TableKind = z.enum(['snooker', 'pool']);

module.exports = {
  PROTOCOL_VERSION,
  MAX_MESSAGE_BYTES,
  Ulid,
  IsoUtc,
  IsoDate,
  HHMM,
  DeviceToken,
  PhoneMasked,
  OpaqueId,
  TableKind,
};
