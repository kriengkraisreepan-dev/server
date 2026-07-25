const crypto = require("crypto");
const { calculateSessionCharge, calculateSessionPreview, snapshotPricing } = require("../domain/pricing");
const { STATES, nextState } = require("../domain/session-state");
class TableSessionService {
  constructor(repository, clock = () => new Date()) { this.repository = repository; this.clock = clock; }
  now() { return this.clock().toISOString(); }
  requireTable(tableId) { const table = this.repository.findTable(tableId); if (!table) throw new Error("Table not found"); return table; }
  openSession({ tableId, memberId = null, pricingProfile }) { this.requireTable(tableId); if (this.repository.findOpenSessionByTable(tableId)) throw new Error("Table already has an active session"); const session = { id: crypto.randomUUID(), tableId, memberId, state: STATES.ACTIVE, openedAt: this.now(), pausedAt: null, pausedSeconds: 0, pricingSnapshot: snapshotPricing(pricingProfile), closedAt: null, finalChargeSatang: null }; return this.repository.createSession(session); }
  pauseSession(sessionId) { const session = this.requireSession(sessionId); session.state = nextState(session.state, "PAUSE"); session.pausedAt = this.now(); return this.repository.saveSession(session); }
  resumeSession(sessionId) { const session = this.requireSession(sessionId); const resumedAt = this.now(); if (!session.pausedAt) throw new Error("Paused session has no pausedAt time"); const paused = Math.floor((new Date(resumedAt) - new Date(session.pausedAt)) / 1000); if (paused < 0) throw new Error("Resume time cannot be before pause time"); session.pausedSeconds += paused; session.pausedAt = null; session.state = nextState(session.state, "RESUME"); return this.repository.saveSession(session); }
  billableSeconds(session, at = this.now()) { const elapsed = Math.floor((new Date(at) - new Date(session.openedAt)) / 1000); if (elapsed < 0) throw new Error("Session time cannot be negative"); const currentPause = session.state === STATES.PAUSED && session.pausedAt ? Math.floor((new Date(at) - new Date(session.pausedAt)) / 1000) : 0; const total = elapsed - session.pausedSeconds - currentPause; if (total < 0) throw new Error("Session billable time cannot be negative"); return total; }
  previewCharge(sessionId) { const session = this.requireSession(sessionId); if (session.finalChargeSatang !== null) return session.finalChargeSatang; return calculateSessionPreview(session.pricingSnapshot, this.billableSeconds(session)); }
  awaitPaymentSession(sessionId) { const session = this.requireSession(sessionId); if (session.state === STATES.PAUSED) this.resumeSession(sessionId); const current = this.requireSession(sessionId), closedAt = this.now(); const billableSeconds = this.billableSeconds(current, closedAt); current.state = nextState(current.state, "AWAIT_PAYMENT"); current.closedAt = closedAt; current.billableSeconds = billableSeconds; current.finalChargeSatang = calculateSessionCharge(current.pricingSnapshot, billableSeconds); return this.repository.saveSession(current); }
  // Kept as a compatibility alias for callers introduced before the payment workflow.
  closeSession(sessionId) { return this.awaitPaymentSession(sessionId); }
  completeSession(sessionId) { const session = this.requireSession(sessionId); session.state = nextState(session.state, "CLOSE"); return this.repository.saveSession(session); }
  cancelSession(sessionId) { const session = this.requireSession(sessionId); session.state = nextState(session.state, "CANCEL"); session.closedAt = this.now(); session.finalChargeSatang = 0; return this.repository.saveSession(session); }
  requireSession(sessionId) { const session = this.repository.findSession(sessionId); if (!session) throw new Error("Session not found"); return session; }
}
module.exports = { TableSessionService };
