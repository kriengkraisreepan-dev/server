const test = require("node:test");
const assert = require("node:assert/strict");
const { DepositSettlementService } = require("../services/deposit-settlement-service");
const { PaymentService } = require("../services/payment-service");

class DepositRepo {
  constructor(items) { this.items = items; }
  list() { return this.items; }
  findById(id) { return this.items.find(x => x.id === id) || null; }
  findByReservationId(id) { return this.items.find(x => x.reservationId === id) || null; }
  update(item, version) { const current = this.findById(item.id); if (version !== null && version !== undefined && Number(version) !== Number(current.version)) { const e = new Error("Reservation deposit version conflict"); e.code = "VERSION_CONFLICT"; throw e; } Object.assign(current, item, { version: current.version + 1 }); return current; }
  lock(id, version, details) { const x = this.findById(id); if (x.status === "LOCKED" && x.lockToken === details.lockToken) return x; if (x.status !== "AVAILABLE") throw new Error("Only an AVAILABLE deposit may be locked"); return this.update({ ...x, status: "LOCKED", ...details }, version); }
  unlock(id, version, token) { const x = this.findById(id); if (x.status === "AVAILABLE") return x; if (x.status !== "LOCKED" || x.lockToken !== token) throw new Error("Deposit lock does not match"); return this.update({ ...x, status: "AVAILABLE", lockToken: null }, version); }
  settle(id, version, details) { const x = this.findById(id); if (x.status === "SETTLED" && x.settledBillId === details.settledBillId) return x; if (x.status !== "LOCKED" || x.lockToken !== details.lockToken) throw new Error("matching lock"); return this.update({ ...x, status: "SETTLED", ...details, lockToken: null }, version); }
}
class ReservationRepo {
  constructor() { this.item = { id: "res-1", reservationNumber: "RSV-001", version: 1, timeline: [] }; }
  findById(id) { return id === this.item.id ? this.item : null; }
  update(item) { this.item = item; return item; }
}
class BillingRepo {
  constructor(bill) { this.bill = bill; this.paymentsList = []; }
  findBill(id) { return id === this.bill.id ? this.bill : null; }
  saveBill(bill) { this.bill = bill; return bill; }
  payments() { return this.paymentsList; }
  findPayment(id) { return this.paymentsList.find(x => x.id === id); }
  savePayment(payment) { const i = this.paymentsList.findIndex(x => x.id === payment.id); if (i < 0) this.paymentsList.push(payment); else this.paymentsList[i] = payment; return payment; }
}
function fixture() {
  const deposit = { id: "dep-1", reservationId: "res-1", receiptNumber: "DR-001", amountSatang: 10000, status: "AVAILABLE", version: 1 };
  const bill = { id: "bill-1", number: "B-001", receiptNumber: "B-001", totalSatang: 30000, total: 300, status: "awaiting_payment" };
  const deposits = new DepositRepo([deposit]), reservations = new ReservationRepo(), billing = new BillingRepo(bill), audits = [];
  const settlement = new DepositSettlementService(deposits, { reservationRepository: reservations, billingRepository: billing, clock: () => new Date("2026-07-27T12:00:00Z"), audit: (...x) => audits.push(x) });
  return { deposit, bill, deposits, reservations, billing, audits, settlement };
}

test("locks, applies deposit, preserves gross total, and calculates exact remainder", () => {
  const f = fixture(), locked = f.settlement.lock("dep-1", "cashier", 1, "lock-1");
  f.settlement.applyToBill(f.bill, locked, "cashier");
  assert.equal(f.bill.grossTotalSatang, 30000);
  assert.equal(f.bill.totalSatang, 30000);
  assert.equal(f.bill.depositAppliedSatang, 10000);
  assert.equal(f.bill.remainingPaymentSatang, 20000);
  assert.deepEqual(f.audits.map(x => x[0]), ["DEPOSIT_LOCKED", "DEPOSIT_APPLIED"]);
});

test("payment must equal remainder and successful confirmation settles exactly once", () => {
  const f = fixture(), locked = f.settlement.lock("dep-1", "cashier", 1, "lock-1");
  f.settlement.applyToBill(f.bill, locked, "cashier");
  const billingService = { audit() {}, markPaid(bill) { bill.status = "paid"; return bill; } };
  const payments = new PaymentService(f.billing, billingService, () => new Date("2026-07-27T12:05:00Z"));
  payments.onBeforeConfirm = (bill, actor) => { const d = f.deposits.findById(bill.depositId); f.settlement.settle(d.id, bill, actor, d.version, d.lockToken); };
  assert.throws(() => payments.createPayment({ billId: f.bill.id, method: "cash", amountSatang: 30000 }), /equal remaining/);
  const payment = payments.createPayment({ billId: f.bill.id, method: "cash", amountSatang: 20000 }).payment;
  payments.confirmPayment(payment.id, "cashier");
  assert.equal(f.deposit.status, "SETTLED");
  assert.equal(f.deposit.settledBillId, f.bill.id);
  assert.equal(f.bill.depositSettlementBy, "cashier");
  assert.equal(f.settlement.settle(f.deposit.id, f.bill, "cashier").version, f.deposit.version);
});

test("unlock restores AVAILABLE after checkout error and validates lock token/version", () => {
  const f = fixture(), locked = f.settlement.lock("dep-1", "cashier", 1, "lock-1");
  assert.throws(() => f.settlement.unlock("dep-1", "cashier", locked.version, "wrong"), /does not match/);
  const unlocked = f.settlement.unlock("dep-1", "cashier", locked.version, "lock-1");
  assert.equal(unlocked.status, "AVAILABLE");
  assert.throws(() => f.settlement.lock("dep-1", "cashier", 1, "lock-2"), /version conflict/);
});

test("settled credit cannot be reused or refunded and remains settled when bill is voided", () => {
  const f = fixture(), locked = f.settlement.lock("dep-1", "cashier", 1, "lock-1");
  f.settlement.applyToBill(f.bill, locked, "cashier");
  f.settlement.settle("dep-1", f.bill, "cashier", locked.version, locked.lockToken);
  assert.throws(() => f.settlement.lock("dep-1", "cashier"), /AVAILABLE/);
  f.bill.status = "void";
  assert.equal(f.deposit.status, "SETTLED");
});

test("dashboard and settlement report use settled ledger without reducing bill revenue", () => {
  const f = fixture(), locked = f.settlement.lock("dep-1", "cashier", 1, "lock-1");
  f.settlement.applyToBill(f.bill, locked, "cashier");
  f.settlement.settle("dep-1", f.bill, "cashier", locked.version, locked.lockToken);
  assert.equal(f.settlement.dashboard().todayDepositSettledSatang, 10000);
  const row = f.settlement.report()[0];
  assert.equal(row.grossTotalSatang, 30000);
  assert.equal(row.remainingPaymentSatang, 20000);
  assert.equal(f.bill.total, 300);
});

test("legacy bills preserve prior overpayment-compatible validation", () => {
  const f = fixture(), service = new PaymentService(f.billing, { audit() {}, markPaid() {} });
  assert.doesNotThrow(() => service.createPayment({ billId: f.bill.id, method: "cash", amountSatang: 31000 }));
});
