const assert = require("assert");
const { JsonBillingRepository } = require("../repositories/json-billing-repository");
const { BillingService } = require("../services/billing-service");
const { PaymentService } = require("../services/payment-service");
const { BillHistoryService } = require("../services/bill-history-service");

const store = { bills: [
  { id: "b1", number: "20260726-000001", receiptNumber: "20260726-000001", tableId: 1, tableName: "T01", createdAt: "2026-07-26T02:00:00.000Z", totalSatang: 10000, status: "paid" },
  { id: "b2", number: "20260725-000001", receiptNumber: "20260725-000001", tableId: 2, tableName: "T02", createdAt: "2026-07-25T02:00:00.000Z", totalSatang: 20000, status: "awaiting_payment" }
], payments: [], auditLogs: [] };
const repository = new JsonBillingRepository({ getStore: () => store, save: () => {} });
const billing = new BillingService(repository, () => new Date("2026-07-26T03:00:00.000Z"));
const payments = new PaymentService(repository, billing);
const history = new BillHistoryService(repository);
assert.strictEqual(history.search({ receipt: "000001" }).pagination.total, 2);
assert.strictEqual(history.search({ table: "t02", status: "AWAITING_PAYMENT" }).items[0].id, "b2");
assert.strictEqual(history.search({ from: "2026-07-26", to: "2026-07-26" }).items[0].id, "b1");
assert.throws(() => billing.voidBill(repository.findBill("b2"), ""), /required/);
const voided = billing.voidBill(repository.findBill("b2"), "operator mistake", "SYSTEM");
assert.strictEqual(voided.status, "void"); assert.strictEqual(voided.voidedBy, "SYSTEM"); assert.strictEqual(voided.originalReceiptNumber, "20260725-000001");
assert.throws(() => billing.voidBill(voided, "again"), /cannot be voided/);
assert.throws(() => payments.createPayment({ billId: "b2", method: "cash", amountSatang: 20000 }), /not awaiting/);
const details = history.details("b2"); assert.strictEqual(details.auditEvents[0].actorId, "SYSTEM");
const restored = JSON.parse(JSON.stringify(store)); assert.strictEqual(restored.bills[1].voidReason, "operator mistake"); assert.strictEqual(restored.auditLogs.length, 1);
console.log("Sprint 4 bill history and void governance tests passed");
