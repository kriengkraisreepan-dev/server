// How far back the archive is searched when a stock movement is not in the working set. A movement
// is looked up by the POS order that caused it, and an order old enough to fall outside this
// window has long since been billed or cancelled — but the window is generous because the cost is
// only paid on the rare miss, never on a sale.
const MOVEMENT_LOOKBACK_MONTHS = 24;

// Products and categories are the shop's catalogue: small, bounded, and read constantly, so they
// stay in store.json. Stock movements are the opposite — an append-only ledger written on every
// sale and read only when someone opens a product's history — so they live in month files. See
// infrastructure/history-store.js.
class JsonInventoryRepository {
  constructor({ getStore, save, history = null }) { this.getStore = getStore; this.save = save; this.history = history; }
  collection(name) {
    const store = this.getStore();
    if (!Array.isArray(store[name])) store[name] = [];
    return store[name];
  }
  products() { return this.collection("products"); }
  categories() { return this.collection("productCategories"); }
  movements() { return this.collection("stockMovements"); }
  findProduct(id) { return this.products().find(product => product.id === id) || null; }
  findCategory(id) { return this.categories().find(category => category.id === id) || null; }
  saveProduct(product) { const items = this.products(); const index = items.findIndex(item => item.id === product.id); if (index < 0) items.push(product); else items[index] = product; this.save(); return product; }
  saveCategory(category) { const items = this.categories(); const index = items.findIndex(item => item.id === category.id); if (index < 0) items.push(category); else items[index] = category; this.save(); return category; }
  appendMovement(movement) { this.movements().unshift(movement); this.save(); return movement; }

  // Every movement caused by one POS order, newest first. Checks the working set before the
  // archive, so confirming or cancelling a recent order — the normal case — never opens a file.
  // The archive fallback matters for an order that sat on a tab for longer than the hot window:
  // its movements will have been swept out, and cancelling it still has to find them to put the
  // stock back.
  movementsForReference(referenceId, type = null) {
    const matches = movement => movement.referenceType === "POS_ORDER" && movement.referenceId === referenceId && (!type || movement.type === type);
    const hot = this.movements().filter(matches);
    if (hot.length || !this.history) return hot;
    const found = [];
    this.history.archive("stockMovements").scanNewestFirst(records => {
      const hits = records.filter(matches);
      found.push(...hits);
      return true;
    }, { maxMonths: MOVEMENT_LOOKBACK_MONTHS });
    return found;
  }
  hasMovementForReference(referenceId, type) { return this.movementsForReference(referenceId, type).length > 0; }

  // One product's movement history for the product screen: the working set plus the months the
  // requested range covers, newest first. The default window is a year rather than the three
  // months the bill and audit screens use — this screen is opened rarely and is the thing an owner
  // reaches for when reconciling stock, so a short default would surprise more than it saves.
  movementsForProduct(productId, { from = "", to = "", months = 12 } = {}) {
    const matches = movement => movement.productId === productId;
    const hot = this.movements().filter(matches);
    if (!this.history) return hot;
    const archived = (from || to ? this.history.inRange("stockMovements", from || null, to || null) : this.history.recent("stockMovements", months)).filter(matches);
    const seen = new Set(hot.map(movement => movement.id));
    return [...hot, ...archived.filter(movement => !seen.has(movement.id))]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  persist() { this.save(); }
}

module.exports = { JsonInventoryRepository, MOVEMENT_LOOKBACK_MONTHS };
