const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { HistoryStore } = require("../infrastructure/history-store");
const { JsonMemberRepository } = require("../repositories/json-member-repository");
const { MemberService } = require("../services/member-service");

// Point expiry used to recompute two figures — how much has come due, how much has already been
// taken — by scanning a member's entire transaction ledger. That is why the ledger had to stay in
// the file rewritten on every click. The figures now live on the member record, so the ledger can
// be archived; these cover the switch, which is money-adjacent and has to behave identically.

function rig(t, { withHistory = true } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-points-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = { members: [], memberPointTransactions: [], bills: [], payments: [], posOrders: [], tableSessions: [], stockMovements: [], auditLogs: [] };
  const history = withHistory ? new HistoryStore({ directory, getStore: () => store, save: () => {} }) : null;
  const repository = new JsonMemberRepository({ getStore: () => store, save: () => {}, history });
  return { store, history, repository, service: new MemberService(repository) };
}
const earn = (memberId, points, expiresAt, createdAt) => ({ id: `t-${points}-${createdAt}`, memberId, type: "EARN", points, expiresAt, createdAt, balanceBefore: 0, balanceAfter: points });

test("the backfill splits a member's batches into due and pending, and totals what was already taken", t => {
  const { store, service } = rig(t);
  const member = service.create({ memberCode: "M1", displayName: "A" }, "owner");
  member.points = 70;
  store.memberPointTransactions.push(
    earn(member.id, 50, "2026-01-01T00:00:00.000Z", "2025-07-01T00:00:00.000Z"),   // due
    earn(member.id, 30, "2026-12-01T00:00:00.000Z", "2025-12-01T00:00:00.000Z"),   // not due yet
    { id: "x1", memberId: member.id, type: "EXPIRE", points: -10, createdAt: "2026-02-01T00:00:00.000Z" }
  );
  service.backfillPointExpirySummaries(new Date("2026-06-01T00:00:00.000Z"));
  assert.equal(member.pointsDueTotal, 50);
  assert.equal(member.pointsExpiredTotal, 10);
  assert.deepEqual(member.pointBatches, [{ expiresAt: "2026-12-01T00:00:00.000Z", points: 30 }]);
});

test("the backfill is idempotent — running it twice does not double any total", t => {
  const { store, service } = rig(t);
  const member = service.create({ memberCode: "M2", displayName: "B" }, "owner");
  member.points = 50;
  store.memberPointTransactions.push(earn(member.id, 50, "2026-01-01T00:00:00.000Z", "2025-07-01T00:00:00.000Z"));
  const at = new Date("2026-06-01T00:00:00.000Z");
  service.backfillPointExpirySummaries(at);
  service.backfillPointExpirySummaries(at);
  assert.equal(member.pointsDueTotal, 50);
  assert.equal(member.pointsExpiredTotal, 0);
});

test("a member with no transactions at all comes out of the backfill clean", t => {
  const { service } = rig(t);
  const member = service.create({ memberCode: "M3", displayName: "C" }, "owner");
  service.backfillPointExpirySummaries(new Date("2026-06-01T00:00:00.000Z"));
  assert.deepEqual(member.pointBatches, []);
  assert.equal(member.pointsDueTotal, 0);
  assert.equal(member.pointsExpiredTotal, 0);
});

test("earn() records its own batch, so expiry works without any ledger at all", t => {
  const { store, service } = rig(t);
  const member = service.create({ memberCode: "M4", displayName: "D" }, "owner");
  service.now = () => "2026-01-15T10:00:00.000Z";
  service.earn({ memberId: member.id, saleSource: "TABLE", playDurationSeconds: 3600, id: "b1" }, "cashier",
    { loyalty: { tablePointsPerHour: 5, tablePointIntervalMinutes: 60, pointExpiryMonths: 2 } });
  assert.deepEqual(member.pointBatches, [{ expiresAt: "2026-03-15T10:00:00.000Z", points: 5 }]);

  // Wipe the ledger entirely — the archive is somewhere else, and expiry must not care.
  store.memberPointTransactions.length = 0;
  const result = service.sweepExpiredPoints(member, new Date("2026-04-01T00:00:00.000Z"));
  assert.equal(result.expired, 5);
  assert.equal(member.points, 0);
});

