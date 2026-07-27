class JsonPosOrderRepository {
  constructor({ getStore, save }) { this.getStore = getStore; this.save = save; }
  orders(create = false) { const store = this.getStore(); if (!Array.isArray(store.posOrders) && create) store.posOrders = []; return store.posOrders || []; }
  list() { return this.orders(); }
  findById(id) { return this.orders().find(order => order.id === id) || null; }
  findByOrderNumber(orderNumber) { return this.orders().find(order => order.orderNumber === orderNumber) || null; }
  create(order, persist = true) { this.orders(true).unshift(order); if (persist) this.save(); return order; }
  update(order, persist = true) { const items = this.orders(true), index = items.findIndex(item => item.id === order.id); if (index < 0) throw new Error("POS order not found"); items[index] = order; if (persist) this.save(); return order; }
  persist() { this.save(); }
}
module.exports = { JsonPosOrderRepository };
