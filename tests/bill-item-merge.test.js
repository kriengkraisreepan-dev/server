const test = require("node:test");
const assert = require("node:assert/strict");
const { JsonSessionRepository } = require("../repositories/json-session-repository");
const { JsonBillingRepository } = require("../repositories/json-billing-repository");
const { JsonPosOrderRepository } = require("../repositories/json-pos-order-repository");
const { TableSessionService } = require("../services/table-session-service");
const { BillingService } = require("../services/billing-service");
const { CombinedBillingService } = require("../services/combined-billing-service");

// A customer ordering the same drink across multiple rounds (separate confirmed POS orders on the
// same tab) previously produced one bill/receipt line PER ORDER instead of one line per PRODUCT —
// "เบียร์ลีโอ x3" and "เบียร์ลีโอ x4" instead of "เบียร์ลีโอ x7". See
// CombinedBillingService#itemSnapshot / #mergeItems.

function makeStore(extraOrder) {
  return {
    tables: [{ id: 1, name: "Table 1", status: "playing", items: [] }],
    tableSessions: [{ id: "session-1", tableId: 1, state: "ACTIVE", openedAt: "2026-09-20T11:00:00.000Z", pausedAt: null, pausedSeconds: 0, pricingSnapshot: { id: "standard", name: "Standard", unit: "HOUR", rateSatang: 10000, minimumChargeSatang: 0, roundingRule: "UP_TO_BAHT", weekdayRules: [], timeRules: [] }, closedAt: null, finalChargeSatang: null }],
    posOrders: [
      { id: "pos-round-1", orderNumber: "POS-1", orderType: "TABLE", tableId: 1, tableSessionId: "session-1", status: "CONFIRMED", billingStatus: "UNBILLED", total: 105, items: [{ id: "i-1", productId: "leo", name: "เบียร์ลีโอ", categoryName: "เครื่องดื่ม", quantity: 3, unitPrice: 35, lineSubtotal: 105 }] },
      { id: "pos-round-2", orderNumber: "POS-2", orderType: "TABLE", tableId: 1, tableSessionId: "session-1", status: "CONFIRMED", billingStatus: "UNBILLED", total: 165, items: [{ id: "i-2", productId: "leo", name: "เบียร์ลีโอ", categoryName: "เครื่องดื่ม", quantity: 4, unitPrice: 35, lineSubtotal: 140 }, { id: "i-3", productId: "chips", name: "มันฝรั่งทอด", categoryName: "อาหาร", quantity: 1, unitPrice: 25, lineSubtotal: 25 }] },
      ...(extraOrder ? [extraOrder] : [])
    ],
    bills: [], payments: [], auditLogs: []
  };
}

function makeServices(store, now) {
  const save = () => {};
  const sessions = new JsonSessionRepository({ getStore: () => store, save });
  const bills = new JsonBillingRepository({ getStore: () => store, save });
  const orders = new JsonPosOrderRepository({ getStore: () => store, save });
  const sessionService = new TableSessionService(sessions, () => now);
  const billingService = new BillingService(bills, () => now);
  const inventory = { restoreStockForCancelledSale: () => [] };
  return new CombinedBillingService({ sessionRepository: sessions, sessionService, posOrderRepository: orders, billingRepository: bills, billingService, inventoryService: inventory, save });
}

test("the same product across two separate confirmed orders merges into one bill line, quantity and total summed", () => {
  const store = makeStore(), now = new Date("2026-09-20T12:00:00.000Z");
  const combined = makeServices(store, now);

  const preview = combined.buildPreview("session-1");
  const leoLines = preview.items.filter(item => item.productId === "leo");
  assert.equal(leoLines.length, 1, "7 Leos across two rounds must be one line, not two");
  assert.equal(leoLines[0].quantity, 7);
  assert.equal(leoLines[0].total, 245);
  assert.equal(leoLines[0].totalSatang, 24500);

  const chipsLines = preview.items.filter(item => item.productId === "chips");
  assert.equal(chipsLines.length, 1);
  assert.equal(chipsLines[0].quantity, 1);

  // The merge must survive all the way onto the actual bill/receipt, not just the preview.
  const { bill } = combined.createBill("session-1", "cashier-1");
  const billedLeo = bill.items.filter(item => item.productId === "leo");
  assert.equal(billedLeo.length, 1);
  assert.equal(billedLeo[0].quantity, 7);
  assert.equal(billedLeo[0].total, 245);
});

test("a genuine price change (e.g. Happy Hour ending) keeps the two rounds as separate lines instead of merging at the wrong price", () => {
  const priceChangedOrder = { id: "pos-round-3", orderNumber: "POS-3", orderType: "TABLE", tableId: 1, tableSessionId: "session-1", status: "CONFIRMED", billingStatus: "UNBILLED", total: 90, items: [{ id: "i-4", productId: "leo", name: "เบียร์ลีโอ", categoryName: "เครื่องดื่ม", quantity: 2, unitPrice: 45, lineSubtotal: 90 }] };
  const store = makeStore(priceChangedOrder), now = new Date("2026-09-20T12:00:00.000Z");
  const combined = makeServices(store, now);

  const preview = combined.buildPreview("session-1");
  const leoLines = preview.items.filter(item => item.productId === "leo").sort((a, b) => a.price - b.price);
  assert.equal(leoLines.length, 2, "a real price change must not be folded into one (wrong-priced) line");
  assert.equal(leoLines[0].price, 35); assert.equal(leoLines[0].quantity, 7);
  assert.equal(leoLines[1].price, 45); assert.equal(leoLines[1].quantity, 2);
});

test("a seat tab's aggregated bill also merges repeated products across its rounds", () => {
  const store = {
    seatTables: [{ id: 1, code: "B01", name: "โต๊ะบาร์ 1", status: "occupied", nickname: null, createdAt: "2026-09-20T00:00:00.000Z" }],
    posOrders: [
      { id: "seat-round-1", orderNumber: "POS-S1", orderType: "SEAT", seatId: 1, status: "CONFIRMED", billingStatus: "UNBILLED", total: 70, items: [{ id: "s-1", productId: "leo", name: "เบียร์ลีโอ", categoryName: "เครื่องดื่ม", quantity: 2, unitPrice: 35, lineSubtotal: 70 }] },
      { id: "seat-round-2", orderNumber: "POS-S2", orderType: "SEAT", seatId: 1, status: "CONFIRMED", billingStatus: "UNBILLED", total: 175, items: [{ id: "s-2", productId: "leo", name: "เบียร์ลีโอ", categoryName: "เครื่องดื่ม", quantity: 5, unitPrice: 35, lineSubtotal: 175 }] }
    ],
    bills: [], payments: [], auditLogs: []
  };
  const save = () => {};
  const bills = new JsonBillingRepository({ getStore: () => store, save });
  const orders = new JsonPosOrderRepository({ getStore: () => store, save });
  const billingService = new BillingService(bills, () => new Date("2026-09-20T12:00:00.000Z"));
  const findSeat = seatId => store.seatTables.find(seat => String(seat.id) === String(seatId));
  const combined = new CombinedBillingService({ sessionRepository: {}, sessionService: {}, posOrderRepository: orders, billingRepository: bills, billingService, inventoryService: {}, findSeat, save });

  const { bill } = combined.createSeatBill(1, "cashier-1");
  assert.equal(bill.items.length, 1);
  assert.equal(bill.items[0].quantity, 7);
  assert.equal(bill.items[0].total, 245);
});
