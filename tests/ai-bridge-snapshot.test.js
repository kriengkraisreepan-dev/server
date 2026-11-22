"use strict";

// A3: snapshot built from the read-only source only, strict schema (S-2.1), no PII (S-2.2).
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSnapshotSource } = require("../services/ai-snapshot-source");
const { buildSnapshot, openingState, tablesKey } = require("../electron/ai-bridge/snapshot-builder");
const { Snapshot } = require("../packages/bridge-protocol");

const WEEK = Array(7).fill({ open: "12:00", close: "02:00" });
// What index.js really passes in: enrichTable() output, which carries member, price and relay data.
const posTables = () => [
  { id: 1, code: "T01", name: "โต๊ะ 1", relay: 1, status: "free", memberId: null, member: null, items: [], currentPrice: 0, rateSatang: 15000, pricingProfileId: null, elapsedSeconds: 0, hardwareDeviceId: "esp32-AA:BB", ipAddress: "192.168.1.50" },
  { id: 2, code: "T02", name: "โต๊ะ 2", relay: 2, status: "playing", memberId: "M1", member: { name: "สมชาย ใจดี", phone: "0812345678" }, items: [{ name: "เบียร์", price: 90 }], currentPrice: 180, elapsedSeconds: 3725, pricingProfileId: "vip" },
  { id: 3, code: "T03", name: "โต๊ะ 3", relay: 3, status: "awaiting_payment", elapsedSeconds: 600 },
  { id: 4, code: "T04", name: "โต๊ะ VIP ห้องใหญ่", relay: 4, status: "playing", elapsedSeconds: 59 },
];
const reservations = () => [
  { id: "RES-1", status: "OPENED_WAITING_CHECK_IN", assignedTableId: 1, effectiveReservationAt: "2026-11-22T12:30:00.000Z", customerName: "สมหญิง", phone: "0899999999" },
  { id: "RES-2", status: "WAITING_TABLE", customerName: "ก", phone: "0811111111" },
  { id: "RES-3", status: "WAITING_TABLE", customerName: "ข", phone: "0822222222" },
  { id: "RES-4", status: "CANCELLED", assignedTableId: 3 },
];
const profiles = () => [
  { id: "default", name: "ปกติ", unit: "HOUR", rateSatang: 15000, timeRules: [{ weekdays: [1, 2, 3, 4, 5], startTime: "18:00", endTime: "24:00", rateSatang: 20000 }] },
  { id: "vip", name: "VIP", unit: "MINUTE", rateSatang: 500, timeRules: [] },
];
const source = () => buildSnapshotSource({ tables: posTables(), reservations: reservations(), pricingProfiles: profiles(), defaultPricingProfileId: "default" });
const NOW = new Date("2026-11-22T13:00:00.000Z"); // Sunday 20:00 Bangkok

test("A3 source: maps POS statuses to snapshot statuses", () => {
  const s = source();
  assert.deepEqual(s.tables.map(t => [t.tableNo, t.status, t.elapsedMin, t.reservedFrom]), [
    ["โต๊ะ 1", "reserved", undefined, "19:30"],
    ["โต๊ะ 2", "in_use", 62, undefined],
    ["โต๊ะ 3", "in_use", 10, undefined],
    ["T04", "in_use", 0, undefined],
  ]);
  assert.equal(s.queueWaiting, 2);
  assert.deepEqual(s.priceProfiles.map(p => [p.profileId, p.pricePerHourTHB]), [["default", 150], ["vip", 300]]);
});

test("A3 S-2.2: no PII, bill, staff or hardware data in source or snapshot", () => {
  const s = source();
  const snapshot = buildSnapshot({ source: s, shopInfo: { weeklyHours: WEEK }, tableKinds: { 2: "pool" }, seq: 1, now: NOW });
  for (const text of [JSON.stringify(s), JSON.stringify(snapshot)]) {
    for (const secret of ["สมชาย", "0812345678", "0899999999", "สมหญิง", "เบียร์", "esp32", "192.168", "currentPrice", "relay", "member", "phone", "customerName", "M1", "RES-"]) {
      assert.ok(!text.includes(secret), `leaked ${secret}`);
    }
  }
  assert.ok(!JSON.stringify(snapshot).includes("tableId"), "internal table ids stay on the shop PC");
});

test("A3 S-2.1: built snapshot passes strict schema; an extra field is rejected", () => {
  const snapshot = buildSnapshot({ source: source(), shopInfo: { weeklyHours: WEEK, note: "วันนี้ปิดเร็ว" }, tableKinds: { 2: "pool" }, seq: 7, now: NOW });
  assert.equal(Snapshot.safeParse(snapshot).success, true);
  assert.equal(snapshot.seq, 7);
  assert.equal(snapshot.tables[1].kind, "pool");
  assert.equal(snapshot.tables[0].kind, "snooker");
  assert.deepEqual(snapshot.promotions, []);
  assert.deepEqual(snapshot.shop, { isOpenNow: true, todayHours: { open: "12:00", close: "02:00" }, note: "วันนี้ปิดเร็ว" });
  assert.deepEqual(snapshot.priceList, [
    { kind: "snooker", label: "ปกติ", pricePerHourTHB: 150 },
    { kind: "snooker", label: "ปกติ ช่วงพิเศษ จ,อ,พ,พฤ,ศ", pricePerHourTHB: 200 },
    { kind: "pool", label: "VIP", pricePerHourTHB: 300 },
  ]);
  const bad = source();
  bad.tables[0].tableNo = "x".repeat(11);
  assert.throws(() => buildSnapshot({ source: bad, shopInfo: { weeklyHours: WEEK }, seq: 1, now: NOW }));
  const extra = { ...snapshot, customerPhone: "0812345678" };
  assert.equal(Snapshot.safeParse(extra).success, false);
});

test("A3: building without shop hours fails (nothing is sent)", () => {
  assert.throws(() => buildSnapshot({ source: source(), shopInfo: null, seq: 1, now: NOW }), { code: "SHOP_HOURS_NOT_SET" });
});

test("A3: opening hours incl. past-midnight close and closed days (Asia/Bangkok)", () => {
  const at = iso => new Date(iso);
  const week = [null, { open: "10:00", close: "22:00" }, { open: "12:00", close: "02:00" }, null, null, null, null];
  // Monday 09:00 BKK → not yet open
  assert.deepEqual(openingState(week, at("2026-11-23T02:00:00Z")), { isOpenNow: false, todayHours: { open: "10:00", close: "22:00" } });
  // Monday 21:59 BKK → open
  assert.equal(openingState(week, at("2026-11-23T14:59:00Z")).isOpenNow, true);
  // Sunday (closed) 15:00 BKK
  assert.deepEqual(openingState(week, at("2026-11-22T08:00:00Z")), { isOpenNow: false, todayHours: null });
  // Wednesday 01:30 BKK → still Tuesday's 12:00–02:00
  assert.deepEqual(openingState(week, at("2026-11-24T18:30:00Z")), { isOpenNow: true, todayHours: { open: "12:00", close: "02:00" } });
  // Wednesday 02:00 BKK → closed (Wednesday is a closed day)
  assert.deepEqual(openingState(week, at("2026-11-24T19:00:00Z")), { isOpenNow: false, todayHours: null });
});

test("A3: tablesKey changes only when a table changes", () => {
  const a = source(), b = source();
  b.queueWaiting = 9;
  assert.equal(tablesKey(a), tablesKey(b));
  b.tables[0].status = "available";
  assert.notEqual(tablesKey(a), tablesKey(b));
});
