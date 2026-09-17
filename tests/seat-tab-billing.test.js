const test = require("node:test");
const assert = require("node:assert/strict");
const { JsonSessionRepository } = require("../repositories/json-session-repository");
const { JsonBillingRepository } = require("../repositories/json-billing-repository");
const { JsonPosOrderRepository } = require("../repositories/json-pos-order-repository");
const { JsonInventoryRepository } = require("../repositories/json-inventory-repository");
const { TableSessionService } = require("../services/table-session-service");
const { InventoryService } = require("../services/inventory-service");
const { BillingService } = require("../services/billing-service");
const { CombinedBillingService } = require("../services/combined-billing-service");
const { PosOrderService } = require("../services/pos-order-service");
const { SeatTableService, SeatTableError } = require("../services/seat-table-service");

// A "seat table" (bar/lounge zone) has no timer/hardware and no session — the customer just sits
// down, orders, and pays later. This covers the three pieces that make that possible:
//   1. SeatTableService — the plain named list an OWNER/MANAGER maintains.
//   2. PosOrderService  — a SEAT order never requires the seat to be "active" first.
//   3. CombinedBillingService — one bill can sweep up every open order on the seat at once.

function makeStore() {
  return {
    seatTables: [{ id: 1, code: "B01", name: "โต๊ะบาร์ 1", status: "free", createdAt: "2026-09-01T00:00:00.000Z" }],
    products: [{ id: "water", sku: "W-1", name: "Water", price: 20, cost: 10, trackStock: false, status: "ACTIVE", active: true }],
    productCategories: [], stockMovements: [], posOrders: [], bills: [], payments: [], auditLogs: []
  };
}

function makeServices(store, now) {
  const save = () => {};
  const findSeat = seatId => store.seatTables.find(seat => String(seat.id) === String(seatId));
  const sessions = new JsonSessionRepository({ getStore: () => store, save });
  const bills = new JsonBillingRepository({ getStore: () => store, save });
  const orderRepository = new JsonPosOrderRepository({ getStore: () => store, save });
  const inventoryRepository = new JsonInventoryRepository({ getStore: () => store, save });
  const inventory = new InventoryService(inventoryRepository, { clock: () => now });
  const sessionService = new TableSessionService(sessions, () => now);
  const billingService = new BillingService(bills, () => now);
  const posOrders = new PosOrderService(orderRepository, inventory, { clock: () => now, findSeat });
  const combined = new CombinedBillingService({ sessionRepository: sessions, sessionService, posOrderRepository: orderRepository, billingRepository: bills, billingService, inventoryService: inventory, findSeat, save });
  return { posOrders, combined, orderRepository, findSeat };
}

const owner = { userId: "owner", role: "OWNER" };

test("a seat order can be created and confirmed while the seat is still free", async () => {
  const store = makeStore(), now = new Date("2026-09-14T10:00:00.000Z");
  const { posOrders } = makeServices(store, now);

  const order = posOrders.createOrder({ orderType: "SEAT", seatId: 1 }, owner);
  assert.equal(order.seatId, 1);
  assert.equal(order.seatName, "โต๊ะบาร์ 1");
  assert.equal(order.tableSessionId, null);

  posOrders.addItem(order.id, { productId: "water", quantity: 2 }, owner);
  const confirmed = await posOrders.confirmOrder(order.id, owner);
  assert.equal(confirmed.status, "CONFIRMED");
  assert.equal(confirmed.billingStatus, "UNBILLED");
  // Confirming a SEAT order itself never flips seat.status — that side effect lives in the route
  // layer (index.js), because PosOrderService has no reference to the seat beyond its id/name.
  assert.equal(store.seatTables[0].status, "free");
});

test("a seat order requires a seatId and a real seat, unlike a table order it never checks status", () => {
  const store = makeStore(), now = new Date("2026-09-14T10:00:00.000Z");
  const { posOrders } = makeServices(store, now);
  assert.throws(() => posOrders.createOrder({ orderType: "SEAT" }, owner), /seatId/);
  assert.throws(() => posOrders.createOrder({ orderType: "SEAT", seatId: 99 }, owner), /Seat not found/);
});

