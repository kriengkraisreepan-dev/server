const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { MonthlyArchive, monthsBetween } = require("../infrastructure/monthly-archive");
const { HistoryStore, HOT_DAYS } = require("../infrastructure/history-store");
const { JsonBillingRepository } = require("../repositories/json-billing-repository");

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-history-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
const daysAgo = (now, days) => new Date(now.getTime() - days * 86400000).toISOString();

function makeHistory(t, store = {}) {
  const directory = temporaryDirectory(t);
  const state = { bills: [], payments: [], posOrders: [], tableSessions: [], auditLogs: [], ...store };
  let saveCount = 0;
  const history = new HistoryStore({ directory, getStore: () => state, save: () => { saveCount += 1; } });
  return { history, state, directory, saveCount: () => saveCount };
}

test("monthsBetween covers the inclusive span and rolls the year", () => {
  assert.deepEqual(monthsBetween("2026-11", "2027-02"), ["2026-11", "2026-12", "2027-01", "2027-02"]);
  assert.deepEqual(monthsBetween("2026-03", "2026-03"), ["2026-03"]);
  assert.deepEqual(monthsBetween("2026-05", "2026-04"), []);
});

test("an archive files records by their own timestamp, not by when they were written", t => {
  const directory = temporaryDirectory(t);
  const archive = new MonthlyArchive({ directory, name: "bills" });
  archive.appendMany([
    { id: "a", createdAt: "2026-01-14T10:00:00.000Z" },
    { id: "b", createdAt: "2026-02-02T10:00:00.000Z" },
    { id: "c", createdAt: "2026-02-27T10:00:00.000Z" }
  ]);
  assert.deepEqual(archive.months(), ["2026-01", "2026-02"]);
  assert.deepEqual(archive.readMonth("2026-01").map(record => record.id), ["a"]);
  assert.deepEqual(archive.readMonth("2026-02").map(record => record.id), ["b", "c"]);
  assert.deepEqual(archive.read({ fromMonth: "2026-02", toMonth: "2026-02" }).map(record => record.id), ["b", "c"]);
});

test("re-appending a record replaces it on read without rewriting the month", t => {
  const directory = temporaryDirectory(t);
  const archive = new MonthlyArchive({ directory, name: "bills" });
  archive.append({ id: "a", createdAt: "2026-01-14T10:00:00.000Z", status: "paid" });
  const afterFirst = fs.statSync(archive.file("2026-01")).size;
  archive.append({ id: "a", createdAt: "2026-01-14T10:00:00.000Z", status: "void" });
  const records = archive.readMonth("2026-01");
  assert.equal(records.length, 1);
  assert.equal(records[0].status, "void", "the newest version of an id wins");
  assert.ok(fs.statSync(archive.file("2026-01")).size > afterFirst, "the update was appended, not rewritten in place");
});

test("a torn final line does not make the rest of a month unreadable", t => {
  const directory = temporaryDirectory(t);
  const archive = new MonthlyArchive({ directory, name: "audit" });
  archive.appendMany([
    { id: "a", createdAt: "2026-01-14T10:00:00.000Z" },
    { id: "b", createdAt: "2026-01-15T10:00:00.000Z" }
  ]);
  fs.appendFileSync(archive.file("2026-01"), '{"id":"c","createdA');
  assert.deepEqual(archive.readMonth("2026-01").map(record => record.id), ["a", "b"]);
});

test("dropping expired months deletes whole files rather than filtering entries", t => {
  const directory = temporaryDirectory(t);
  const archive = new MonthlyArchive({ directory, name: "audit" });
  archive.appendMany([
    { id: "old", createdAt: "2025-11-02T10:00:00.000Z" },
    { id: "keep", createdAt: "2026-03-02T10:00:00.000Z" }
  ]);
  assert.deepEqual(archive.dropMonthsBefore("2026-01"), ["2025-11"]);
  assert.deepEqual(archive.months(), ["2026-03"]);
  assert.equal(fs.existsSync(archive.file("2025-11")), false);
});

