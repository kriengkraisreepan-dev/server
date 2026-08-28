const { isOpenState, STATES } = require("../domain/session-state");
class JsonSessionRepository {
  constructor({ getStore, save, history = null }) { this.getStore = getStore; this.save = save; this.history = history; }
  sessions(create = false) { const store = this.getStore(); if (!Array.isArray(store.tableSessions) && create) store.tableSessions = []; return store.tableSessions || []; }
  findTable(tableId) { return this.getStore().tables.find(table => String(table.id) === String(tableId)) || null; }
  // Open and just-closed sessions are in store.json; older completed ones live in month files, so
  // a late lookup (voiding last month's bill, say) reads one file instead of keeping every session
  // the shop has ever run in memory. See infrastructure/history-store.js.
  findSession(sessionId) {
    const hot = this.sessions().find(session => session.id === sessionId);
    if (hot || !this.history) return hot || null;
    return this.history.findById("tableSessions", sessionId).record;
  }
  findSessionByTable(tableId) { const table = this.findTable(tableId); return table?.runtimeSessionId ? this.findSession(table.runtimeSessionId) : this.sessions().find(session => String(session.tableId) === String(tableId) && isOpenState(session.state)) || null; }
  findOpenSessionByTable(tableId) { return this.sessions().find(session => String(session.tableId) === String(tableId) && isOpenState(session.state)) || null; }
  syncTable(session) {
    const table = this.findTable(session.tableId); if (!table) throw new Error("Table not found");
    table.runtimeSessionId = session.id;
    if (session.state === STATES.ACTIVE) Object.assign(table, { status: "playing", memberId: session.memberId, startTime: session.openedAt });
    if (session.state === STATES.PAUSED) Object.assign(table, { status: "paused", memberId: session.memberId, startTime: session.openedAt });
    if (session.state === STATES.AWAITING_PAYMENT || session.state === STATES.CLOSED) table.status = "awaiting_payment";
    if (session.state === STATES.CANCELLED) this.releaseTable(session.tableId, false);
  }
  createSession(session) { if (this.findSession(session.id)) throw new Error("Duplicate session ID"); const table = this.findTable(session.tableId); if (!table) throw new Error("Table not found"); table.items = []; this.sessions(true).push(session); this.syncTable(session); this.save(); return session; }
  saveSession(session) {
    const items = this.sessions(true), index = items.findIndex(item => item.id === session.id);
    if (index >= 0) { items[index] = session; this.syncTable(session); this.save(); return session; }
    if (this.history && this.history.isArchived("tableSessions", session)) { this.history.updateArchived("tableSessions", session); return session; }
    throw new Error("Session not found");
  }
  releaseTable(tableId, persist = true) { const table = this.findTable(tableId); if (!table) throw new Error("Table not found"); Object.assign(table, { status: "free", memberId: null, startTime: null, items: [], runtimeSessionId: null }); if (persist) this.save(); return table; }
}
module.exports = { JsonSessionRepository };
