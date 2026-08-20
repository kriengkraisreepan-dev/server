const test = require("node:test");
const assert = require("node:assert/strict");
const { ReservationService } = require("../services/reservation-service");

// A reservation that is waiting used to hear nothing until its own clock ran out. Deferring 20
// minutes meant a table freeing up two minutes later went unnoticed for the other eighteen — the
// customer waited at the counter and the table sat empty. Waiting reservations are now re-alerted
// while a table is actually free, on a slower cadence than the time-due alert so a table that opens
// and closes repeatedly does not machine-gun the counter.

const RESERVATION_CONFIG = { alertEnabled: true, alertRepeatMinutes: 1, tableFreeAlertMinutes: 5, deferMinutes: 20, checkInGraceMinutes: 60 };

function build({ status, tables, deferCount = 0, lastAlertAt = null, now = new Date("2026-08-20T10:00:00Z") }) {
  const item = { id: "RES-1", reservationNumber: "RSV-1", customerName: "สมชาย", phone: "081", status,
    reservedAt: "2026-08-20T09:00:00Z", effectiveReservationAt: "2026-08-20T09:20:00Z", deferCount, lastAlertAt,
    assignedTableId: null, timeline: [], version: 1 };
  const repository = { list: () => [item], findById: id => (id === item.id ? item : null), update: value => value };
  const service = new ReservationService(repository, { list: () => [] }, {
    settings: () => ({ reservation: RESERVATION_CONFIG }), tables: () => tables, clock: () => now
  });
  return { service, item };
}

const FREE_TABLE = [{ id: 2, name: "โต๊ะ 2", status: "free" }];
const BUSY_TABLES = [{ id: 2, name: "โต๊ะ 2", status: "playing" }];

test("a deferred reservation is alerted as soon as a table is free, without waiting out its 20 minutes", () => {
  const { service } = build({ status: "DEFERRED", tables: FREE_TABLE, deferCount: 1 });
  const alerts = service.pendingAlerts();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].reason, "TABLE_FREE");
  assert.equal(alerts[0].tableAvailable, true);
  assert.equal(alerts[0].availableTableName, "โต๊ะ 2");
});

test("a deferred reservation stays silent while every table is busy", () => {
  const { service } = build({ status: "DEFERRED", tables: BUSY_TABLES, deferCount: 1 });
  assert.deepEqual(service.pendingAlerts(), []);
});

test("WAITING_TABLE is alerted too — that customer was already approved to be seated", () => {
  const { service } = build({ status: "WAITING_TABLE", tables: FREE_TABLE });
  const alerts = service.pendingAlerts();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].reason, "TABLE_FREE");
});

test("the table-free alert repeats on its own slower cadence, not the one-minute due cadence", () => {
  const twoMinutesAgo = build({ status: "DEFERRED", tables: FREE_TABLE, lastAlertAt: "2026-08-20T09:58:00Z" });
  assert.deepEqual(twoMinutesAgo.service.pendingAlerts(), [], "two minutes is past alertRepeatMinutes but short of tableFreeAlertMinutes");
  const sixMinutesAgo = build({ status: "DEFERRED", tables: FREE_TABLE, lastAlertAt: "2026-08-20T09:54:00Z" });
  assert.equal(sixMinutesAgo.service.pendingAlerts().length, 1);
});

test("a time-due alert keeps the faster cadence and is labelled as due, not as a freed table", () => {
  const { service } = build({ status: "AWAITING_DECISION", tables: FREE_TABLE, lastAlertAt: "2026-08-20T09:58:00Z" });
  const alerts = service.pendingAlerts();
  assert.equal(alerts.length, 1, "one minute is enough for a due alert");
  assert.equal(alerts[0].reason, "DUE");
});

test("alerts stop entirely when the shop has turned them off", () => {
  const { service } = build({ status: "DEFERRED", tables: FREE_TABLE });
  service.settings = () => ({ reservation: { ...RESERVATION_CONFIG, alertEnabled: false } });
  assert.deepEqual(service.pendingAlerts(), []);
});

test("waitingWithTable lists only reservations that can be seated right now", () => {
  const free = build({ status: "DEFERRED", tables: FREE_TABLE });
  const listed = free.service.waitingWithTable();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].status, "DEFERRED");
  assert.equal(listed[0].availableTableName, "โต๊ะ 2");

  const busy = build({ status: "DEFERRED", tables: BUSY_TABLES });
  assert.deepEqual(busy.service.waitingWithTable(), [], "no table free, nothing to offer");
});

test("reading the banner does not consume the alert throttle", () => {
  const { service, item } = build({ status: "DEFERRED", tables: FREE_TABLE });
  service.waitingWithTable();
  assert.equal(item.lastAlertAt, null, "the banner is passive — only a real alert stamps lastAlertAt");
  assert.equal(service.pendingAlerts().length, 1);
});

test("open-now works from a waiting state, which is the whole point of the new alert", async () => {
  const { service, item } = build({ status: "DEFERRED", tables: FREE_TABLE });
  service.startSession = async () => ({ id: "sess-1" });
  const result = await service.openNow(item.id, { userId: "u1", role: "CASHIER" }, item.version);
  assert.equal(result.table.name, "โต๊ะ 2");
  assert.equal(item.status, "OPENED_WAITING_CHECK_IN");
});

test("deferring again works from a table-free prompt", () => {
  const { service, item } = build({ status: "DEFERRED", tables: FREE_TABLE, deferCount: 1 });
  service.defer(item.id, { userId: "u1", role: "CASHIER" }, item.version);
  assert.equal(item.deferCount, 2);
  assert.equal(item.status, "DEFERRED");
  assert.equal(item.effectiveReservationAt, "2026-08-20T09:40:00.000Z", "20 more minutes on top of the last effective time");
});

test("an already-opened reservation is still refused, with the message that says why", async () => {
  const { service, item } = build({ status: "OPENED_WAITING_CHECK_IN", tables: FREE_TABLE });
  await assert.rejects(() => service.openNow(item.id, { userId: "u1", role: "CASHIER" }, item.version),
    error => error.code === "RESERVATION_ALREADY_OPENED");
});
