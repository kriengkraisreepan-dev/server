const test = require("node:test");
const assert = require("node:assert/strict");
const { JsonBillingRepository } = require("../repositories/json-billing-repository");
const { BillingService } = require("../services/billing-service");
const { PaymentService } = require("../services/payment-service");

function makeRig() {
  const store = { bills: [], payments: [], auditLogs: [] };
  const repository = new JsonBillingRepository({ getStore: () => store, save: () => {} });
  const billing = new BillingService(repository, () => new Date("2026-08-16T12:00:00.000Z"));
  const payments = new PaymentService(repository, billing, () => new Date("2026-08-16T12:01:00.000Z"));
  const bill = billing.createBillDraft({ table: { id: 1, name: "Table 1", items: [] }, session: { id: "session-1", openedAt: "2026-08-16T11:00:00.000Z", closedAt: "2026-08-16T12:00:00.000Z", billableSeconds: 3600, finalChargeSatang: 10000 }, extraItems: [{ id: "i-1", name: "Water", quantity: 2, price: 20, total: 40 }], tableSessionId: "session-1", posOrderIds: ["pos-1"], breakdown: { tableCharge: 100, products: 40, total: 140 } });
  return { store, billing, payments, bill };
}

test("splits a bill into two legs that sum exactly to the total, marks the bill mixed", () => {
  const { store, payments, bill } = makeRig();
  const legs = payments.createSplitPayments(bill, [{ method: "cash", amount: 40 }, { method: "transfer", amount: 100 }], "cashier");
  assert.equal(legs.length, 2);
  assert.equal(bill.paymentMethod, "mixed");
  assert.deepEqual(store.payments.map(p => p.status), ["pending", "pending"]);
  assert.equal(legs.reduce((sum, p) => sum + p.amountSatang, 0), bill.totalSatang);
});

test("rejects a split whose legs do not add up to the bill total", () => {
  const { payments, bill } = makeRig();
  assert.throws(() => payments.createSplitPayments(bill, [{ method: "cash", amount: 40 }, { method: "transfer", amount: 50 }], "cashier"), err => err.code === "SPLIT_PAYMENT_MISMATCH");
});

test("rejects a split with fewer than two legs", () => {
  const { payments, bill } = makeRig();
  assert.throws(() => payments.createSplitPayments(bill, [{ method: "cash", amount: 140 }], "cashier"), err => err.code === "SPLIT_PAYMENT_TOO_FEW");
});

test("rejects a split leg that is zero or negative", () => {
  const { payments, bill } = makeRig();
  assert.throws(() => payments.createSplitPayments(bill, [{ method: "cash", amount: 140 }, { method: "transfer", amount: 0 }], "cashier"), err => err.code === "INVALID_SPLIT_AMOUNT");
});

test("bill only becomes paid once every leg is confirmed, not on the first one", () => {
  const { payments, bill } = makeRig();
  const [cash, transfer] = payments.createSplitPayments(bill, [{ method: "cash", amount: 40 }, { method: "transfer", amount: 100 }], "cashier");
  const afterFirst = payments.confirmPayment(cash.id, "cashier");
  assert.equal(afterFirst.bill.status, "awaiting_payment", "still waiting on the transfer leg");
  const afterSecond = payments.confirmPayment(transfer.id, "cashier");
  assert.equal(afterSecond.bill.status, "paid", "both legs confirmed — now fully settled");
});

test("a normal single-payment call is completely unaffected by split support (regression guard)", () => {
  const { payments, bill } = makeRig();
  const { payment } = payments.createPayment({ billId: bill.id, method: "cash", amountSatang: bill.totalSatang, actorId: "cashier" });
  const confirmed = payments.confirmPayment(payment.id, "cashier");
  assert.equal(confirmed.bill.status, "paid");
  assert.equal(bill.paymentMethod, "cash", "not \"mixed\" — this was never a split");
});

test("createPayment still rejects an under-amount single call exactly as before (regression guard)", () => {
  const { payments, bill } = makeRig();
  assert.throws(() => payments.createPayment({ billId: bill.id, method: "cash", amountSatang: bill.totalSatang - 100, actorId: "cashier" }), /less than/);
});

console.log("Split payment tests passed");
