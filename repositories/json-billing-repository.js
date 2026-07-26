class JsonBillingRepository {
  constructor({ getStore, save }) { this.getStore = getStore; this.save = save; }
  collection(name) { const store = this.getStore(); if (!Array.isArray(store[name])) store[name] = []; return store[name]; }
  bills() { return this.collection("bills"); }
  payments() { return this.collection("payments"); }
  auditLogs() { return this.collection("auditLogs"); }
  findBill(id) { return this.bills().find(item => item.id === id) || null; }
  findBillsByIds(ids) { const set = new Set(ids); return this.bills().filter(item => set.has(item.id)); }
  findPayment(id) { return this.payments().find(item => item.id === id) || null; }
  saveBill(bill) { const items = this.bills(); const index = items.findIndex(item => item.id === bill.id); if (index < 0) items.unshift(bill); else items[index] = bill; this.save(); return bill; }
  savePayment(payment) { const items = this.payments(); const index = items.findIndex(item => item.id === payment.id); if (index < 0) items.unshift(payment); else items[index] = payment; this.save(); return payment; }
  appendAudit(event) { this.auditLogs().push(event); this.save(); return event; }
  auditForBill(billId) { return this.auditLogs().filter(event => event.billId === billId).sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt))); }
  nextReceiptNumber(isoDate) {
    const prefix = String(isoDate).slice(0, 10).replaceAll("-", "");
    const pattern = new RegExp(`^${prefix}-(\\d{6})$`);
    const existing = this.bills().map(bill => bill.receiptNumber || bill.number).map(value => pattern.exec(String(value))).filter(Boolean).map(match => Number(match[1]));
    const next = Math.max(0, ...existing) + 1;
    return `${prefix}-${String(next).padStart(6, "0")}`;
  }
}
module.exports = { JsonBillingRepository };
