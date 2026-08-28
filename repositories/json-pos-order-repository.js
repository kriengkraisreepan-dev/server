const DEFAULT_HISTORY_MONTHS = 3;

// Orders that are still open (DRAFT, or CONFIRMED but not yet billed) stay in store.json — they are
// the working set the table cards and the POS screen read on every refresh. Finished orders move
// into month files, so a shop with ten years of walk-in sales still writes store.json in the same
// few milliseconds it did on its first day. See infrastructure/history-store.js.
class JsonPosOrderRepository {
  constructor({ getStore, save, history = null }) { this.getStore = getStore; this.save = save; this.history = history; }
  orders(create = false) { const store = this.getStore(); if (!Array.isArray(store.posOrders) && create) store.posOrders = []; return store.posOrders || []; }
  list() { return this.orders(); }
  // The order list screen: the most recent months by default, exactly the months a from/to spans
  // when one is given.
  listForQuery({ from = "", to = "" } = {}) {
    if (!this.history) return this.orders();
    if (!from && !to) return this.history.recent("posOrders", DEFAULT_HISTORY_MONTHS);
    return this.history.inRange("posOrders", from || null, to || null);
  }
  findById(id) {
    const hot = this.orders().find(order => order.id === id);
    if (hot || !this.history) return hot || null;
    return this.history.findById("posOrders", id).record;
  }
  findByOrderNumber(orderNumber) {
    const hot = this.orders().find(order => order.orderNumber === orderNumber);
    if (hot || !this.history) return hot || null;
    return this.history.recent("posOrders", DEFAULT_HISTORY_MONTHS).find(order => order.orderNumber === orderNumber) || null;
  }
  create(order, persist = true) { this.orders(true).unshift(order); if (persist) this.save(); return order; }
  update(order, persist = true) {
    const items = this.orders(true), index = items.findIndex(item => item.id === order.id);
    if (index >= 0) { items[index] = order; if (persist) this.save(); return order; }
    // Already swept into a month file (cancelling or re-billing an older order): append the new
    // version to the month it was created in rather than pulling it back into the hot set.
    if (this.history && this.history.isArchived("posOrders", order)) { this.history.updateArchived("posOrders", order); return order; }
    throw new Error("POS order not found");
  }
  persist() { this.save(); }
}
module.exports = { JsonPosOrderRepository, DEFAULT_HISTORY_MONTHS };
