const crypto = require("crypto");

const DEPOSIT_STATUSES = Object.freeze(["PAID", "AVAILABLE", "LOCKED", "SETTLED", "VOIDED", "REFUNDED", "FORFEITED"]);
function requiredText(value, label) { const result = String(value || "").trim(); if (!result) throw new Error(`${label} is required`); return result; }

class ReservationDepositService {
  constructor(repository, { clock = () => new Date(), audit = () => {} } = {}) { this.repository = repository; this.clock = clock; this.audit = audit; }
  now() { return this.clock().toISOString(); }
  list(query = {}) {
    return this.repository.list().filter(item => (!query.status || item.status === query.status) && (!query.reservationId || item.reservationId === query.reservationId));
  }
  create(input, actorId) {
    const now = this.now();
    const deposit = { id: `DEP-${crypto.randomUUID().slice(0, 8)}`, reservationId: input.reservationId, receiptNumber: input.receiptNumber, amountSatang: input.amountSatang, paymentMethod: input.paymentMethod, paymentReference: String(input.paymentReference || "").trim(), status: "AVAILABLE", paidAt: now, createdAt: now, createdBy: actorId, lockedAt: null, lockedBy: null, lockToken: null, settledBillId: null, settledBillNumber: null, settledAmountSatang: null, settledAt: null, settledBy: null, voidedAt: null, voidedBy: null, voidReason: null, refundedAt: null, refundedBy: null, refundReason: null, version: 1 };
    this.repository.create(deposit);
    this.audit("DEPOSIT_RECEIVED", actorId, { entityType: "RESERVATION_DEPOSIT", entityId: deposit.id, reservationId: deposit.reservationId, amountSatang: deposit.amountSatang });
    return deposit;
  }
  transition(id, status, reason, user) {
    if (!["OWNER", "MANAGER"].includes(user.role)) { const error = new Error("Only OWNER or MANAGER may void or refund a deposit"); error.code = "FORBIDDEN"; throw error; }
    const deposit = this.repository.findById(id);
    if (!deposit) throw new Error("Reservation deposit not found");
    if (deposit.status !== "AVAILABLE") throw new Error("Only an AVAILABLE deposit may be voided or refunded");
    const explanation = requiredText(reason, "Reason");
    const now = this.now();
    deposit.status = status;
    if (status === "VOIDED") Object.assign(deposit, { voidedAt: now, voidedBy: user.userId, voidReason: explanation });
    else Object.assign(deposit, { refundedAt: now, refundedBy: user.userId, refundReason: explanation });
    this.repository.update(deposit);
    this.audit(status === "VOIDED" ? "DEPOSIT_VOIDED" : "DEPOSIT_REFUNDED", user.userId, { entityType: "RESERVATION_DEPOSIT", entityId: deposit.id, reservationId: deposit.reservationId, reason: explanation });
    return deposit;
  }
  void(id, reason, user) { return this.transition(id, "VOIDED", reason, user); }
  refund(id, reason, user) { return this.transition(id, "REFUNDED", reason, user); }
  forfeitForReservation(reservationId, actorId = "SYSTEM") {
    const deposit = this.repository.findByReservationId(reservationId);
    if (!deposit) return null;
    if (deposit.status === "FORFEITED") return deposit;
    if (deposit.status !== "AVAILABLE") { const error = new Error("Deposit is not available for forfeiture"); error.code = "DEPOSIT_NOT_AVAILABLE_FOR_FORFEIT"; throw error; }
    const now = this.now();
    Object.assign(deposit, { status: "FORFEITED", forfeitedAt: now, forfeitedBy: actorId, revenueRecognizedAt: now, revenueRecognizedBy: actorId });
    const updated = this.repository.update(deposit);
    this.audit("DEPOSIT_FORFEITED", actorId, { entityType: "RESERVATION_DEPOSIT", entityId: updated.id, reservationId, amountSatang: updated.amountSatang });
    this.audit("NO_SHOW_REVENUE_RECOGNIZED", actorId, { entityType: "RESERVATION_DEPOSIT", entityId: updated.id, reservationId, amountSatang: updated.amountSatang });
    return updated;
  }
}

module.exports = { ReservationDepositService, DEPOSIT_STATUSES };
