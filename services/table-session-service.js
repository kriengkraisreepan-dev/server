const crypto = require("crypto");
const { calculateSessionCharge, calculateSessionPreview, snapshotSegmentedPricing, isSegmented, calculateSegmentedCharge } = require("../domain/pricing");
const { STATES, nextState } = require("../domain/session-state");
class TableSessionService {
  constructor(repository, clock = () => new Date()) { this.repository = repository; this.clock = clock; }
  now() { return this.clock().toISOString(); }
  requireTable(tableId) { const table = this.repository.findTable(tableId); if (!table) throw new Error("Table not found"); return table; }
  openSession({ tableId, memberId = null, pricingProfile }) { this.requireTable(tableId); if (this.repository.findOpenSessionByTable(tableId)) throw new Error("Table already has an active session"); const session = { id: crypto.randomUUID(), tableId, memberId, state: STATES.ACTIVE, openedAt: this.now(), pausedAt: null, pausedSeconds: 0, pricingSnapshot: snapshotSegmentedPricing(pricingProfile), pauseIntervals: [], closedAt: null, finalChargeSatang: null }; return this.repository.createSession(session); }
  pauseSession(sessionId) { const session = this.requireSession(sessionId); session.state = nextState(session.state, "PAUSE"); session.pausedAt = this.now(); return this.repository.saveSession(session); }
  resumeSession(sessionId) { const session = this.requireSession(sessionId); const resumedAt = this.now(); if (!session.pausedAt) throw new Error("Paused session has no pausedAt time"); const paused = Math.floor((new Date(resumedAt) - new Date(session.pausedAt)) / 1000); if (paused < 0) throw new Error("Resume time cannot be before pause time"); session.pausedSeconds += paused; if (!Array.isArray(session.pauseIntervals)) session.pauseIntervals = []; session.pauseIntervals.push({ from: session.pausedAt, to: resumedAt }); session.pausedAt = null; session.state = nextState(session.state, "RESUME"); return this.repository.saveSession(session); }
  billableSeconds(session, at = this.now()) { const elapsed = Math.floor((new Date(at) - new Date(session.openedAt)) / 1000); if (elapsed < 0) throw new Error("Session time cannot be negative"); const currentPause = session.state === STATES.PAUSED && session.pausedAt ? Math.floor((new Date(at) - new Date(session.pausedAt)) / 1000) : 0; const total = elapsed - session.pausedSeconds - currentPause; if (total < 0) throw new Error("Session billable time cannot be negative"); return total; }
  // A session paused right now has no end yet, so the running preview is priced up to this moment
  // and the in-progress pause is excluded by passing it as a closed interval.
  segmentInput(session, endsAt) { const pauseIntervals = [...(session.pauseIntervals || [])]; if (session.state === STATES.PAUSED && session.pausedAt) pauseIntervals.push({ from: session.pausedAt, to: endsAt }); return { openedAt: session.openedAt, endsAt, pauseIntervals, pausedSeconds: session.pausedSeconds || 0 }; }
  rateSegments(sessionId, endsAt = this.now()) { const session = this.requireSession(sessionId); if (!isSegmented(session.pricingSnapshot)) return null; return calculateSegmentedCharge(session.pricingSnapshot, this.segmentInput(session, session.closedAt || endsAt)).segments; }
  // The charge and the segments that explain it must be read at the SAME instant. The bill takes its
  // table charge from a preview and the session is closed a few milliseconds later, and at
  // ฿120/hour even one extra second moves the total — so segments computed at close would not add up
  // to the charge printed above them on the receipt. Callers that need both take them from here.
  previewBreakdown(sessionId) {
    const session = this.requireSession(sessionId);
    if (session.finalChargeSatang !== null) return { chargeSatang: session.finalChargeSatang, segments: session.rateSegments || null };
    // Sessions opened before segmented billing shipped keep the single rate they were quoted at.
    if (!isSegmented(session.pricingSnapshot)) return { chargeSatang: calculateSessionPreview(session.pricingSnapshot, this.billableSeconds(session)), segments: null };
    const result = calculateSegmentedCharge(session.pricingSnapshot, this.segmentInput(session, this.now()));
    // Only offer the itemisation when it is exact. If the minimum charge is doing the work the lines
    // would sum to less than the charge above them, and a receipt that does not add up is worse than
    // one that just says "ค่าบริการโต๊ะ".
    return { chargeSatang: result.previewSatang, segments: result.subtotalSatang === result.previewSatang ? result.segments : null };
  }
  previewCharge(sessionId) { return this.previewBreakdown(sessionId).chargeSatang; }
  awaitPaymentSession(sessionId) { const session = this.requireSession(sessionId); if (session.state === STATES.PAUSED) this.resumeSession(sessionId); const current = this.requireSession(sessionId), closedAt = this.now(); const billableSeconds = this.billableSeconds(current, closedAt); current.state = nextState(current.state, "AWAIT_PAYMENT"); current.closedAt = closedAt; current.billableSeconds = billableSeconds;
    if (!isSegmented(current.pricingSnapshot)) { current.finalChargeSatang = calculateSessionCharge(current.pricingSnapshot, billableSeconds); return this.repository.saveSession(current); }
    const result = calculateSegmentedCharge(current.pricingSnapshot, this.segmentInput(current, closedAt));
    // The segments are frozen onto the session — the receipt prints them, and a reprint months later
    // must show the same lines even if the Happy Hour rules have been rewritten since.
    current.rateSegments = result.segments;
    current.finalChargeSatang = result.chargeSatang;
    return this.repository.saveSession(current); }
  // Moves a running session to another table — the customer changes tables mid-game, usually
  // because something is wrong with the one they are on.
  //
  // The session keeps its id, its opened time, its pauses and, deliberately, its pricingSnapshot:
  // the customer is charged the rate they were quoted when they sat down, even if the table they
  // move to is on a different pricing profile. Re-pricing mid-session would also mean re-cutting
  // the Happy Hour segments around the move, which is a far bigger change than "they moved tables".
  moveSession(sessionId, targetTableId) {
    const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
    const session = this.requireSession(sessionId);
    if (![STATES.ACTIVE, STATES.PAUSED].includes(session.state)) fail("SESSION_NOT_MOVABLE", "Only a running or paused table can be moved");
    const target = this.repository.findTable(targetTableId);
    if (!target) fail("TABLE_NOT_FOUND", "Target table not found");
    if (String(target.id) === String(session.tableId)) fail("SAME_TABLE", "The session is already on that table");
    if (this.repository.findOpenSessionByTable(target.id) || (target.status && target.status !== "free")) fail("TABLE_NOT_FREE", "Target table is not free");
    const origin = this.repository.findTable(session.tableId);
    // releaseTable wipes the origin's legacy item list, so it is carried over rather than lost.
    const carriedItems = Array.isArray(origin?.items) ? origin.items : [];
    if (origin) this.repository.releaseTable(origin.id, false);
    session.tableId = target.id;
    session.moves = [...(session.moves || []), { fromTableId: origin?.id ?? null, fromTableName: origin?.name ?? null, toTableId: target.id, toTableName: target.name, movedAt: this.now() }];
    this.repository.saveSession(session);
    target.items = carriedItems;
    return { session, origin, target };
  }
  // Kept as a compatibility alias for callers introduced before the payment workflow.
  closeSession(sessionId) { return this.awaitPaymentSession(sessionId); }
  completeSession(sessionId) { const session = this.requireSession(sessionId); session.state = nextState(session.state, "CLOSE"); return this.repository.saveSession(session); }
  cancelSession(sessionId) { const session = this.requireSession(sessionId); session.state = nextState(session.state, "CANCEL"); session.closedAt = this.now(); session.finalChargeSatang = 0; return this.repository.saveSession(session); }
  requireSession(sessionId) { const session = this.repository.findSession(sessionId); if (!session) throw new Error("Session not found"); return session; }
}
module.exports = { TableSessionService };
