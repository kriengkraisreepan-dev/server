'use strict';

// Message-type allowlist — BRIDGE_PROTOCOL §5.
// S-1.3 / Gate G6: these are the ONLY message types. Adding one needs the owner's approval.
// None of them carries a command that changes POS data (S-1.1).
const { z } = require('zod');
const { PROTOCOL_VERSION, Ulid, IsoUtc, DeviceToken, OpaqueId } = require('./primitives');
const { Envelope } = require('./envelope');
const { Snapshot } = require('./snapshot');
const { ApprovalItem, ApprovalPayload, ApprovalStatus, RejectReasonCode } = require('./approval');

// ---- Shop -> Cloud payloads ----

const HelloPayload = z.strictObject({
  deviceId: z.string().regex(/^dev_[A-Za-z0-9_-]{1,60}$/, 'must be a dev_ id'),
  appVersion: z.string().min(1).max(32),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  timezone: z.literal('Asia/Bangkok'),
});

const HeartbeatPayload = z.strictObject({});

const ApprovalDecisionPayload = z
  .strictObject({
    approvalId: OpaqueId,
    decision: z.enum(['approved', 'rejected']),
    reasonCode: RejectReasonCode.optional(),
    note: z.string().max(500).optional(),
    // Opaque staff id only, never a staff name (S-2 "Never": staff data).
    decidedBy: OpaqueId,
    editedPayload: ApprovalPayload.optional(),
  })
  .superRefine((d, ctx) => {
    if (d.decision === 'rejected' && d.reasonCode === undefined) {
      ctx.addIssue({ code: 'custom', path: ['reasonCode'], message: 'reasonCode is required when rejected' });
    }
    if (d.decision === 'approved' && d.reasonCode !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['reasonCode'], message: 'reasonCode is only allowed when rejected' });
    }
    if (d.decision === 'rejected' && d.editedPayload !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['editedPayload'], message: 'editedPayload is only allowed when approved' });
    }
  });

// ---- Cloud -> Shop payloads ----

const HelloAckPayload = z.strictObject({
  serverTime: IsoUtc,
  snapshotIntervalSec: z.number().int().min(5).max(300),
});

const AckPayload = z.strictObject({ refId: Ulid });

const ApprovalUpdatedPayload = z.strictObject({
  approvalId: OpaqueId,
  status: ApprovalStatus,
});

const TokenRotatePayload = z.strictObject({ newToken: DeviceToken });

/** Payload schema for every allowed type, grouped by the direction it travels. */
const SHOP_TO_CLOUD = Object.freeze({
  hello: HelloPayload,
  heartbeat: HeartbeatPayload,
  snapshot: Snapshot,
  'approval.decision': ApprovalDecisionPayload,
  // Gate G6 approved by the owner 2026-11-22: the Shop confirms Cloud messages that need an
  // ack (approval.created / approval.updated / token.rotate) — BRIDGE_PROTOCOL §4–5.
  ack: AckPayload,
});

const CLOUD_TO_SHOP = Object.freeze({
  'hello.ack': HelloAckPayload,
  ack: AckPayload,
  'approval.created': ApprovalItem,
  'approval.updated': ApprovalUpdatedPayload,
  'token.rotate': TokenRotatePayload,
});

const DIRECTIONS = Object.freeze({
  shop_to_cloud: SHOP_TO_CLOUD,
  cloud_to_shop: CLOUD_TO_SHOP,
});

/** Which reply each type expects; types not listed expect none (§5 "ack" column). */
const ACK_REQUIRED = Object.freeze({
  hello: 'hello.ack',
  'approval.decision': 'ack',
  'approval.created': 'ack',
  'approval.updated': 'ack',
  'token.rotate': 'ack',
});

function buildEnvelopes(map) {
  const out = {};
  for (const [type, payload] of Object.entries(map)) out[type] = Envelope(type, payload);
  return Object.freeze(out);
}

/** Full envelope schema for every allowed type. */
const MESSAGE_SCHEMAS = Object.freeze({
  ...buildEnvelopes(SHOP_TO_CLOUD),
  ...buildEnvelopes(CLOUD_TO_SHOP),
});

const ShopToCloudMessage = z.discriminatedUnion(
  'type',
  Object.keys(SHOP_TO_CLOUD).map((t) => MESSAGE_SCHEMAS[t]),
);
const CloudToShopMessage = z.discriminatedUnion(
  'type',
  Object.keys(CLOUD_TO_SHOP).map((t) => MESSAGE_SCHEMAS[t]),
);

/** @typedef {z.infer<typeof ShopToCloudMessage>} ShopToCloudMessageData */
/** @typedef {z.infer<typeof CloudToShopMessage>} CloudToShopMessageData */

module.exports = {
  HelloPayload,
  HeartbeatPayload,
  ApprovalDecisionPayload,
  HelloAckPayload,
  AckPayload,
  ApprovalUpdatedPayload,
  TokenRotatePayload,
  SHOP_TO_CLOUD,
  CLOUD_TO_SHOP,
  DIRECTIONS,
  ACK_REQUIRED,
  MESSAGE_SCHEMAS,
  ShopToCloudMessage,
  CloudToShopMessage,
};
