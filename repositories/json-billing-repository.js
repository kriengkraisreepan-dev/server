// Audit log entries are operational history (who clicked what, when), not financial records —
// unlike bills/payments, which are never auto-deleted (voided bills are explicitly kept "for
// audit" per their own void message). Pruned entries older than this are gone for good, so this
// window is deliberately conservative; widen it if the shop ever needs longer traceability.
const AUDIT_LOG_RETENTION_MONTHS = 6;
// Pruning is now a whole-month file delete rather than a filter over every entry ever written, but
// there is still no reason to check more than once a day. Tracked via auditLogPrunedAt on the store.
const AUDIT_LOG_PRUNE_THROTTLE_MS = 24 * 60 * 60 * 1000;
// How far back the history screens look when nobody has picked a date range. Older records are
// still there and still searchable — they just need an explicit from/to, so that opening a screen
// can never mean reading twenty years of month files.
const DEFAULT_HISTORY_MONTHS = 3;

// Bills, payments and the audit trail live in month files (see infrastructure/history-store.js);
// store.json keeps only what is still in play. Everything below therefore comes in two halves: the
// hot array, which is what the running shop touches, and a read-through into the archive for the
// history and reporting screens.
class JsonBillingRepository {
  constructor({ getStore, save, history = null }) { this.getStore = getStore; this.save = save; this.history = history; }
  collection(name) { const store = this.getStore(); if (!Array.isArray(store[name])) store[name] = []; return store[name]; }
  bills() { return this.collection("bills"); }
  payments() { return this.collection("payments"); }

  // Hot first, then the archive. `hintIso` is the record's own createdAt when the caller already
  // has it, which turns the archive lookup into a single month-file read.
  findBill(id, hintIso = null) {
    const hot = this.bills().find(item => item.id === id);
    if (hot || !this.history) return hot || null;
    return this.history.findById("bills", id, { hintIso }).record;
  }
  findPayment(id, hintIso = null) {
    const hot = this.payments().find(item => item.id === id);
    if (hot || !this.history) return hot || null;
    return this.history.findById("payments", id, { hintIso }).record;
  }
  findBillsByIds(ids) {
    const set = new Set(ids);
    const found = this.bills().filter(item => set.has(item.id));
    if (!this.history || found.length === set.size) return found;
    const missing = [...set].filter(id => !found.some(item => item.id === id));
    for (const id of missing) { const record = this.history.findById("bills", id).record; if (record) found.push(record); }
    return found;
  }

  // A record that has already been swept into a month file is updated by appending its new version
  // to that same file (voiding a bill from last year, for instance). Readers keep the last version
  // of each id, so the write stays O(1) however far back the original was.
  persistRecord(key, collection, record) {
    const index = collection.findIndex(item => item.id === record.id);
    if (index >= 0) { collection[index] = record; this.save(); return record; }
    if (this.history && this.history.mayBeArchived(key, record) && this.history.isArchived(key, record)) { this.history.updateArchived(key, record); return record; }
    collection.unshift(record);
    this.save();
    return record;
  }
  saveBill(bill) { return this.persistRecord("bills", this.bills(), bill); }
  savePayment(payment) { return this.persistRecord("payments", this.payments(), payment); }

  // ---- history reads ---------------------------------------------------------------------------
  billsInRange(fromDay, toDay) { return this.history ? this.history.inRange("bills", fromDay, toDay) : this.bills(); }
  recentBills(months = DEFAULT_HISTORY_MONTHS) { return this.history ? this.history.recent("bills", months) : this.bills(); }
  paymentsForBill(billId, hintIso = null) {
    const hot = this.payments().filter(payment => payment.billId === billId);
    if (!this.history) return hot;
    const month = hintIso ? String(hintIso).slice(0, 7) : null;
    const seen = new Set(hot.map(payment => payment.id));
    const archived = (month ? this.history.archive("payments").readMonth(month) : this.history.recent("payments", DEFAULT_HISTORY_MONTHS))
      .filter(payment => payment.billId === billId && !seen.has(payment.id));
    return [...hot, ...archived];
  }

