const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { HistoryStore } = require("../infrastructure/history-store");
const { JsonInventoryRepository } = require("../repositories/json-inventory-repository");
const { InventoryService } = require("../services/inventory-service");

// Stock movements now live in month files. The risk that introduces is that the two places which
// look a movement up by the POS order that caused it — the already-deducted guard and the restore
// that puts stock back when an order is cancelled — stop finding movements that have been swept
// out. An order can sit on a tab for far longer than the hot window and still be cancellable, so
// these have to reach into the archive.

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-stock-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
const daysAgo = (now, days) => new Date(now.getTime() - days * 86400000).toISOString();

function harness(t, store = {}) {
  const directory = temporaryDirectory(t);
  const state = { products: [], productCategories: [], stockMovements: [], bills: [], payments: [], posOrders: [], tableSessions: [], auditLogs: [], ...store };
  const history = new HistoryStore({ directory, getStore: () => state, save: () => {} });
  const repository = new JsonInventoryRepository({ getStore: () => state, save: () => {}, history });
  return { history, state, repository };
}
const movement = (id, referenceId, overrides = {}) => ({ id, productId: "p-1", type: "SALE", quantityBefore: 10, quantityChange: -2, quantityAfter: 8, reason: "", referenceType: "POS_ORDER", referenceId, createdAt: new Date().toISOString(), createdBy: "admin", ...overrides });

test("a movement swept into a month file is still found by the order that caused it", t => {
  const now = new Date("2026-08-20T12:00:00.000Z");
  const h = harness(t, { stockMovements: [movement("m1", "order-1", { createdAt: daysAgo(now, 40) })] });
  h.history.sweep(now);
  assert.deepEqual(h.state.stockMovements, [], "it left the working set");
  const found = h.repository.movementsForReference("order-1", "SALE");
  assert.deepEqual(found.map(item => item.id), ["m1"]);
  assert.equal(h.repository.hasMovementForReference("order-1", "SALE"), true);
});

test("the working set answers first, without opening a file", t => {
  const h = harness(t, { stockMovements: [movement("m1", "order-1")] });
  let opened = 0;
  const archive = h.history.archive("stockMovements");
  const original = archive.readMonth.bind(archive);
  archive.readMonth = month => { opened += 1; return original(month); };
  assert.deepEqual(h.repository.movementsForReference("order-1", "SALE").map(item => item.id), ["m1"]);
  assert.equal(opened, 0, "a sale confirmed moments ago must not cost a file read");
});

test("an order with no movements anywhere reports none", t => {
  const h = harness(t, { stockMovements: [movement("m1", "order-1")] });
  assert.deepEqual(h.repository.movementsForReference("order-2", "SALE"), []);
  assert.equal(h.repository.hasMovementForReference("order-2", "SALE"), false);
});

test("the type filter is honoured across the archive", t => {
  const now = new Date("2026-08-20T12:00:00.000Z");
  const h = harness(t, { stockMovements: [
    movement("sale", "order-1", { createdAt: daysAgo(now, 40) }),
    movement("return", "order-1", { type: "RETURN", createdAt: daysAgo(now, 40) })
  ] });
  h.history.sweep(now);
  assert.deepEqual(h.repository.movementsForReference("order-1", "SALE").map(item => item.id), ["sale"]);
  assert.deepEqual(h.repository.movementsForReference("order-1", "RETURN").map(item => item.id), ["return"]);
  assert.equal(h.repository.movementsForReference("order-1").length, 2);
});

test("cancelling a tab opened before the hot window still puts the stock back", t => {
  // The whole point of the archive fallback: this order was confirmed six weeks ago, never billed,
  // and is only being cancelled now. Its movements are in a month file.
  const now = new Date("2026-08-20T12:00:00.000Z");
  const product = { id: "p-1", name: "โค้ก", price: 25, active: true, trackStock: true, stockQuantity: 8, categoryId: "c-1" };
  const h = harness(t, {
    products: [product],
    stockMovements: [movement("m1", "order-1", { createdAt: daysAgo(now, 42), quantityChange: -2, quantityBefore: 10, quantityAfter: 8 })]
  });
  h.history.sweep(now);
  assert.deepEqual(h.state.stockMovements, []);

  const service = new InventoryService(h.repository, { audit: () => {} });
  const restored = service.restoreStockForCancelledSale(
    [{ productId: "p-1", quantity: 2 }],
    { referenceId: "order-1", actorId: "admin", reason: "ยกเลิกออเดอร์", persist: false }
  );
  assert.equal(restored.length, 1);
  assert.equal(product.stockQuantity, 10, "the two units are back on the shelf");
});

test("a product's movement history spans the working set and the archive, newest first", t => {
  const now = new Date("2026-08-20T12:00:00.000Z");
  const h = harness(t, { stockMovements: [
    movement("old", "order-1", { createdAt: daysAgo(now, 40) }),
    movement("recent", "order-2", { createdAt: daysAgo(now, 1) }),
    movement("other-product", "order-3", { productId: "p-2", createdAt: daysAgo(now, 40) })
  ] });
  h.history.sweep(now);
  const all = h.repository.movementsForProduct("p-1");
  assert.deepEqual(all.map(item => item.id), ["recent", "old"]);
  assert.equal(all.some(item => item.productId === "p-2"), false);
});
