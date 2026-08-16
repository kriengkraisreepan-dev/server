const test = require("node:test");
const assert = require("node:assert/strict");
const { JsonMemberRepository } = require("../repositories/json-member-repository");
const { MemberService } = require("../services/member-service");

function makeRig() {
  const store = { members: [], memberPointTransactions: [] };
  const repository = new JsonMemberRepository({ getStore: () => store, save: () => {} });
  const service = new MemberService(repository);
  return { store, service };
}

test("earn() stamps each batch's own expiresAt = earn date + pointExpiryMonths (crossing a month/year boundary)", () => {
  const { store, service } = makeRig();
  const member = service.create({ memberCode: "M1", displayName: "A" }, "owner");
  const bill = { memberId: member.id, saleSource: "TABLE", playDurationSeconds: 3600, id: "b1" };
  service.now = () => "2026-12-15T10:00:00.000Z";
  service.earn(bill, "cashier", { loyalty: { tablePointsPerHour: 5, tablePointIntervalMinutes: 60, pointExpiryMonths: 2 } });
  const earnTx = store.memberPointTransactions.find(tx => tx.type === "EARN");
  assert.equal(earnTx.expiresAt, "2027-02-15T10:00:00.000Z", "crosses both a month and a year boundary correctly");
});

test("pointExpiryMonths=0 (default) means earned points never get an expiresAt", () => {
  const { store, service } = makeRig();
  const member = service.create({ memberCode: "M2", displayName: "B" }, "owner");
  service.earn({ memberId: member.id, saleSource: "TABLE", playDurationSeconds: 3600, id: "b1" }, "cashier", { loyalty: { tablePointsPerHour: 5, tablePointIntervalMinutes: 60, pointExpiryMonths: 0 } });
  const earnTx = store.memberPointTransactions.find(tx => tx.type === "EARN");
  assert.equal(earnTx.expiresAt, null);
});

test("sweepExpiredPoints expires a due batch and leaves the balance/EXPIRE transaction consistent", () => {
  const { store, service } = makeRig();
  const member = service.create({ memberCode: "M3", displayName: "C" }, "owner");
  member.points = 50;
  store.memberPointTransactions.push({ id: "t1", memberId: member.id, type: "EARN", points: 50, expiresAt: "2026-01-01T00:00:00.000Z", createdAt: "2025-07-01T00:00:00.000Z", balanceBefore: 0, balanceAfter: 50 });
  const result = service.sweepExpiredPoints(member, new Date("2026-06-01T00:00:00.000Z"));
  assert.deepEqual(result, { memberId: member.id, expired: 50, balanceAfter: 0 });
  assert.equal(member.points, 0);
  const expireTx = store.memberPointTransactions.find(tx => tx.type === "EXPIRE");
  assert.equal(expireTx.points, -50);
  assert.equal(expireTx.balanceBefore, 50);
  assert.equal(expireTx.balanceAfter, 0);
});

test("sweepExpiredPoints leaves a batch untouched before its expiry date", () => {
  const { store, service } = makeRig();
  const member = service.create({ memberCode: "M4", displayName: "D" }, "owner");
  member.points = 50;
  store.memberPointTransactions.push({ id: "t1", memberId: member.id, type: "EARN", points: 50, expiresAt: "2026-12-01T00:00:00.000Z", createdAt: "2025-07-01T00:00:00.000Z", balanceBefore: 0, balanceAfter: 50 });
  const result = service.sweepExpiredPoints(member, new Date("2026-06-01T00:00:00.000Z"));
  assert.equal(result, null);
  assert.equal(member.points, 50);
});

test("sweepExpiredPoints never expires more than the member's current balance (some already redeemed)", () => {
  const { store, service } = makeRig();
  const member = service.create({ memberCode: "M5", displayName: "E" }, "owner");
  member.points = 20; // 50 earned, 30 already redeemed elsewhere
  store.memberPointTransactions.push(
    { id: "t1", memberId: member.id, type: "EARN", points: 50, expiresAt: "2026-01-01T00:00:00.000Z", createdAt: "2025-07-01T00:00:00.000Z", balanceBefore: 0, balanceAfter: 50 },
    { id: "t2", memberId: member.id, type: "REDEEM", points: -30, createdAt: "2025-08-01T00:00:00.000Z", balanceBefore: 50, balanceAfter: 20 }
  );
  const result = service.sweepExpiredPoints(member, new Date("2026-06-01T00:00:00.000Z"));
  assert.equal(result.expired, 20, "capped at the current balance, not the full 50 that was originally earned");
  assert.equal(member.points, 0);
});

test("sweepExpiredPoints is idempotent — a second sweep does not expire the same batch again", () => {
  const { store, service } = makeRig();
  const member = service.create({ memberCode: "M6", displayName: "F" }, "owner");
  member.points = 50;
  store.memberPointTransactions.push({ id: "t1", memberId: member.id, type: "EARN", points: 50, expiresAt: "2026-01-01T00:00:00.000Z", createdAt: "2025-07-01T00:00:00.000Z", balanceBefore: 0, balanceAfter: 50 });
  service.sweepExpiredPoints(member, new Date("2026-06-01T00:00:00.000Z"));
  assert.equal(member.points, 0);
  const second = service.sweepExpiredPoints(member, new Date("2026-07-01T00:00:00.000Z"));
  assert.equal(second, null, "already expired — nothing left to expire again");
  assert.equal(member.points, 0);
});

test("sweepAllExpiredPoints is a no-op across all members when pointExpiryMonths is 0", () => {
  const { store, service } = makeRig();
  const member = service.create({ memberCode: "M7", displayName: "G" }, "owner");
  member.points = 50;
  store.memberPointTransactions.push({ id: "t1", memberId: member.id, type: "EARN", points: 50, expiresAt: "2020-01-01T00:00:00.000Z", createdAt: "2019-07-01T00:00:00.000Z", balanceBefore: 0, balanceAfter: 50 });
  const results = service.sweepAllExpiredPoints({ loyalty: { pointExpiryMonths: 0 } }, new Date("2026-06-01T00:00:00.000Z"));
  assert.deepEqual(results, []);
  assert.equal(member.points, 50, "expiry is disabled, so even a very old batch is left alone");
});

console.log("Loyalty point expiry tests passed");
