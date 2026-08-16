const test = require("node:test");
const assert = require("node:assert/strict");
const { JsonSessionRepository } = require("../repositories/json-session-repository");
const { JsonBillingRepository } = require("../repositories/json-billing-repository");
const { JsonPosOrderRepository } = require("../repositories/json-pos-order-repository");
const { TableSessionService } = require("../services/table-session-service");
const { BillingService } = require("../services/billing-service");
const { CombinedBillingService } = require("../services/combined-billing-service");

// "Pay for these products now, keep playing" — a customer orders drinks mid-session and wants to
// settle that tab immediately, without waiting for (or being forced to combine it with) the table's
// eventual time-charge bill. See CombinedBillingService#createTableOrdersBill.

function makeStore() {
  return {
    tables: [{ id: 1, name: "Table 1", status: "playing", items: [] }],
    tableSessions: [{ id: "session-1", tableId: 1, state: "ACTIVE", openedAt: "2026-07-27T11:00:00.000Z", pausedAt: null, pausedSeconds: 0, pricingSnapshot: { id: "standard", name: "Standard", unit: "HOUR", rateSatang: 10000, minimumChargeSatang: 0, roundingRule: "UP_TO_BAHT", weekdayRules: [], timeRules: [] }, closedAt: null, finalChargeSatang: null }],
    posOrders: [
      { id: "pos-drinks", orderNumber: "POS-1", orderType: "TABLE", tableId: 1, tableSessionId: "session-1", status: "CONFIRMED", billingStatus: "UNBILLED", total: 40, items: [{ id: "i-1", productId: "water", name: "Water", categoryName: "Drink", quantity: 2, unitPrice: 20, lineSubtotal: 40 }] },
      { id: "pos-snacks", orderNumber: "POS-2", orderType: "TABLE", tableId: 1, tableSessionId: "session-1", status: "CONFIRMED", billingStatus: "UNBILLED", total: 25, items: [{ id: "i-2", productId: "chips", name: "Chips", categoryName: "Snack", quantity: 1, unitPrice: 25, lineSubtotal: 25 }] }
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
  const combined = new CombinedBillingService({ sessionRepository: sessions, sessionService, posOrderRepository: orders, billingRepository: bills, billingService, inventoryService: inventory, save });
  return { combined, sessions, bills, orders };
}

test("bills a selected order separately while the table stays open, then still allows the final combined bill", () => {
  const store = makeStore(), now = new Date("2026-07-27T12:00:00.000Z");
  const { combined } = makeServices(store, now);

  const { bill, preview } = combined.createTableOrdersBill(1, ["pos-drinks"], "cashier-1");

  assert.equal(bill.partialOrdersOnly, true);
  assert.equal(bill.tableChargeSatang, 0);
  assert.equal(bill.playAmount, 0);
  assert.equal(bill.total, 40);
  assert.deepEqual(bill.posOrderIds, ["pos-drinks"]);
  assert.equal(preview.total, 40);
  // The table's real session must be completely untouched — still playing, same open time.
  assert.equal(store.tables[0].status, "playing");
  assert.equal(store.tableSessions[0].state, "ACTIVE");
  assert.equal(store.tableSessions[0].closedAt, null);
  assert.equal(store.posOrders[0].billingStatus, "BILLED");
  assert.equal(store.posOrders[0].billedBillId, bill.id);
  assert.equal(store.posOrders[1].billingStatus, "UNBILLED"); // untouched snack order

  // The final combined-checkout preview must only pick up what's still unbilled (the snacks), and
  // the table-time charge continues accruing normally — the interim bill left it untouched.
  const finalPreview = combined.buildPreview("session-1");
  assert.deepEqual(finalPreview.posOrders.map(o => o.id), ["pos-snacks"]);
  assert.equal(finalPreview.breakdown.food + finalPreview.breakdown.drink, 25);

  // Closing the table for real must succeed — the interim bill must not trip the "session already
  // has a bill" guard.
  const closed = combined.createBill("session-1", "cashier-1");
  assert.deepEqual(closed.bill.posOrderIds, ["pos-snacks"]);
  assert.equal(closed.bill.partialOrdersOnly, false);
});

test("rejects an order that does not belong to the table's active session", () => {
  const store = makeStore(), now = new Date("2026-07-27T12:00:00.000Z");
  const { combined } = makeServices(store, now);
  store.posOrders[0].tableSessionId = "some-other-session";
  assert.throws(() => combined.previewTableOrdersBilling(1, ["pos-drinks"]), err => err.code === "ORDER_NOT_AVAILABLE");
});

test("rejects billing an order that is already billed", () => {
  const store = makeStore(), now = new Date("2026-07-27T12:00:00.000Z");
  const { combined } = makeServices(store, now);
  combined.createTableOrdersBill(1, ["pos-drinks"], "cashier-1");
  assert.throws(() => combined.createTableOrdersBill(1, ["pos-drinks"], "cashier-1"), err => err.code === "ORDER_NOT_AVAILABLE");
});

test("rejects when the table has no active session", () => {
  const store = makeStore(), now = new Date("2026-07-27T12:00:00.000Z");
  store.tableSessions[0].state = "COMPLETED";
  const { combined } = makeServices(store, now);
  assert.throws(() => combined.previewTableOrdersBilling(1, ["pos-drinks"]), err => err.code === "SESSION_NOT_ACTIVE");
});

test("rejects an empty selection", () => {
  const store = makeStore(), now = new Date("2026-07-27T12:00:00.000Z");
  const { combined } = makeServices(store, now);
  assert.throws(() => combined.previewTableOrdersBilling(1, []), err => err.code === "NO_ORDERS_SELECTED");
});