test("the sweep moves finished records out of the store and leaves the working set alone", t => {
  const now = new Date("2026-08-20T12:00:00.000Z");
  const { history, state } = makeHistory(t, {
    bills: [
      { id: "old-paid", status: "paid", createdAt: daysAgo(now, 30) },
      { id: "old-void", status: "void", createdAt: daysAgo(now, 30) },
      { id: "old-unpaid", status: "awaiting_payment", createdAt: daysAgo(now, 30) },
      { id: "today-paid", status: "paid", createdAt: daysAgo(now, 0) }
    ],
    tableSessions: [
      { id: "open", state: "ACTIVE", openedAt: daysAgo(now, 30) },
      { id: "done", state: "COMPLETED", openedAt: daysAgo(now, 30) }
    ],
    posOrders: [
      { id: "draft", status: "DRAFT", createdAt: daysAgo(now, 30) },
      { id: "unbilled", status: "CONFIRMED", billingStatus: "UNBILLED", createdAt: daysAgo(now, 30) },
      { id: "billed", status: "CONFIRMED", billingStatus: "BILLED", createdAt: daysAgo(now, 30) }
    ]
  });

  history.sweep(now);

  assert.deepEqual(state.bills.map(bill => bill.id).sort(), ["old-unpaid", "today-paid"], "unfinished and recent bills stay hot");
  assert.deepEqual(state.tableSessions.map(session => session.id), ["open"], "an open session is never archived");
  assert.deepEqual(state.posOrders.map(order => order.id).sort(), ["draft", "unbilled"], "orders that can still be billed stay hot");
  assert.deepEqual(history.archive("bills").read().map(bill => bill.id).sort(), ["old-paid", "old-void"]);
  assert.deepEqual(history.archive("posOrders").read().map(order => order.id), ["billed"]);
});

test("a bill stays hot for the whole hot window and is archived once past it", t => {
  const now = new Date("2026-08-20T12:00:00.000Z");
  const { history, state } = makeHistory(t, {
    bills: [
      { id: "inside", status: "paid", createdAt: daysAgo(now, HOT_DAYS - 1) },
      { id: "outside", status: "paid", createdAt: daysAgo(now, HOT_DAYS + 1) }
    ]
  });
  history.sweep(now);
  assert.deepEqual(state.bills.map(bill => bill.id), ["inside"]);
  assert.deepEqual(history.archive("bills").read().map(bill => bill.id), ["outside"]);
});

test("an archived record is found by id and updated by appending to its own month", t => {
  const now = new Date("2026-08-20T12:00:00.000Z");
  const { history, state, saveCount } = makeHistory(t, {
    bills: [{ id: "b1", status: "paid", createdAt: "2026-02-11T10:00:00.000Z", total: 175 }]
  });
  history.sweep(now);
  assert.equal(state.bills.length, 0);

  const repository = new JsonBillingRepository({ getStore: () => state, save: () => {}, history });
  const found = repository.findBill("b1");
  assert.equal(found.total, 175);

  repository.saveBill({ ...found, status: "void", voidReason: "test" });
  assert.equal(state.bills.length, 0, "voiding an old bill must not pull it back into the hot store");
  assert.equal(repository.findBill("b1").status, "void");
  assert.equal(saveCount(), 0, "an archived update is one append, not a rewrite of store.json");
});

test("the audit trail is appended straight to its month file and never held in the store", t => {
  const { history, state } = makeHistory(t);
  const repository = new JsonBillingRepository({ getStore: () => state, save: () => {}, history });
  repository.appendAudit({ id: "e1", event: "TABLE_OPENED", occurredAt: "2026-08-19T10:00:00.000Z", billId: null });
  repository.appendAudit({ id: "e2", event: "TABLE_CLOSED", occurredAt: "2026-08-19T11:00:00.000Z", billId: "b1" });
  assert.deepEqual(state.auditLogs, [], "nothing accumulates in the file rewritten on every click");
  assert.deepEqual(history.archive("auditLogs").read().map(entry => entry.id), ["e1", "e2"]);
  assert.deepEqual(repository.auditEventTypes(), ["TABLE_CLOSED", "TABLE_OPENED"], "event names for the filter come from a small registry");
  assert.deepEqual(repository.auditForBill("b1", "2026-08-19T10:00:00.000Z").map(entry => entry.id), ["e2"]);
});

