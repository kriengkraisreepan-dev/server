const test = require("node:test");
const assert = require("node:assert/strict");
const { IntegrityCheckService } = require("../services/integrity-check-service");
const { RecoveryService } = require("../services/recovery-service");

test("integrity checker reports financial and reference errors without mutating data", () => {
  const store = {
    tables: [{ id: 1 }],
    members: [{ id: "M1", memberCode: "MEM-1" }],
    products: [{ id: "P1", stockQuantity: -1 }],
    bills: [
      { id: "B1", number: "N1", receiptNumber: "RC1", status: "paid", memberId: "missing", depositId: "D1", grossTotalSatang: 10000, depositAppliedSatang: 3000, remainingPaymentSatang: 6000 },
      { id: "B2", number: "N1", receiptNumber: "RC1" }
    ],
    tableSessions: [{ id: "S1", tableId: 1, state: "ACTIVE" }, { id: "S2", tableId: 1, state: "PAUSED" }]
  };
  const reservations = [{ id: "R1", assignedTableId: 99 }];
  const deposits = [{ id: "D1", receiptNumber: "DR1", status: "SETTLED", settledBillId: null }];
  const before = JSON.stringify({ store, reservations, deposits });
  const report = new IntegrityCheckService({ store: () => store, reservations: () => reservations, deposits: () => deposits }).run();
  assert.equal(report.status, "ERROR");
  for (const code of ["PAID_BILL_NOT_BALANCED","SETTLED_DEPOSIT_BILL_MISSING","RESERVATION_TABLE_MISSING","DUPLICATE_ACTIVE_TABLE_SESSION","DUPLICATE_BILL_NUMBER","NEGATIVE_PRODUCT_STOCK"]) assert.ok(report.issues.some(item => item.code === code), code);
  assert.equal(JSON.stringify({ store, reservations, deposits }), before, "checker must be read-only");
});

test("financial reconciliation passes for balanced bill and valid settled deposit", () => {
  const store = { tables: [{ id: 1 }], members: [], products: [], tableSessions: [], bills: [{ id: "B1", number: "N1", receiptNumber: "RC1", status: "paid", depositId: "D1", grossTotalSatang: 10000, depositAppliedSatang: 3000, remainingPaymentSatang: 7000 }] };
  const deposits = [{ id: "D1", receiptNumber: "DR1", status: "SETTLED", settledBillId: "B1" }];
  assert.equal(new IntegrityCheckService({ store: () => store, deposits: () => deposits }).run().status, "PASS");
});

test("recovery unlocks only unambiguous stale locks and flags uncertain locks", () => {
  const old = "2026-01-01T00:00:00.000Z";
  const rows = [
    { id: "D1", status: "LOCKED", lockedAt: old, version: 1, lockToken: "L1" },
    { id: "D2", status: "LOCKED", lockedAt: old, version: 1, lockToken: "L2", settlementAttemptId: "attempt" }
  ];
  const unlocked = [];
  const recovery = new RecoveryService({
    store: () => ({ bills: [] }),
    deposits: { list: () => rows },
    settlement: { unlock: id => unlocked.push(id), settle: () => assert.fail("must not settle") },
    clock: () => new Date("2026-01-01T01:00:00.000Z")
  }).run();
  assert.deepEqual(unlocked, ["D1"]);
  assert.equal(recovery.pending[0].depositId, "D2");
});
