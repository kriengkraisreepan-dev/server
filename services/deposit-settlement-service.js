const crypto = require("crypto");

class DepositSettlementService {
  constructor(repository, { reservationRepository, billingRepository, clock = () => new Date(), audit = () => {} } = {}) {
    this.repository = repository; this.reservationRepository = reservationRepository; this.billingRepository = billingRepository; this.clock = clock; this.audit = audit;
  }
  now() { return this.clock().toISOString(); }
  get(id) { const item = this.repository.findById(id); if (!item) throw new Error("Reservation deposit not found"); return item; }
  forReservation(reservationId) { return this.repository.findByReservationId(reservationId); }
  timeline(reservationId, event, actorId, details = {}) { const reservation = this.reservationRepository?.findById(reservationId); if (!reservation) return; reservation.timeline = [...(reservation.timeline || []), { event, occurredAt: this.now(), actorId, ...details }]; reservation.version = Number(reservation.version || 1) + 1; this.reservationRepository.update(reservation); }
  lock(id, actorId, expectedVersion = null, lockToken = null) {
    const current = this.get(id), token = lockToken || `LOCK-${crypto.randomUUID()}`;
    if (current.status === "LOCKED" && current.lockToken === token) return current;
    const locked = this.repository.lock(id, expectedVersion ?? Number(current.version || 1), { lockedAt: this.now(), lockedBy: actorId, lockToken: token });
    this.timeline(locked.reservationId, "DEPOSIT_LOCKED", actorId, { depositId: id });
    this.audit("DEPOSIT_LOCKED", actorId, { entityType: "RESERVATION_DEPOSIT", entityId: id, reservationId: locked.reservationId, lockToken: token });
    return locked;
  }
  unlock(id, actorId, expectedVersion = null, lockToken = null) {
    const current = this.get(id);
    if (current.status === "AVAILABLE") return current;
    const unlocked = this.repository.unlock(id, expectedVersion ?? Number(current.version || 1), lockToken);
    this.audit("DEPOSIT_UNLOCKED", actorId, { entityType: "RESERVATION_DEPOSIT", entityId: id, reservationId: unlocked.reservationId });
    return unlocked;
  }
  applyToBill(bill, deposit, actorId) {
    if (!bill || !deposit || deposit.status !== "LOCKED") throw new Error("A LOCKED deposit is required");
    if (bill.depositId && bill.depositId !== deposit.id) throw new Error("Bill already has a different deposit");
    const gross = Number(bill.totalSatang), applied = Math.min(gross, Number(deposit.amountSatang));
    Object.assign(bill, { reservationId: deposit.reservationId, depositId: deposit.id, depositAppliedSatang: applied, grossTotalSatang: gross, remainingPaymentSatang: gross - applied });
    this.billingRepository.saveBill(bill);
    this.timeline(deposit.reservationId, "DEPOSIT_APPLIED", actorId, { depositId: deposit.id, billId: bill.id, billNumber: bill.receiptNumber || bill.number });
    this.timeline(deposit.reservationId, "BILL_CREATED", actorId, { billId: bill.id, billNumber: bill.receiptNumber || bill.number });
    this.audit("DEPOSIT_APPLIED", actorId, { entityType: "BILL", entityId: bill.id, billId: bill.id, reservationId: deposit.reservationId, depositId: deposit.id, grossTotalSatang: gross, depositAppliedSatang: applied, remainingPaymentSatang: gross - applied });
    return bill;
  }
  settle(id, bill, actorId, expectedVersion = null, lockToken = null) {
    const current = this.get(id);
    if (current.status === "SETTLED" && current.settledBillId === bill.id) return current;
    if (bill.depositId !== id) throw new Error("Bill and deposit do not match");
    const now = this.now(), settled = this.repository.settle(id, expectedVersion ?? Number(current.version || 1), { lockToken: lockToken || current.lockToken, settledBillId: bill.id, settledBillNumber: bill.receiptNumber || bill.number, settledAmountSatang: bill.depositAppliedSatang, settledAt: now, settledBy: actorId });
    Object.assign(bill, { depositSettlementAt: now, depositSettlementBy: actorId });
    this.billingRepository.saveBill(bill);
    this.timeline(settled.reservationId, "DEPOSIT_SETTLED", actorId, { depositId: id, billId: bill.id, billNumber: bill.receiptNumber || bill.number });
    this.audit("DEPOSIT_SETTLED", actorId, { entityType: "RESERVATION_DEPOSIT", entityId: id, billId: bill.id, reservationId: settled.reservationId, amountSatang: bill.depositAppliedSatang });
    return settled;
  }
  prepareForSession(session, actorId, autoApply = true) {
    if (!autoApply || !session?.reservationId) return null;
    const deposit = this.forReservation(session.reservationId);
    if (!deposit || deposit.status !== "AVAILABLE") return null;
    return this.lock(deposit.id, actorId, deposit.version);
  }
  dashboard() {
    const day = this.now().slice(0, 10), deposits = this.repository.list();
    return {
      todayDepositSettledSatang: deposits.filter(x => x.status === "SETTLED" && String(x.settledAt).slice(0, 10) === day).reduce((s, x) => s + Number(x.settledAmountSatang || 0), 0),
      availableDepositSatang: deposits.filter(x => x.status === "AVAILABLE").reduce((s, x) => s + Number(x.amountSatang || 0), 0),
      outstandingDepositSatang: deposits.filter(x => ["AVAILABLE", "LOCKED"].includes(x.status)).reduce((s, x) => s + Number(x.amountSatang || 0), 0),
      // Deposits kept when a booking was cancelled or no-showed. This is money the shop has earned
      // and is counted as income from the moment it is forfeited; a REFUNDED deposit never appears
      // in any of these figures, which is the whole point of keeping the two statuses apart.
      todayForfeitedDepositSatang: deposits.filter(x => x.status === "FORFEITED" && String(x.revenueRecognizedAt || x.forfeitedAt || "").slice(0, 10) === day).reduce((s, x) => s + Number(x.amountSatang || 0), 0)
    };
  }
  report() {
    return this.repository.list().filter(x => x.status === "SETTLED").map(deposit => { const reservation = this.reservationRepository?.findById(deposit.reservationId), bill = this.billingRepository.findBill(deposit.settledBillId); return { reservationNumber: reservation?.reservationNumber || null, depositReceipt: deposit.receiptNumber, billNumber: deposit.settledBillNumber, grossTotalSatang: bill?.grossTotalSatang ?? null, depositAppliedSatang: deposit.settledAmountSatang, remainingPaymentSatang: bill?.remainingPaymentSatang ?? null, settlementDate: deposit.settledAt, cashier: deposit.settledBy }; });
  }
}

module.exports = { DepositSettlementService };
