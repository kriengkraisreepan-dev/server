"use strict";

// Read-only projection for the AI Bridge (Task A3, docs/ai-assistant/BRIDGE_PROTOCOL.md §6).
//
// SAFETY S-1.1 / S-1.2: this module requires NOTHING. It receives plain data that index.js has
// already read and returns a new plain object; it cannot reach Relay, Hardware, billing, payment or
// any write path, and tests/ai-bridge-import-boundary.test.js enforces that.
// SAFETY S-2: only Public fields leave this function — table status / elapsed minutes, queue length,
// prices from pricing profiles. Member, customer name/phone, bill amounts, staff, relay/hardware ids
// are never copied (tests/ai-bridge-snapshot-source.test.js).

const IN_USE = new Set(["playing", "paused", "awaiting_payment"]);
const MAX_TABLES = 100;
const MAX_PROFILES = 30;

const bangkokHHMM = iso => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  const local = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
};
const hhmm = value => (typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : "");
const perHourTHB = profile => {
  const satang = Number(profile.rateSatang);
  if (!Number.isFinite(satang) || satang < 0) return null;
  return (profile.unit === "MINUTE" ? satang * 60 : satang) / 100;
};
// What a customer sees as the table number: its name when short enough, else its code.
const tableNo = table => {
  const name = String(table.name || "").trim();
  if (name && name.length <= 10) return name;
  return String(table.code || table.id || "").trim().slice(0, 10);
};

/**
 * @param {{
 *   tables: Array<{ id: any, name?: string, code?: string, status?: string, elapsedSeconds?: number, pricingProfileId?: string }>,
 *   reservations: Array<{ status?: string, assignedTableId?: any, effectiveReservationAt?: string, reservedAt?: string }>,
 *   pricingProfiles: Array<{ id: string, name?: string, unit?: string, rateSatang?: number, timeRules?: any[] }>,
 *   defaultPricingProfileId?: string,
 * }} input
 * @returns {{ tables: object[], queueWaiting: number, priceProfiles: object[] }}
 */
function buildSnapshotSource({ tables = [], reservations = [], pricingProfiles = [], defaultPricingProfileId } = {}) {
  const profileIds = new Set(pricingProfiles.map(profile => String(profile.id)));
  // A table assigned to a reservation that is waiting for the customer to arrive is "reserved".
  const heldFor = new Map();
  for (const item of reservations) {
    if (item?.status === "OPENED_WAITING_CHECK_IN" && item.assignedTableId != null) {
      heldFor.set(String(item.assignedTableId), item.effectiveReservationAt || item.reservedAt);
    }
  }

  const outTables = tables.slice(0, MAX_TABLES).map(table => {
    const id = String(table.id);
    const profileId = table.pricingProfileId && profileIds.has(String(table.pricingProfileId)) ? String(table.pricingProfileId) : String(defaultPricingProfileId || "");
    const base = { tableId: id, tableNo: tableNo(table), profileId };
    if (heldFor.has(id)) {
      const from = bangkokHHMM(heldFor.get(id));
      return { ...base, status: "reserved", ...(from ? { reservedFrom: from } : {}) };
    }
    if (IN_USE.has(table.status)) {
      const seconds = Number(table.elapsedSeconds);
      return { ...base, status: "in_use", elapsedMin: Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds / 60) : 0 };
    }
    return { ...base, status: "available" };
  });

  const queueWaiting = reservations.filter(item => item?.status === "WAITING_TABLE").length;

  const priceProfiles = pricingProfiles.slice(0, MAX_PROFILES).map(profile => ({
    profileId: String(profile.id),
    label: String(profile.name || "ปกติ").slice(0, 60),
    pricePerHourTHB: perHourTHB(profile),
    rules: (Array.isArray(profile.timeRules) ? profile.timeRules : []).map(rule => {
      const start = hhmm(rule?.startTime), end = hhmm(rule?.endTime);
      return {
        pricePerHourTHB: perHourTHB({ unit: profile.unit, rateSatang: rule?.rateSatang }),
        timeRange: start && end && start !== end ? `${start}-${end}` : undefined,
        days: Array.isArray(rule?.weekdays) && rule.weekdays.length ? rule.weekdays.filter(day => Number.isInteger(day) && day >= 0 && day <= 6) : undefined,
      };
    }),
  }));

  return { tables: outTables, queueWaiting, priceProfiles };
}

module.exports = { buildSnapshotSource };
