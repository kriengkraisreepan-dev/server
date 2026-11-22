'use strict';

// ApprovalItem — BRIDGE_PROTOCOL §7, state machine §8.
// S-1.4: an approval is only a *request*; staff create the real booking through the normal UI.
const { z } = require('zod');
const { IsoUtc, IsoDate, HHMM, PhoneMasked, OpaqueId, TableKind } = require('./primitives');

const ApprovalKind = z.enum(['booking_request', 'post', 'comment_reply']);

/** All states of the Cloud-side approval state machine (§8). */
const ApprovalStatus = z.enum(['pending', 'approved', 'rejected', 'expired', 'cancelled', 'done']);

/** Reason codes staff must pick when rejecting (§7). */
const RejectReasonCode = z.enum(['table_full', 'closed', 'wrong_info', 'off_brand', 'wrong_numbers', 'other']);

const HttpsUrl = z.url({ protocol: /^https$/ }).max(2048);

const BookingRequestPayload = z.strictObject({
  kind: z.literal('booking_request'),
  date: IsoDate,
  time: HHMM,
  partySize: z.number().int().positive().max(50),
  tableKind: TableKind,
  displayName: z.string().min(1).max(60),
  // Full phone numbers never cross the bridge (§7, S-5.4).
  phoneMasked: PhoneMasked.optional(),
  channel: z.string().min(1).max(30),
  note: z.string().max(500).optional(),
});

const PostPayload = z.strictObject({
  kind: z.literal('post'),
  contentId: OpaqueId,
  caption: z.string().max(5000),
  mediaUrls: z.array(HttpsUrl).max(10),
  scheduledAt: IsoUtc.optional(),
  templateId: OpaqueId,
});

const CommentReplyPayload = z.strictObject({
  kind: z.literal('comment_reply'),
  postUrl: HttpsUrl,
  commentText: z.string().max(8000),
  draftReply: z.string().max(8000),
});

const ApprovalPayload = z.discriminatedUnion('kind', [BookingRequestPayload, PostPayload, CommentReplyPayload]);

const ApprovalItem = z
  .strictObject({
    approvalId: OpaqueId,
    kind: ApprovalKind,
    createdAt: IsoUtc,
    expiresAt: IsoUtc,
    summary: z.string().min(1).max(200),
    payload: ApprovalPayload,
  })
  .superRefine((item, ctx) => {
    if (item.payload.kind !== item.kind) {
      ctx.addIssue({ code: 'custom', path: ['payload', 'kind'], message: 'payload.kind must match kind' });
    }
    if (Date.parse(item.expiresAt) <= Date.parse(item.createdAt)) {
      ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'expiresAt must be after createdAt' });
    }
  });

/** @typedef {z.infer<typeof ApprovalItem>} ApprovalItemData */

module.exports = {
  ApprovalKind,
  ApprovalStatus,
  RejectReasonCode,
  BookingRequestPayload,
  PostPayload,
  CommentReplyPayload,
  ApprovalPayload,
  ApprovalItem,
};