test("audit retention drops whole expired months and keeps everything inside the window", t => {
  const now = new Date("2026-08-20T12:00:00.000Z");
  const { history, state } = makeHistory(t);
  const repository = new JsonBillingRepository({ getStore: () => state, save: () => {}, history });
  repository.appendAudit({ id: "ancient", event: "LOGIN_SUCCESS", occurredAt: "2025-09-02T10:00:00.000Z" });
  repository.appendAudit({ id: "recent", event: "LOGIN_SUCCESS", occurredAt: "2026-08-02T10:00:00.000Z" });
  repository.pruneAuditLogs(now);
  assert.deepEqual(history.archive("auditLogs").read().map(entry => entry.id), ["recent"]);
});

test("the one-time migration empties a legacy store and does not run twice", t => {
  const now = new Date("2026-08-20T12:00:00.000Z");
  const { history, state } = makeHistory(t, {
    bills: [{ id: "b1", status: "paid", createdAt: daysAgo(now, 40) }],
    auditLogs: [{ id: "e1", event: "LOGIN_SUCCESS", occurredAt: daysAgo(now, 40) }]
  });
  const first = history.migrateLegacyStore(now);
  assert.equal(first.total, 2);
  assert.equal(state.historySchemaVersion, 1);
  assert.deepEqual(state.bills, []);
  assert.deepEqual(state.auditLogs, []);
  assert.equal(history.migrateLegacyStore(now), null, "a migrated store is left alone on later boots");
});

test("a range query only opens the month files it covers", t => {
  const directory = temporaryDirectory(t);
  const state = { bills: [], payments: [], posOrders: [], tableSessions: [], auditLogs: [] };
  const history = new HistoryStore({ directory, getStore: () => state, save: () => {} });
  history.archive("bills").appendMany([
    { id: "jan", status: "paid", createdAt: "2026-01-10T10:00:00.000Z" },
    { id: "feb", status: "paid", createdAt: "2026-02-10T10:00:00.000Z" },
    { id: "mar", status: "paid", createdAt: "2026-03-10T10:00:00.000Z" }
  ]);
  const opened = [];
  const archive = history.archive("bills");
  const originalReadMonth = archive.readMonth.bind(archive);
  archive.readMonth = month => { opened.push(month); return originalReadMonth(month); };

  assert.deepEqual(history.inRange("bills", "2026-02-01", "2026-02-28").map(bill => bill.id), ["feb"]);
  assert.deepEqual(opened, ["2026-02"], "January and March were never read");
});

test("mirroring copies only the month files that changed", t => {
  const now = new Date("2026-08-20T12:00:00.000Z");
  const { history } = makeHistory(t, { bills: [{ id: "b1", status: "paid", createdAt: daysAgo(now, 40) }] });
  history.sweep(now);
  const target = temporaryDirectory(t);
  assert.equal(history.mirrorTo(target), 1);
  assert.equal(history.mirrorTo(target), 0, "an unchanged month is not copied again");
  history.archive("bills").append({ id: "b2", status: "paid", createdAt: daysAgo(now, 40) });
  assert.equal(history.mirrorTo(target), 1);
});

test("mirroring carries audit retention across, so pruned months do not survive in the copy", t => {
  const { history } = makeHistory(t);
  history.archive("auditLogs").appendMany([
    { id: "ancient", occurredAt: "2025-09-02T10:00:00.000Z" },
    { id: "recent", occurredAt: "2026-08-02T10:00:00.000Z" }
  ]);
  const target = temporaryDirectory(t);
  history.mirrorTo(target);
  assert.ok(fs.existsSync(path.join(target, "audit-2025-09.jsonl")));
  history.dropAuditMonthsBefore("2026-01");
  history.mirrorTo(target);
  assert.equal(fs.existsSync(path.join(target, "audit-2025-09.jsonl")), false, "the expired month is gone from the mirror too");
  assert.ok(fs.existsSync(path.join(target, "audit-2026-08.jsonl")), "months inside the window are untouched");
});
