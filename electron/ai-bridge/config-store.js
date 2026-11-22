"use strict";

// AI Bridge settings in <data>/config/ai-bridge.json (owned by Electron main, NOT the POS store).
// Holds the paired device (no token — that lives encrypted in token-store), shop hours + note set by
// staff, and the snooker/pool kind per table, because the POS has none of these yet (A3 plan ก/ข).
const { z } = require("zod");
const { atomicWrite, readJson, removeFile } = require("./files");

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "ต้องเป็น HH:MM");
const DayHours = z.strictObject({ open: HHMM, close: HHMM }).nullable(); // null = closed that day
const ShopInfo = z.strictObject({
  weeklyHours: z.array(DayHours).length(7), // index 0 = Sunday … 6 = Saturday (Asia/Bangkok)
  note: z.string().max(200).optional(),
});
const TableKinds = z.record(z.string().max(40), z.enum(["snooker", "pool"]));
const Device = z.strictObject({
  deviceId: z.string().regex(/^dev_[A-Za-z0-9_-]{1,60}$/),
  deviceName: z.string().min(1).max(60),
  hubUrl: z.string().max(300),
  hubBaseUrl: z.string().max(300),
  pairedAt: z.string(),
});
const Config = z.strictObject({
  schemaVersion: z.literal(1),
  device: Device.nullable(),
  shopInfo: ShopInfo.nullable(),
  tableKinds: TableKinds,
});

const EMPTY = Object.freeze({ schemaVersion: 1, device: null, shopInfo: null, tableKinds: {} });

function createConfigStore({ file }) {
  if (!file) throw new TypeError("file is required");
  return {
    read() {
      const parsed = Config.safeParse(readJson(file, EMPTY));
      return parsed.success ? parsed.data : { ...EMPTY, tableKinds: {} };
    },
    write(next) {
      const value = Config.parse(next);
      atomicWrite(file, JSON.stringify(value, null, 2));
      return value;
    },
    update(changes) {
      return this.write({ ...this.read(), ...changes });
    },
    clear() { removeFile(file); },
  };
}

module.exports = { createConfigStore, ShopInfo, TableKinds, Device, HHMM };
