const assert = require("assert");
const { JsonInventoryRepository } = require("../repositories/json-inventory-repository");
const { JsonPosOrderRepository } = require("../repositories/json-pos-order-repository");
const { InventoryService } = require("../services/inventory-service");
const { PosOrderService } = require("../services/pos-order-service");

const store = { products: [{ id: "last-item", name: "Last item", price: 10, cost: 0, status: "ACTIVE", active: true, trackStock: true, stockQuantity: 1, lowStockThreshold: 0 }], stockMovements: [], posOrders: [] };
const save = () => {}, inventory = new InventoryService(new JsonInventoryRepository({ getStore: () => store, save }), { audit: () => {} });
const service = new PosOrderService(new JsonPosOrderRepository({ getStore: () => store, save }), inventory, { audit: () => {} });
const owner = { userId: "owner", role: "OWNER" };
const first = service.createOrder({ orderType: "WALK_IN" }, owner), second = service.createOrder({ orderType: "WALK_IN" }, owner);
service.addItem(first.id, { productId: "last-item", quantity: 1 }, owner); service.addItem(second.id, { productId: "last-item", quantity: 1 }, owner);
(async () => { const result = await Promise.allSettled([service.confirmOrder(first.id, owner), service.confirmOrder(second.id, owner)]); assert.equal(result.filter(item => item.status === "fulfilled").length, 1); assert.equal(store.products[0].stockQuantity, 0); assert.equal(store.stockMovements.filter(item => item.type === "SALE").length, 1); console.log("Sprint 8B stock concurrency tests passed"); })().catch(error => { console.error(error); process.exitCode = 1; });