test("billing a seat aggregates every open order on it into one products-only bill, then frees the seat", async () => {
  const store = makeStore(), now = new Date("2026-09-14T10:00:00.000Z");
  const { posOrders, combined } = makeServices(store, now);

  const first = posOrders.createOrder({ orderType: "SEAT", seatId: 1 }, owner);
  posOrders.addItem(first.id, { productId: "water", quantity: 1 }, owner);
  await posOrders.confirmOrder(first.id, owner);
  store.seatTables[0].status = "occupied"; // normally set by the confirm route

  const second = posOrders.createOrder({ orderType: "SEAT", seatId: 1 }, owner);
  posOrders.addItem(second.id, { productId: "water", quantity: 2 }, owner);
  await posOrders.confirmOrder(second.id, owner);

  const preview = combined.previewSeatBilling(1);
  assert.equal(preview.orderIds.length, 2);
  assert.equal(preview.total, 60);

  const { bill, seat } = combined.createSeatBill(1, "cashier-1");
  assert.equal(bill.saleSource, "SEAT");
  assert.equal(bill.playAmount, 0);
  assert.equal(bill.total, 60);
  assert.equal(bill.tableId, null);
  assert.deepEqual(bill.posOrderIds.slice().sort(), [first.id, second.id].sort());
  assert.equal(store.posOrders[0].billingStatus, "BILLED");
  assert.equal(store.posOrders[1].billingStatus, "BILLED");
  assert.equal(seat.status, "free");
  assert.equal(store.seatTables[0].status, "free");

  // Nothing left to bill — a second attempt must fail rather than produce an empty bill.
  assert.throws(() => combined.previewSeatBilling(1), err => err.code === "NO_ORDERS_SELECTED");
});

test("billing an unknown seat fails with SEAT_NOT_FOUND", () => {
  const store = makeStore(), now = new Date("2026-09-14T10:00:00.000Z");
  const { combined } = makeServices(store, now);
  assert.throws(() => combined.previewSeatBilling(999), err => err.code === "SEAT_NOT_FOUND");
});

test("SeatTableService add/rename/remove and the in-use guard", () => {
  const service = new SeatTableService({ hasOpenOrders: () => false });
  let seats = service.add([], "โต๊ะบาร์ 1");
  assert.equal(seats.length, 1);
  assert.equal(seats[0].status, "free");

  seats = service.rename(seats, seats[0].id, "โซฟาริมหน้าต่าง");
  assert.equal(seats[0].name, "โซฟาริมหน้าต่าง");

  assert.throws(() => service.add(seats, "  "), err => err.code === "VALIDATION_ERROR");
  assert.throws(() => service.rename(seats, 999, "x"), err => err.code === "SEAT_NOT_FOUND");

  const occupied = [{ ...seats[0], status: "occupied" }];
  assert.throws(() => service.remove(occupied, occupied[0].id), err => err.code === "SEAT_IN_USE");

  const freed = service.remove(seats, seats[0].id);
  assert.equal(freed.length, 0);

  const guarded = new SeatTableService({ hasOpenOrders: () => true });
  assert.throws(() => guarded.remove(seats, seats[0].id), err => err.code === "SEAT_IN_USE");
  assert.ok(SeatTableError);
});

test("SeatTableService setNickname labels and clears the current occupant, separate from the zone's own name", () => {
  const service = new SeatTableService();
  let seats = service.add([], "โต๊ะบาร์ 1");
  assert.equal(seats[0].nickname, null);

  seats = service.setNickname(seats, seats[0].id, "  คุณเอ  ");
  assert.equal(seats[0].nickname, "คุณเอ");
  assert.equal(seats[0].name, "โต๊ะบาร์ 1"); // the permanent zone name is untouched

  seats = service.setNickname(seats, seats[0].id, "   "); // blank clears it, unlike rename()
  assert.equal(seats[0].nickname, null);

  assert.throws(() => service.setNickname(seats, 999, "x"), err => err.code === "SEAT_NOT_FOUND");
});

test("a seat's nickname is cleared automatically once its tab is billed", async () => {
  const store = makeStore(), now = new Date("2026-09-14T10:00:00.000Z");
  const { posOrders, combined } = makeServices(store, now);
  store.seatTables[0].nickname = "คุณเอ";

  const order = posOrders.createOrder({ orderType: "SEAT", seatId: 1 }, owner);
  posOrders.addItem(order.id, { productId: "water", quantity: 1 }, owner);
  await posOrders.confirmOrder(order.id, owner);
  store.seatTables[0].status = "occupied";
  assert.equal(store.seatTables[0].nickname, "คุณเอ"); // still there while the tab is open

  combined.createSeatBill(1, "cashier-1");
  assert.equal(store.seatTables[0].nickname, null);
});
