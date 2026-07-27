const assert = require("assert");
const { JsonInventoryRepository } = require("../repositories/json-inventory-repository");
const { JsonPosOrderRepository } = require("../repositories/json-pos-order-repository");
const { InventoryService } = require("../services/inventory-service");
const { PosOrderService } = require("../services/pos-order-service");

const store = { products: [
  { id: "tracked", sku: "T-1", name: "Tracked", price: 15, cost: 7, trackStock: true, stockQuantity: 2, lowStockThreshold: 1, status: "ACTIVE", active: true },
  { id: "untracked", sku: "U-1", name: "Untracked", price: 20, cost: 0, trackStock: false, stockQuantity: 0, lowStockThreshold: 0, status: "ACTIVE", active: true },
  { id: "disabled", sku: "D-1", name: "Disabled", price: 10, cost: 0, trackStock: false, stockQuantity: 0, lowStockThreshold: 0, status: "DISABLED", active: false }
], productCategories: [], stockMovements: [], posOrders: [] };
const inventoryRepository = new JsonInventoryRepository({ getStore: () => store, save: () => {} });
const orderRepository = new JsonPosOrderRepository({ getStore: () => store, save: () => {} });
const audit = [];
const inventory = new InventoryService(inventoryRepository, { clock: () => new Date("2026-07-27T01:00:00.000Z"), audit: (event, actor, data) => audit.push({ event, actor, data }) });
const tables = [{ id: 1, name: "T01" }];
const service = new PosOrderService(orderRepository, inventory, { clock: () => new Date("2026-07-27T01:00:00.000Z"), audit: (event, actor, data) => audit.push({ event, actor, data }), findTable: id => tables.find(table => String(table.id) === String(id)) });
const owner = { userId: "owner", role: "OWNER" }, cashier = { userId: "cashier", role: "CASHIER" }, staff = { userId: "staff", role: "STAFF" }, manager = { userId: "manager", role: "MANAGER" };

const walkIn = service.createOrder({ orderType: "WALK_IN", note: "take away" }, cashier);
assert.equal(walkIn.status, "DRAFT"); assert.match(walkIn.orderNumber, /^POS-20260727-0001$/);
const tableOrder = service.createOrder({ orderType: "TABLE", tableId: 1 }, owner);
assert.equal(tableOrder.tableName, "T01");
assert.throws(() => service.createOrder({ orderType: "TABLE" }, owner), /tableId/);
assert.throws(() => service.createOrder({ orderType: "TABLE", tableId: 99 }, owner), /Table not found/);

service.addItem(walkIn.id, { productId: "tracked", quantity: 1, unitPrice: 1 }, cashier);
service.addItem(walkIn.id, { productId: "tracked", quantity: 1 }, cashier);
assert.equal(walkIn.items.length, 1); assert.equal(walkIn.items[0].quantity, 2); assert.equal(walkIn.total, 30);
assert.throws(() => service.addItem(walkIn.id, { productId: "disabled", quantity: 1 }, cashier), /disabled/);
assert.throws(() => service.addItem(walkIn.id, { productId: "tracked", quantity: 0 }, cashier), /positive integer/);
service.updateItemQuantity(walkIn.id, walkIn.items[0].id, { quantity: 1 }, cashier);
assert.equal(walkIn.total, 15);

(async () => {
  const confirmed = await service.confirmOrder(walkIn.id, cashier);
  assert.equal(confirmed.status, "CONFIRMED"); assert.equal(store.products[0].stockQuantity, 1);
  assert.equal(store.stockMovements.filter(item => item.type === "SALE" && item.referenceId === walkIn.id).length, 1);
  await assert.rejects(() => service.confirmOrder(walkIn.id, cashier), /not a draft/);
  assert.throws(() => service.updateItemQuantity(walkIn.id, walkIn.items[0].id, { quantity: 2 }, cashier), /draft/);
  await service.cancelOrder(walkIn.id, { reason: "Customer cancelled" }, manager);
  assert.equal(walkIn.status, "CANCELLED"); assert.equal(store.products[0].stockQuantity, 2);
  assert.equal(store.stockMovements.filter(item => item.type === "RETURN" && item.referenceId === walkIn.id).length, 1);
  await assert.rejects(() => service.cancelOrder(walkIn.id, { reason: "Again" }, manager), /already cancelled/);

  const empty = service.createOrder({ orderType: "WALK_IN" }, cashier);
  await assert.rejects(() => service.confirmOrder(empty.id, cashier), /at least one item/);
  await service.cancelOrder(empty.id, { reason: "No sale" }, cashier);

  const first = service.createOrder({ orderType: "WALK_IN" }, owner), second = service.createOrder({ orderType: "WALK_IN" }, owner);
  service.addItem(first.id, { productId: "tracked", quantity: 2 }, owner); service.addItem(second.id, { productId: "tracked", quantity: 2 }, owner);
  const results = await Promise.allSettled([service.confirmOrder(first.id, owner), service.confirmOrder(second.id, owner)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1, "only one concurrent order can consume final stock");
  assert.equal(store.products[0].stockQuantity, 0); assert.ok(store.products[0].stockQuantity >= 0);
  assert.ok(audit.some(entry => entry.event === "POS_ORDER_CONFIRMED")); assert.ok(audit.some(entry => entry.event === "POS_ORDER_CANCELLED"));
  assert.equal(service.listOrders({}, cashier).items.every(order => order.createdBy === cashier.userId), true, "cashier only sees own orders");
  assert.throws(() => service.addItem(tableOrder.id, { productId: "untracked", quantity: 1 }, staff), /cannot view/);
  console.log("Sprint 8B POS order service tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
