const assert = require("assert");
const { JsonInventoryRepository } = require("../repositories/json-inventory-repository");
const { InventoryService } = require("../services/inventory-service");
const { PERMISSIONS, hasPermission } = require("../domain/permissions");

const store = { products: [{ id: "legacy-water", name: "Water", price: 15, category: "Drinks", active: true }], productCategories: [], stockMovements: [] };
const audits = [];
const repository = new JsonInventoryRepository({ getStore: () => store, save: () => {} });
const service = new InventoryService(repository, { clock: () => new Date("2026-07-26T00:00:00.000Z"), audit: (event, actorId, data) => audits.push({ event, actorId, data }) });

service.normalizeLegacyProducts();
assert.strictEqual(store.products[0].trackStock, false, "legacy products must not accidentally become out of stock");
assert.strictEqual(store.products[0].status, "ACTIVE");
const categories = service.ensureDefaultCategories();
assert.strictEqual(categories.length, 5, "default categories are created only when no category exists");
assert.strictEqual(service.ensureDefaultCategories().length, 5, "default categories are not duplicated");

const drinks = categories[0];
const product = service.createProduct({ sku: "COLA-01", name: "Cola", categoryId: drinks.id, price: 25, cost: 12, trackStock: true, initialStock: 10, lowStockThreshold: 2 }, "owner-1");
assert.strictEqual(product.stockQuantity, 10);
assert.strictEqual(store.stockMovements.length, 1);
assert.strictEqual(store.stockMovements[0].type, "INITIAL");
assert.throws(() => service.createProduct({ sku: "COLA-01", name: "Duplicate", price: 1 }, "owner-1"), /SKU already exists/);
assert.throws(() => service.createProduct({ name: "Invalid", price: -1 }, "owner-1"), /Price/);

const received = service.receiveStock(product.id, { quantity: 5, reason: "Supplier delivery" }, "manager-1");
assert.strictEqual(received.product.stockQuantity, 15);
const adjusted = service.adjustStock(product.id, { quantityChange: -3, reason: "Damaged" }, "manager-1");
assert.strictEqual(adjusted.product.stockQuantity, 12);
assert.throws(() => service.adjustStock(product.id, { quantityChange: -13, reason: "Broken" }, "manager-1"), /Stock cannot be negative/);
assert.throws(() => service.adjustStock(product.id, { quantityChange: 1, reason: "" }, "manager-1"), /reason is required/);
assert.strictEqual(service.getStockMovements(product.id).total, 3);

service.changeProductStatus(product.id, "DISABLED", "owner-1");
assert.strictEqual(service.getProduct(product.id, "STAFF"), null, "staff only sees active products");
service.changeProductStatus(product.id, "ACTIVE", "owner-1");
assert.strictEqual(service.getProduct(product.id, "CASHIER").name, "Cola");
assert.ok(audits.some(item => item.event === "PRODUCT_CREATED"));
assert.ok(audits.some(item => item.event === "STOCK_RECEIVED"));
assert.ok(audits.some(item => item.event === "STOCK_ADJUSTED"));

assert.ok(hasPermission("OWNER", PERMISSIONS.PRODUCT_MANAGE));
assert.ok(hasPermission("MANAGER", PERMISSIONS.INVENTORY_MANAGE));
assert.ok(hasPermission("CASHIER", PERMISSIONS.PRODUCT_VIEW));
assert.ok(hasPermission("STAFF", PERMISSIONS.PRODUCT_VIEW));
assert.ok(!hasPermission("CASHIER", PERMISSIONS.PRODUCT_MANAGE));
assert.ok(!hasPermission("STAFF", PERMISSIONS.INVENTORY_MANAGE));

console.log("Sprint 8A product and inventory tests passed");