  // ---- audit trail -----------------------------------------------------------------------------
  auditRetentionCutoffIso(now = new Date()) { const cutoff = new Date(now); cutoff.setMonth(cutoff.getMonth() - AUDIT_LOG_RETENTION_MONTHS); return cutoff.toISOString(); }
  auditRetentionCutoffMonth(now = new Date()) { return this.auditRetentionCutoffIso(now).slice(0, 7); }
  // Unconditional — call once at boot (in addition to the throttled check on every append) so
  // entries don't linger past retention just because the server sat off for a while.
  // With the trail in month files this is a whole-file delete per expired month, which also means
  // retention is now "at least six months" rather than "exactly six months to the second": a month
  // is kept until all of it has aged past the cutoff. That is the safe direction for an audit
  // trail, and it is what makes pruning cost nothing as the shop's history grows.
  // Without a history store (unit tests, and any caller still holding the trail inline) it falls
  // back to the original entry-by-entry filter.
  pruneAuditLogs(now = new Date()) {
    const store = this.getStore();
    store.auditLogPrunedAt = now.toISOString();
    if (this.history) return this.history.dropAuditMonthsBefore(this.auditRetentionCutoffMonth(now)).length;
    const cutoff = this.auditRetentionCutoffIso(now);
    const before = this.collection("auditLogs").length;
    store.auditLogs = this.collection("auditLogs").filter(entry => String(entry.occurredAt || "") >= cutoff);
    return before - store.auditLogs.length;
  }
  maybePruneAuditLogs(now = new Date()) {
    const store = this.getStore();
    const last = store.auditLogPrunedAt ? new Date(store.auditLogPrunedAt) : null;
    if (last && !Number.isNaN(last.getTime()) && (now - last) < AUDIT_LOG_PRUNE_THROTTLE_MS) return 0;
    return this.pruneAuditLogs(now);
  }
  // The single hottest write in the system: every action the shop takes appends one of these. It
  // is one line on the end of the current month's file — the same cost on day 7000 as on day 1.
  // The save() that follows is for whatever the caller changed alongside it, and is cheap now that
  // store.json holds only the working set.
  appendAudit(event) {
    this.maybePruneAuditLogs();
    if (this.history) this.history.archive("auditLogs").append(event);
    else this.collection("auditLogs").push(event);
    this.registerAuditEventType(event.event);
    this.save();
    return event;
  }
  // The Audit screen's event filter needs the list of distinct event names. Deriving it by reading
  // the whole trail would defeat the point of archiving it, so the (few dozen, bounded) names are
  // kept alongside the working set as they are first seen.
  registerAuditEventType(name) {
    if (!name) return;
    const store = this.getStore();
    if (!Array.isArray(store.auditEventTypes)) store.auditEventTypes = [];
    if (!store.auditEventTypes.includes(name)) { store.auditEventTypes.push(name); store.auditEventTypes.sort(); }
  }
  auditEventTypes() {
    const store = this.getStore();
    if (Array.isArray(store.auditEventTypes) && store.auditEventTypes.length) return [...store.auditEventTypes];
    return [...new Set(this.collection("auditLogs").map(entry => entry.event).filter(Boolean))].sort();
  }
  auditLogsInRange(fromDay, toDay) { return this.history ? this.history.inRange("auditLogs", fromDay, toDay) : this.collection("auditLogs"); }
  recentAuditLogs(months = DEFAULT_HISTORY_MONTHS) { return this.history ? this.history.recent("auditLogs", months) : this.collection("auditLogs"); }
  // Reads the month the bill was created in plus the one after it, so events recorded either side
  // of a month boundary (a bill opened on the 31st and paid on the 1st) are both picked up.
  auditForBill(billId, hintIso = null) {
    if (!this.history) return this.collection("auditLogs").filter(event => event.billId === billId).sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));
    const bill = hintIso ? { createdAt: hintIso } : this.findBill(billId);
    const from = String(bill?.createdAt || "").slice(0, 10);
    const events = from
      ? this.history.inRange("auditLogs", from, new Date(new Date(from).getTime() + 62 * 86400000).toISOString().slice(0, 10))
      : this.recentAuditLogs();
    return events.filter(event => event.billId === billId).sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));
  }

  // Receipt numbers are per calendar day and issued for "now", so this only ever looks at bills the
  // shop is still holding hot — never at the archive.
  nextReceiptNumber(isoDate) {
    const prefix = String(isoDate).slice(0, 10).replaceAll("-", "");
    const pattern = new RegExp(`^${prefix}-(\\d{6})$`);
    const sameDay = this.history && String(isoDate).slice(0, 10) < String(this.history.hotCutoffIso()).slice(0, 10)
      ? this.history.inRange("bills", String(isoDate).slice(0, 10), String(isoDate).slice(0, 10))
      : this.bills();
    const existing = sameDay.map(bill => bill.receiptNumber || bill.number).map(value => pattern.exec(String(value))).filter(Boolean).map(match => Number(match[1]));
    const next = Math.max(0, ...existing) + 1;
    return `${prefix}-${String(next).padStart(6, "0")}`;
  }
}
module.exports = { JsonBillingRepository, AUDIT_LOG_RETENTION_MONTHS, AUDIT_LOG_PRUNE_THROTTLE_MS, DEFAULT_HISTORY_MONTHS };
