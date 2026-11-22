'use strict';

// Shared valid fixtures for the Task A1 bridge-protocol tests.

const ULID_A = '01JD0000000000000000000000';
const ULID_B = '01JD0000000000000000000001';
const TOKEN = 'A'.repeat(42) + 'Q';

function validSnapshot() {
  return {
    seq: 42,
    generatedAt: '2026-11-22T15:00:00.000Z',
    shop: { isOpenNow: true, todayHours: { open: '12:00', close: '02:00' }, note: 'วันนี้เปิดถึงตี 2' },
    tables: [
      { tableNo: '1', kind: 'snooker', status: 'available' },
      { tableNo: '2', kind: 'snooker', status: 'in_use', elapsedMin: 35 },
      { tableNo: 'P1', kind: 'pool', status: 'reserved', reservedFrom: '20:00' },
      { tableNo: 'P2', kind: 'pool', status: 'maintenance' },
    ],
    queue: { waiting: 2 },
    priceList: [
      { kind: 'snooker', label: 'ปกติ', pricePerHourTHB: 120 },
      { kind: 'snooker', label: 'หลัง 2 ทุ่ม', pricePerHourTHB: 150, timeRange: '20:00-02:00' },
    ],
    promotions: [
      {
        id: 'promo_hh',
        title: 'Happy Hour',
        detail: 'ลด 20% ทุกโต๊ะ',
        validFrom: '2026-11-01',
        validTo: '2026-11-30',
        days: [1, 2, 3, 4, 5],
        timeRange: '13:00-17:00',
      },
    ],
  };
}

function validBookingItem() {
  return {
    approvalId: 'apr_001',
    kind: 'booking_request',
    createdAt: '2026-11-22T15:00:00Z',
    expiresAt: '2026-11-22T15:15:00Z',
    summary: 'จองโต๊ะสนุ๊ก 4 คน 20:00',
    payload: {
      kind: 'booking_request',
      date: '2026-11-23',
      time: '20:00',
      partySize: 4,
      tableKind: 'snooker',
      displayName: 'คุณเอ',
      phoneMasked: '***-***-1234',
      channel: 'fb_messenger',
    },
  };
}

function validPostItem() {
  return {
    approvalId: 'apr_002',
    kind: 'post',
    createdAt: '2026-11-22T15:00:00Z',
    expiresAt: '2026-11-23T15:00:00Z',
    summary: 'โพสต์ Happy Hour',
    payload: {
      kind: 'post',
      contentId: 'cnt_001',
      caption: 'Happy Hour ลด 20%',
      mediaUrls: ['https://cdn.example.com/a.png'],
      scheduledAt: '2026-11-23T06:00:00Z',
      templateId: 'happy_hour',
    },
  };
}

function validCommentItem() {
  return {
    approvalId: 'apr_003',
    kind: 'comment_reply',
    createdAt: '2026-11-22T15:00:00Z',
    expiresAt: '2026-11-23T15:00:00Z',
    summary: 'ตอบคอมเมนต์เรื่องเวลาเปิด',
    payload: {
      kind: 'comment_reply',
      postUrl: 'https://www.facebook.com/88snooker/posts/1',
      commentText: 'เปิดกี่โมงครับ',
      draftReply: 'เปิดเที่ยงวันครับ',
    },
  };
}

/** One valid payload per allowed message type. */
function validPayloads() {
  return {
    hello: { deviceId: 'dev_abc123', appVersion: '1.0.36', protocolVersion: 1, timezone: 'Asia/Bangkok' },
    heartbeat: {},
    snapshot: validSnapshot(),
    'approval.decision': { approvalId: 'apr_001', decision: 'approved', decidedBy: 'staff_7' },
    'hello.ack': { serverTime: '2026-11-22T15:00:00Z', snapshotIntervalSec: 30 },
    ack: { refId: ULID_A },
    'approval.created': validBookingItem(),
    'approval.updated': { approvalId: 'apr_001', status: 'cancelled' },
    'token.rotate': { newToken: TOKEN },
  };
}

function envelope(type, payload, overrides = {}) {
  return { v: 1, type, id: ULID_A, ts: '2026-11-22T15:00:00Z', payload, ...overrides };
}

module.exports = {
  ULID_A,
  ULID_B,
  TOKEN,
  validSnapshot,
  validBookingItem,
  validPostItem,
  validCommentItem,
  validPayloads,
  envelope,
};
