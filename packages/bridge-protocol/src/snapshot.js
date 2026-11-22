'use strict';

// Snapshot schema — BRIDGE_PROTOCOL §6.
// S-2.1: every object is strict, so any field not listed here (customer name, phone,
// bill totals, staff, device ids, ...) is rejected both when building and when receiving.
// S-2 / Gate G6: adding any field here requires the owner's approval.
const { z } = require('zod');
const { IsoUtc, IsoDate, HHMM, TableKind } = require('./primitives');

const ShopInfo = z.strictObject({
  isOpenNow: z.boolean(),
  todayHours: z.strictObject({ open: HHMM, close: HHMM }).nullable(),
  note: z.string().max(200).optional(),
});

const TableStatus = z.enum(['available', 'in_use', 'reserved', 'maintenance']);

const SnapshotTable = z
  .strictObject({
    tableNo: z.string().min(1).max(10),
    kind: TableKind,
    status: TableStatus,
    elapsedMin: z.number().int().nonnegative().optional(),
    reservedFrom: HHMM.optional(),
  })
  .superRefine((table, ctx) => {
    if (table.elapsedMin !== undefined && table.status !== 'in_use') {
      ctx.addIssue({ code: 'custom', path: ['elapsedMin'], message: 'elapsedMin is only allowed when status is in_use' });
    }
    if (table.reservedFrom !== undefined && table.status !== 'reserved') {
      ctx.addIssue({ code: 'custom', path: ['reservedFrom'], message: 'reservedFrom is only allowed when status is reserved' });
    }
  });

const SnapshotQueue = z.strictObject({
  waiting: z.number().int().nonnegative(),
});

const PriceListEntry = z.strictObject({
  kind: TableKind,
  label: z.string().min(1).max(60),
  pricePerHourTHB: z.number().nonnegative(),
  timeRange: z.string().max(30).optional(),
});

const Promotion = z.strictObject({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(80),
  detail: z.string().max(400),
  validFrom: IsoDate,
  validTo: IsoDate,
  days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  timeRange: z.string().max(30).optional(),
});

const Snapshot = z.strictObject({
  seq: z.number().int().nonnegative(),
  generatedAt: IsoUtc,
  shop: ShopInfo,
  tables: z.array(SnapshotTable).max(100),
  queue: SnapshotQueue,
  priceList: z.array(PriceListEntry).max(30),
  promotions: z.array(Promotion).max(20),
});

/** @typedef {z.infer<typeof Snapshot>} SnapshotData */

module.exports = {
  Snapshot,
  ShopInfo,
  SnapshotTable,
  TableStatus,
  SnapshotQueue,
  PriceListEntry,
  Promotion,
};
