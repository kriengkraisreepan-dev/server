"use strict";

// Build the Snapshot (BRIDGE_PROTOCOL §6) from the backend's read-only source + AI Bridge config.
// S-2.1: the result is parsed with bridge-protocol's strict Snapshot schema; a field outside the
// schema throws, so nothing extra can be sent. Only fields picked by name below are copied.
const { Snapshot } = require("../../packages/bridge-protocol");

const DAY_SHORT = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const MAX_PRICE_ENTRIES = 30;

const toMinutes = hhmm => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Bangkok wall clock for an instant: weekday 0..6 and minutes since midnight. */
function bangkokClock(date) {
  const local = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return { weekday: local.getUTCDay(), minutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

/**
 * Opening state from weekly hours. A day whose close <= open runs past midnight (e.g. 12:00–02:00),
 * so at 01:00 the shop is still open on the previous day's hours and those are "today's" hours.
 * @returns {{ isOpenNow: boolean, todayHours: { open: string, close: string } | null }}
 */
function openingState(weeklyHours, date) {
  const { weekday, minutes } = bangkokClock(date);
  const yesterday = weeklyHours[(weekday + 6) % 7];
  if (yesterday) {
    const open = toMinutes(yesterday.open), close = toMinutes(yesterday.close);
    if (close <= open && minutes < close) return { isOpenNow: true, todayHours: { open: yesterday.open, close: yesterday.close } };
  }
  const today = weeklyHours[weekday];
  if (!today) return { isOpenNow: false, todayHours: null };
  const open = toMinutes(today.open), close = toMinutes(today.close);
  const isOpenNow = close > open ? minutes >= open && minutes < close : minutes >= open;
  return { isOpenNow, todayHours: { open: today.open, close: today.close } };
}

function priceList(priceProfiles, tables, kindOf) {
  const kindsByProfile = new Map();
  for (const table of tables) {
    if (!kindsByProfile.has(table.profileId)) kindsByProfile.set(table.profileId, new Set());
    kindsByProfile.get(table.profileId).add(kindOf(table.tableId));
  }
  const out = [];
  for (const profile of priceProfiles) {
    const kinds = kindsByProfile.get(profile.profileId) || new Set(["snooker"]);
    for (const kind of [...kinds].sort()) {
      if (profile.pricePerHourTHB !== null) out.push({ kind, label: profile.label.slice(0, 60) || "ปกติ", pricePerHourTHB: profile.pricePerHourTHB });
      for (const rule of profile.rules || []) {
        if (rule.pricePerHourTHB === null || rule.pricePerHourTHB === undefined) continue;
        const days = rule.days && rule.days.length && rule.days.length < 7 ? ` ${rule.days.map(day => DAY_SHORT[day]).join(",")}` : "";
        const entry = { kind, label: `${profile.label} ช่วงพิเศษ${days}`.slice(0, 60), pricePerHourTHB: rule.pricePerHourTHB };
        if (rule.timeRange) entry.timeRange = rule.timeRange.slice(0, 30);
        out.push(entry);
      }
    }
  }
  return out.slice(0, MAX_PRICE_ENTRIES);
}

/**
 * @param {{ source: { tables: object[], queueWaiting: number, priceProfiles: object[] },
 *           shopInfo: { weeklyHours: Array<{open:string,close:string}|null>, note?: string },
 *           tableKinds: Record<string, 'snooker'|'pool'>, seq: number, now: Date }} input
 * @returns {import('../../packages/bridge-protocol/src/snapshot').SnapshotData}
 */
function buildSnapshot({ source, shopInfo, tableKinds = {}, seq, now = new Date() }) {
  if (!shopInfo) throw Object.assign(new Error("shop hours not configured"), { code: "SHOP_HOURS_NOT_SET" });
  const kindOf = tableId => (tableKinds[tableId] === "pool" ? "pool" : "snooker");
  const sourceTables = Array.isArray(source?.tables) ? source.tables : [];
  const tables = sourceTables.map(table => {
    const out = { tableNo: table.tableNo, kind: kindOf(table.tableId), status: table.status };
    if (table.status === "in_use" && Number.isInteger(table.elapsedMin)) out.elapsedMin = table.elapsedMin;
    if (table.status === "reserved" && table.reservedFrom) out.reservedFrom = table.reservedFrom;
    return out;
  });
  const shop = { ...openingState(shopInfo.weeklyHours, now) };
  if (shopInfo.note) shop.note = shopInfo.note;
  return Snapshot.parse({
    seq,
    generatedAt: now.toISOString(),
    shop,
    tables,
    queue: { waiting: Number.isInteger(source?.queueWaiting) ? source.queueWaiting : 0 },
    priceList: priceList(Array.isArray(source?.priceProfiles) ? source.priceProfiles : [], sourceTables, kindOf),
    promotions: [], // A3 plan ค: POS coupons are private discount codes, not public promotions.
  });
}

/** Key that changes only when what a customer sees about the tables changes (for the 2s debounce). */
function tablesKey(source) {
  const tables = Array.isArray(source?.tables) ? source.tables : [];
  return JSON.stringify(tables.map(t => [t.tableId, t.status, t.reservedFrom || ""]));
}

module.exports = { buildSnapshot, openingState, tablesKey, bangkokClock };
