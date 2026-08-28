const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { HistoryStore, MEMBER_INACTIVE_DAYS } = require("../infrastructure/history-store");
const { JsonMemberRepository } = require("../repositories/json-member-repository");
const { MemberService } = require("../services/member-service");

// Members are a directory, not history, so archiving the long-inactive ones is only safe if it is
// invisible from behind the counter: a returning customer must still be found, still have their
// points, and their code or phone must never be handed to somebody else while they are away.

function rig(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-members-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = { members: [], archivedMembers: [], memberPointTransactions: [], bills: [], payments: [], posOrders: [], tableSessions: [], stockMovements: [], auditLogs: [] };
  const history = new HistoryStore({ directory, getStore: () => store, save: () => {} });
  const repository = new JsonMemberRepository({ getStore: () => store, save: () => {}, history });
  return { store, history, repository, service: new MemberService(repository) };
}
const daysAgo = (now, days) => new Date(now.getTime() - days * 86400000).toISOString();
const NOW = new Date("2026-08-28T12:00:00.000Z");

function member(overrides = {}) {
  return { id: overrides.id || "m-1", memberCode: "M0001", code: "M0001", displayName: "สมชาย", name: "สมชาย", phone: "0812345678", email: "somchai@example.com", status: "ACTIVE", tier: "STANDARD", points: 120, visitCount: 40, lastVisitAt: daysAgo(NOW, MEMBER_INACTIVE_DAYS + 30), createdAt: daysAgo(NOW, MEMBER_INACTIVE_DAYS + 400), updatedAt: daysAgo(NOW, MEMBER_INACTIVE_DAYS + 30), ...overrides };
}

test("a member who has not been in for three years is archived; a recent one is not", t => {
  const { store, history } = rig(t);
  store.members.push(
    member({ id: "gone", memberCode: "M0001" }),
    member({ id: "regular", memberCode: "M0002", lastVisitAt: daysAgo(NOW, 10) }),
    member({ id: "just-inside", memberCode: "M0003", lastVisitAt: daysAgo(NOW, MEMBER_INACTIVE_DAYS - 5) })
  );
  history.sweep(NOW);
  assert.deepEqual(store.members.map(m => m.id).sort(), ["just-inside", "regular"]);
  assert.deepEqual(history.archive("members").read().map(m => m.id), ["gone"]);
});

test("what stays behind is enough to keep their code, phone and points accounted for", t => {
  const { store, history, repository } = rig(t);
  store.members.push(member({ id: "gone" }));
  history.sweep(NOW);
  assert.deepEqual(store.archivedMembers, [{ id: "gone", memberCode: "M0001", phone: "0812345678", email: "somchai@example.com", displayName: "สมชาย", points: 120 }]);
  assert.equal(repository.archivedPoints(), 120, "their points are still owed and still counted");
});

test("their member code, phone and email cannot be handed to somebody new", t => {
  const { store, history, service } = rig(t);
  store.members.push(member({ id: "gone" }));
  history.sweep(NOW);
  assert.throws(() => service.create({ memberCode: "M0001", displayName: "คนใหม่" }, "owner"), /Member code already exists/);
  assert.throws(() => service.create({ memberCode: "M9999", displayName: "คนใหม่", phone: "0812345678" }, "owner"), /Phone already exists/);
  assert.throws(() => service.create({ memberCode: "M9998", displayName: "คนใหม่", email: "somchai@example.com" }, "owner"), /Email already exists/);
});

test("searching for them brings the whole record back, points intact", t => {
  const { store, history, service } = rig(t);
  store.members.push(member({ id: "gone" }));
  history.sweep(NOW);
  assert.deepEqual(store.members, [], "gone from the working set");

  const found = service.list({ search: "0812345678" });
  assert.deepEqual(found.map(m => m.id), ["gone"]);
  assert.equal(found[0].points, 120);
  assert.equal(found[0].visitCount, 40, "the full record came back, not a stub");
  assert.deepEqual(store.archivedMembers, [], "and they are no longer listed as away");
  assert.deepEqual(store.members.map(m => m.id), ["gone"]);
});

test("an unfiltered list shows the working set, not everyone who ever joined", t => {
  const { store, history, service } = rig(t);
  store.members.push(member({ id: "gone" }), member({ id: "regular", memberCode: "M0002", phone: "0899999999", email: "b@example.com", lastVisitAt: daysAgo(NOW, 10) }));
  history.sweep(NOW);
  assert.deepEqual(service.list({}).map(m => m.id), ["regular"]);
});

test("writing anything about them puts them back — earning points, a profile edit, opening a table", t => {
  const { store, history, repository } = rig(t);
  const gone = member({ id: "gone" });
  store.members.push(gone);
  history.sweep(NOW);
  assert.deepEqual(store.members, []);

  const record = repository.findById("gone");
  assert.equal(record.points, 120, "found in the archive without being resurrected");
  assert.deepEqual(store.members, [], "a plain read leaves the working set alone");

  repository.saveMember({ ...record, points: 130, lastVisitAt: NOW.toISOString() });
  assert.deepEqual(store.members.map(m => m.id), ["gone"]);
  assert.deepEqual(store.archivedMembers, []);
  assert.equal(repository.archivedPoints(), 0, "their points moved back with them and are not double counted");
});

test("a member nobody has ever heard of is still not found", t => {
  const { store, history, repository } = rig(t);
  store.members.push(member({ id: "gone" }));
  history.sweep(NOW);
  assert.equal(repository.findById("never-existed"), null);
  assert.deepEqual(repository.restoreMatching("ไม่มีคนนี้"), []);
});

test("a member who has never visited at all is judged on when they joined", t => {
  const { store, history } = rig(t);
  store.members.push(
    member({ id: "signed-up-long-ago", lastVisitAt: null, updatedAt: null, createdAt: daysAgo(NOW, MEMBER_INACTIVE_DAYS + 10) }),
    member({ id: "signed-up-today", memberCode: "M0002", phone: "", email: "", lastVisitAt: null, updatedAt: null, createdAt: daysAgo(NOW, 1) })
  );
  history.sweep(NOW);
  assert.deepEqual(store.members.map(m => m.id), ["signed-up-today"]);
});
