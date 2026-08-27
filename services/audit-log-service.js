const { DEFAULT_HISTORY_MONTHS } = require("../repositories/json-billing-repository");

// Read-only search over the audit trail every other service already writes to via
// billingService.audit(...). No new storage — this just exposes what's already captured
// (actor, event, timestamp, entity IDs, before/after data) through a filterable, paginated view,
// the same shape as BillHistoryService.search() so the frontend pattern is familiar.
//
// The trail itself lives in month files (one append per event, never a rewrite). With no from/to
// this reads the most recent DEFAULT_HISTORY_MONTHS months; a date range reads exactly the months
// it spans. Retention still caps the whole thing at six months.
class AuditLogService {
  constructor(repository) { this.repository = repository; }
  search(query = {}) {
    const actorId = String(query.actorId || "").trim().toLowerCase();
    const event = String(query.event || "").trim().toLowerCase();
    const from = String(query.from || "").trim();
    const to = String(query.to || "").trim();
    if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("Invalid from date");
    if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error("Invalid to date");
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, Number.parseInt(query.pageSize, 10) || 50));
    const bounded = !from && !to;
    const source = bounded
      ? this.repository.recentAuditLogs(DEFAULT_HISTORY_MONTHS)
      : this.repository.auditLogsInRange(from || null, to || null);
    const filtered = source.filter(entry => {
      const entryActor = String(entry.actorId || entry.userId || "").toLowerCase();
      const entryEvent = String(entry.event || "").toLowerCase();
      const date = String(entry.occurredAt || "").slice(0, 10);
      return (!actorId || entryActor.includes(actorId)) && (!event || entryEvent === event) &&
        (!from || date >= from) && (!to || date <= to);
    }).sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
    const total = filtered.length;
    return {
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      scope: { bounded, months: bounded ? DEFAULT_HISTORY_MONTHS : null, from: from || null, to: to || null }
    };
  }
  // Distinct event names for the filter dropdown. Kept as a small registry on the store rather than
  // derived from the trail, so populating a dropdown never means reading months of history.
  eventTypes() { return this.repository.auditEventTypes(); }
}
module.exports = { AuditLogService };
