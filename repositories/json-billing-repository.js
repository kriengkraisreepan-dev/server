// Audit log entries are operational history (who clicked what, when), not financial records —
// unlike bills/payments, which are never auto-deleted (voided bills are explicitly kept "for
// audit" per their own void message). Pruned entries older than this are gone for good, so this
// window is deliberately conservative; widen it if the shop ever needs longer traceability.
const AUDIT_LOG_RETENTION_MONTHS = 6;
// Actually scanning+filtering the whole audit log on every single append would get more wasteful
// as the log grows — exactly the kind of cost this feature exists to bound. Throttling the real
// prune to roughly once per calendar day (tracked via auditLogPrunedAt on the store) keeps that
// cost flat regardless of how often events are appended.
const AUDIT_LOG_PRUNE_THROTTLE_MS = 24 * 60 * 60 * 1000;

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
  auditRetentionCutoffIso(now = new Date()) { const cutoff = new Date(now); cutoff.setMonth(cutoff.getMonth() - AUDIT_LOG_RETENTION_MONTHS); return cutoff.toISOString(); }
  // Unconditional — call once at boot (in addition to the throttled check on every append) so
  // entries don't linger past retention just because the server sat off for a while.
  pruneAuditLogs(now = new Date()) {
    const store = this.getStore();
    const cutoff = this.auditRetentionCutoffIso(now);
    const before = this.auditLogs().length;
    store.auditLogs = this.auditLogs().filter(entry => String(entry.occurredAt || "") >= cutoff);
    store.auditLogPrunedAt = now.toISOString();
    return before - store.auditLogs.length;
  }
  maybePruneAuditLogs(now = new Date()) {
    const store = this.getStore();
    const last = store.auditLogPrunedAt ? new Date(store.auditLogPrunedAt) : null;
    if (last && !Number.isNaN(last.getTime()) && (now - last) < AUDIT_LOG_PRUNE_THROTTLE_MS) return 0;
    return this.pruneAuditLogs(now);
  }
  appendAudit(event) { this.maybePruneAuditLogs(); this.auditLogs().push(event); this.save(); return event; }
  auditForBill(billId) { return this.auditLogs().filter(event => event.billId === billId).sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt))); }
  nextReceiptNumber(isoDate) {
    const prefix = String(isoDate).slice(0, 10).replaceAll("-", "");
    const pattern = new RegExp(`^${prefix}-(\\d{6})$`);
    const existing = this.bills().map(bill => bill.receiptNumber || bill.number).map(value => pattern.exec(String(value))).filter(Boolean).map(match => Number(match[1]));
    const next = Math.max(0, ...existing) + 1;
    return `${prefix}-${String(next).padStart(6, "0")}`;
  }
}
module.exports = { JsonBillingRepository, AUDIT_LOG_RETENTION_MONTHS, AUDIT_LOG_PRUNE_THROTTLE_MS };
