const crypto = require("crypto");
const { requireNonNegativeSatang, satangToBaht } = require("../domain/money");
const METHODS = new Set(["cash", "transfer", "qr"]); // qr remains readable/confirmable for older pending records.
class PaymentService {
  constructor(repository, billingService, clock = () => new Date()) { this.repository = repository; this.billingService = billingService; this.clock = clock; }
  now() { return this.clock().toISOString(); }
  requiredAmount(bill) { return Number.isInteger(bill.remainingPaymentSatang) ? bill.remainingPaymentSatang : bill.totalSatang; }
  paymentsForBill(billId) { return this.repository.payments().filter(payment => payment.billId === billId); }
  // Sum of payments that already count toward the bill (pending OR paid). A pending split leg
  // reserves its share immediately, so a second leg can't be created for more than what's left.
  reservedAmount(billId) { return this.paymentsForBill(billId).filter(payment => ["pending", "paid"].includes(payment.status)).reduce((sum, payment) => sum + payment.amountSatang, 0); }
  // allowPartial=true is exclusively for a validated split-payment leg (see createSplitPayments in
  // index.js, which checks the whole set sums to the amount due before creating any of them) — a
  // plain single-call createPayment (allowPartial default false) keeps its original, stricter rule:
  // must cover the bill exactly once a deposit fixed remainingPaymentSatang, or at least the total
  // otherwise (legacy bills tolerate overpayment, matching prior behavior).
  createPayment({ billId, method, amountSatang, actorId = "SYSTEM", allowPartial = false }) {
    const bill = this.repository.findBill(billId); if (!bill) throw new Error("Bill not found");
    if (bill.status !== "awaiting_payment") throw new Error("Bill is not awaiting payment");
    if (!METHODS.has(method)) throw new Error("Unsupported payment method");
    requireNonNegativeSatang(amountSatang, "payment amount");
    const required = this.requiredAmount(bill), reserved = this.reservedAmount(billId), remaining = required - reserved;
    if (remaining <= 0) throw new Error("Bill already has a payment");
    if (allowPartial) {
      if (amountSatang <= 0) throw new Error("Split payment amount must be greater than zero");
      if (amountSatang > remaining) throw new Error("Split payment amount exceeds the remaining balance");
    } else if (Number.isInteger(bill.remainingPaymentSatang) ? amountSatang !== remaining : amountSatang < remaining) {
      throw new Error(Number.isInteger(bill.remainingPaymentSatang) ? "Payment amount must equal remaining payment" : "Payment amount is less than bill total");
    }
    bill.paymentMethod = reserved ? "mixed" : method; this.repository.saveBill(bill);
    const payment = { id: crypto.randomUUID(), billId, method, amountSatang, amount: Number(satangToBaht(amountSatang)), status: "pending", reference: bill.receiptNumber || bill.number, createdAt: this.now() };
    this.repository.savePayment(payment); this.billingService.audit("PAYMENT_CREATED", { tableId: bill.tableId, billId, paymentId: payment.id, actorId, data: { method, amountSatang } }); return { bill, payment };
  }
  // Confirming one leg of a split payment does NOT mark the bill paid until every leg is confirmed
  // (paidTotal reaches the required amount) — callers (index.js) check bill.status themselves to
  // decide whether to run "bill fully settled" side effects (relay off, session close, points).
  confirmPayment(paymentId, actorId = "SYSTEM") {
    const payment = this.repository.findPayment(paymentId); if (!payment || payment.status !== "pending") throw new Error("Payment is not pending");
    const bill = this.repository.findBill(payment.billId); if (!bill) throw new Error("Bill not found");
    if (!["awaiting_payment", "pending"].includes(bill.status)) throw new Error("Bill is not awaiting payment");
    payment.status = "paid"; payment.paidAt = this.now(); this.repository.savePayment(payment);
    this.billingService.audit("PAYMENT_CONFIRMED", { tableId: bill.tableId, billId: bill.id, paymentId: payment.id, actorId, data: { method: payment.method || "qr", amountSatang: payment.amountSatang } });
    const paidTotal = this.paymentsForBill(bill.id).filter(p => p.status === "paid").reduce((sum, p) => sum + p.amountSatang, 0);
    if (paidTotal >= this.requiredAmount(bill)) { if (this.onBeforeConfirm) this.onBeforeConfirm(bill, actorId); this.billingService.markPaid(bill); }
    return { bill, payment };
  }
  cancelPayment(paymentId) { const payment = this.repository.findPayment(paymentId); if (!payment || payment.status !== "pending") throw new Error("Only pending payments can be cancelled"); payment.status = "cancelled"; payment.cancelledAt = this.now(); this.repository.savePayment(payment); const bill = this.repository.findBill(payment.billId); this.billingService.audit("PAYMENT_CANCELLED", { tableId: bill?.tableId, billId: payment.billId, paymentId: payment.id }); return { bill, payment }; }
  // Creates every leg of a split payment atomically-in-effect: validates the whole set sums exactly
  // to what's due (and each leg is a supported method/positive amount) BEFORE creating any of them,
  // so a bad split never leaves a partial mess of payment records behind.
  createSplitPayments(bill, entries, actorId = "SYSTEM") {
    const required = this.requiredAmount(bill), reserved = this.reservedAmount(bill.id), remaining = required - reserved;
    const normalized = (entries || []).map(entry => ({ method: entry.method, amountSatang: Number.isFinite(entry.amountSatang) ? Math.round(entry.amountSatang) : Math.round(Number(entry.amount || 0) * 100) }));
    if (normalized.length < 2) throw Object.assign(new Error("A split payment needs at least two entries"), { code: "SPLIT_PAYMENT_TOO_FEW" });
    if (normalized.some(entry => !(entry.amountSatang > 0))) throw Object.assign(new Error("Each split payment amount must be greater than zero"), { code: "INVALID_SPLIT_AMOUNT" });
    const sum = normalized.reduce((total, entry) => total + entry.amountSatang, 0);
    if (sum !== remaining) throw Object.assign(new Error("ยอดรวมการแบ่งชำระต้องเท่ากับยอดที่ต้องชำระพอดี"), { code: "SPLIT_PAYMENT_MISMATCH" });
    return normalized.map(entry => this.createPayment({ billId: bill.id, method: entry.method, amountSatang: entry.amountSatang, actorId, allowPartial: true }).payment);
  }
}
module.exports = { PaymentService };