test("points that never expire are never put in a batch", t => {
  const { service } = rig(t);
  const member = service.create({ memberCode: "M5", displayName: "E" }, "owner");
  service.earn({ memberId: member.id, saleSource: "TABLE", playDurationSeconds: 3600, id: "b1" }, "cashier",
    { loyalty: { tablePointsPerHour: 5, tablePointIntervalMinutes: 60, pointExpiryMonths: 0 } });
  assert.equal(member.pointBatches, undefined);
  assert.equal(service.sweepExpiredPoints(member, new Date("2030-01-01T00:00:00.000Z")), null);
});

test("a shortfall stays owed and is taken from points earned later, as it was before", t => {
  // 50 came due but the member had only 20 left, so 30 is still owed. The old code got this from
  // dueTotal - expiredTotal over the whole ledger; the running totals have to behave the same.
  const { store, service } = rig(t);
  const member = service.create({ memberCode: "M6", displayName: "F" }, "owner");
  member.points = 20;
  store.memberPointTransactions.push(earn(member.id, 50, "2026-01-01T00:00:00.000Z", "2025-07-01T00:00:00.000Z"));
  service.backfillPointExpirySummaries(new Date("2026-06-01T00:00:00.000Z"));
  assert.equal(service.sweepExpiredPoints(member, new Date("2026-06-01T00:00:00.000Z")).expired, 20);
  assert.equal(member.points, 0);

  member.points = 40; // earns more later
  assert.equal(service.sweepExpiredPoints(member, new Date("2026-07-01T00:00:00.000Z")).expired, 30, "the 30 still owed is collected");
  assert.equal(member.points, 10);
  assert.equal(service.sweepExpiredPoints(member, new Date("2026-08-01T00:00:00.000Z")), null, "and then it is settled");
});

test("a batch that comes due while the balance is empty is not counted twice later", t => {
  const { store, service } = rig(t);
  const member = service.create({ memberCode: "M7", displayName: "G" }, "owner");
  member.points = 0;
  store.memberPointTransactions.push(earn(member.id, 40, "2026-01-01T00:00:00.000Z", "2025-07-01T00:00:00.000Z"));
  service.backfillPointExpirySummaries(new Date("2025-12-01T00:00:00.000Z")); // backfilled BEFORE it came due
  assert.deepEqual(member.pointBatches.map(b => b.points), [40]);

  assert.equal(service.sweepExpiredPoints(member, new Date("2026-06-01T00:00:00.000Z")), null, "nothing to take from an empty balance");
  assert.deepEqual(member.pointBatches, [], "but the batch is recorded as due, not left to be counted again");
  assert.equal(member.pointsDueTotal, 40);
  assert.equal(service.sweepExpiredPoints(member, new Date("2026-07-01T00:00:00.000Z")), null);
  assert.equal(member.pointsDueTotal, 40, "still 40, not 80");
});

test("a member's point trail is read across the working set and the archive", t => {
  const now = new Date("2026-08-20T12:00:00.000Z");
  const { store, history, service } = rig(t);
  const member = service.create({ memberCode: "M8", displayName: "H" }, "owner");
  const other = service.create({ memberCode: "M9", displayName: "I" }, "owner");
  store.memberPointTransactions.push(
    { id: "old", memberId: member.id, type: "EARN", points: 10, createdAt: new Date(now.getTime() - 40 * 86400000).toISOString() },
    { id: "recent", memberId: member.id, type: "EARN", points: 20, createdAt: new Date(now.getTime() - 86400000).toISOString() },
    { id: "someone-else", memberId: other.id, type: "EARN", points: 5, createdAt: new Date(now.getTime() - 40 * 86400000).toISOString() }
  );
  history.sweep(now);
  assert.deepEqual(store.memberPointTransactions.map(tx => tx.id), ["recent"], "older entries left the working set");
  assert.deepEqual(service.history(member.id).map(tx => tx.id), ["recent", "old"], "newest first, across both");
  assert.deepEqual(service.history(other.id).map(tx => tx.id), ["someone-else"]);
});

test("the ledger is swept into month files like any other history", t => {
  const now = new Date("2026-08-20T12:00:00.000Z");
  const { store, history } = rig(t);
  store.memberPointTransactions.push(
    { id: "old", memberId: "m1", type: "EARN", points: 10, createdAt: new Date(now.getTime() - 40 * 86400000).toISOString() },
    { id: "today", memberId: "m1", type: "EARN", points: 10, createdAt: now.toISOString() }
  );
  history.sweep(now);
  assert.deepEqual(store.memberPointTransactions.map(tx => tx.id), ["today"]);
  assert.deepEqual(history.archive("memberPointTransactions").read().map(tx => tx.id), ["old"]);
});
