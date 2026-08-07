const crypto = require("crypto");
const { requireNonNegativeSatang, satangToBaht } = require("../domain/money");
const METHODS = new Set(["cash", "transfer", "qr"]); // qr remains readable/confirmable for older pending records.
class PaymentService {
  constructor(repository, billingService, clock = () => new Date()) { this.repository = repository; this.billingService = billingService; this.clock = clock; }
  now() { return this.clock().toISOString(); }
  requiredAmount(bill) { return Number.isInteger(bill.remainingPaymentSatang) ? bill.remainingPaymentSatang : bill.totalSatang; }
  validateAmount(bill, amountSatang) { const required = this.requiredAmount(bill); if (Number.isInteger(bill.remainingPaymentSatang) ? amountSatang !== required : amountSatang < required) throw new Error(Number.isInteger(bill.remainingPaymentSatang) ? "Payment amount must equal remaining payment" : "Payment amount is less than bill total"); }
  createPayment({ billId, method, amountSatang, actorId = "SYSTEM" }) {
    const bill = this.repository.findBill(billId); if (!bill) throw new Error("Bill not found");
    if (bill.status !== "awaiting_payment") throw new Error("Bill is not awaiting payment");
    if (!METHODS.has(method)) throw new Error("Unsupported payment method");
    if (this.repository.payments().some(payment => payment.billId === billId && ["pending", "paid"].includes(payment.status))) throw new Error("Bill already has a payment");
    requireNonNegativeSatang(amountSatang, "payment amount"); this.validateAmount(bill, amountSatang);
    bill.paymentMethod = method; this.repository.saveBill(bill);
    const payment = { id: crypto.randomUUID(), billId, method, amountSatang, amount: Number(satangToBaht(amountSatang)), status: "pending", reference: bill.receiptNumber || bill.number, createdAt: this.now() };
    this.repository.savePayment(payment); this.billingService.audit("PAYMENT_CREATED", { tableId: bill.tableId, billId, paymentId: payment.id, actorId, data: { method, amountSatang } }); return { bill, payment };
  }
  confirmPayment(paymentId, actorId = "SYSTEM") { const payment = this.repository.findPayment(paymentId); if (!payment || payment.status !== "pending") throw new Error("Payment is not pending"); const bill = this.repository.findBill(payment.billId); if (!bill) throw new Error("Bill not found"); if (!["awaiting_payment", "pending"].includes(bill.status)) throw new Error("Bill is not awaiting payment"); this.validateAmount(bill, payment.amountSatang); if(this.onBeforeConfirm)this.onBeforeConfirm(bill,actorId); payment.status = "paid"; payment.paidAt = this.now(); this.repository.savePayment(payment); this.billingService.markPaid(bill); this.billingService.audit("PAYMENT_CONFIRMED", { tableId: bill.tableId, billId: bill.id, paymentId: payment.id, actorId, data: { method: payment.method || "qr", amountSatang: payment.amountSatang } }); return { bill, payment }; }
  cancelPayment(paymentId) { const payment = this.repository.findPayment(paymentId); if (!payment || payment.status !== "pending") throw new Error("Only pending payments can be cancelled"); payment.status = "cancelled"; payment.cancelledAt = this.now(); this.repository.savePayment(payment); const bill = this.repository.findBill(payment.billId); this.billingService.audit("PAYMENT_CANCELLED", { tableId: bill?.tableId, billId: payment.billId, paymentId: payment.id }); return { bill, payment }; }
}
module.exports = { PaymentService };
