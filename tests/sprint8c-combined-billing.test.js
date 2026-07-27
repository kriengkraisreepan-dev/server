const assert = require("assert");
const { JsonSessionRepository } = require("../repositories/json-session-repository");
const { JsonBillingRepository } = require("../repositories/json-billing-repository");
const { JsonPosOrderRepository } = require("../repositories/json-pos-order-repository");
const { TableSessionService } = require("../services/table-session-service");
const { BillingService } = require("../services/billing-service");
const { CombinedBillingService } = require("../services/combined-billing-service");

const now = new Date("2026-07-27T12:00:00.000Z");
const store = { tables: [{ id: 1, name: "Table 1", status: "playing", items: [] }], tableSessions: [{ id: "session-1", tableId: 1, state: "ACTIVE", openedAt: "2026-07-27T11:00:00.000Z", pausedAt: null, pausedSeconds: 0, pricingSnapshot: { id: "standard", name: "Standard", unit: "HOUR", rateSatang: 10000, minimumChargeSatang: 0, roundingRule: "UP_TO_BAHT", weekdayRules: [], timeRules: [] }, closedAt: null, finalChargeSatang: null }], posOrders: [
  { id: "pos-1", orderNumber: "POS-20260727-0001", orderType: "TABLE", tableId: 1, tableSessionId: "session-1", status: "CONFIRMED", billingStatus: "UNBILLED", total: 40, items: [{ id: "i-1", productId: "water", name: "Water", categoryName: "Drink", quantity: 2, unitPrice: 20, lineSubtotal: 40 }] },
  { id: "pos-draft", orderNumber: "POS-20260727-0002", orderType: "TABLE", tableId: 1, status: "DRAFT", billingStatus: null, total: 999, items: [] },
  { id: "pos-cancelled", orderNumber: "POS-20260727-0003", orderType: "TABLE", tableId: 1, status: "CANCELLED", billingStatus: null, total: 999, items: [] }
], bills: [], payments: [], auditLogs: [] };
const save = () => {};
const sessions = new JsonSessionRepository({ getStore: () => store, save });
const bills = new JsonBillingRepository({ getStore: () => store, save });
const orders = new JsonPosOrderRepository({ getStore: () => store, save });
const sessionService = new TableSessionService(sessions, () => now);
const billingService = new BillingService(bills, () => now);
const inventory = { restoreStockForCancelledSale: () => [] };
const combined = new CombinedBillingService({ sessionRepository: sessions, sessionService, posOrderRepository: orders, billingRepository: bills, billingService, inventoryService: inventory, save });

const preview = combined.buildPreview("session-1");
assert.strictEqual(preview.breakdown.tableCharge, 100);
assert.strictEqual(preview.breakdown.drink, 40);
assert.strictEqual(preview.breakdown.total, 140);
assert.strictEqual(store.tableSessions[0].state, "ACTIVE", "preview must not mutate session");
assert.strictEqual(store.posOrders[0].billingStatus, "UNBILLED", "preview must not mutate POS order");
const created = combined.createBill("session-1", "cashier-1");
assert.strictEqual(created.bill.tableSessionId, "session-1");
assert.deepStrictEqual(created.bill.posOrderIds, ["pos-1"]);
assert.strictEqual(created.bill.breakdown.total, 140);
assert.strictEqual(created.bill.items.length, 1);
assert.strictEqual(store.posOrders[0].billingStatus, "BILLED");
assert.strictEqual(store.posOrders[0].billedBillId, created.bill.id);
assert.throws(() => combined.createBill("session-1", "cashier-1"), /not available|already has a bill/);
console.log("Sprint 8C combined billing tests passed");
