const test = require("node:test");
const assert = require("node:assert/strict");
const { ReservationService } = require("../services/reservation-service");
const { ReservationDepositService } = require("../services/reservation-deposit-service");
const { hasPermission, PERMISSIONS } = require("../domain/permissions");

class Repo {
  constructor() { this.items = []; }
  list() { return this.items.map(x => ({ ...x })); }
  findById(id) { return this.items.find(x => x.id === id) || null; }
  findByReservationId(id) { return this.items.find(x => x.reservationId === id) || null; }
  create(item) { this.items.push(item); return item; }
  update(item) { this.items[this.items.findIndex(x => x.id === item.id)] = item; return item; }
}
const config = { reservation: { defaultDepositAmount: 100, minimumDepositAmount: 100, depositRequired: true, autoAssignTable: true, autoLightOn: true, allowLightBeforeCheckIn: true, checkInGraceMinutes: 60, alertEnabled: true, alertRepeatMinutes: 1, deferMinutes: 20, autoForfeitNoShowDeposit: true } };
function fixture(now = "2026-07-27T10:00:00.000Z", tables = [{ id: 1, name: "T1", status: "free", relay: 1 }]) {
  let current = new Date(now);
  const reservationRepo = new Repo(), depositRepo = new Repo(), audits = [], relays = [];
  const deposits = new ReservationDepositService(depositRepo, { clock: () => current, audit: (...args) => audits.push(args) });
  const reservations = new ReservationService(reservationRepo, deposits, { clock: () => current, settings: () => config, tables: () => tables, relay: async (table, state) => relays.push([table.id, state]), audit: (...args) => audits.push(args) });
  return { reservations, deposits, reservationRepo, depositRepo, audits, relays, setNow: value => { current = new Date(value); } };
}
const cashier = { userId: "cashier-1", role: "CASHIER" }, manager = { userId: "manager-1", role: "MANAGER" };
const valid = { customerName: "Somchai", phone: "0812345678", reservationDate: "2026-07-27", reservationTime: "18:00", amountSatang: 10000, paymentMethod: "cash", paymentConfirmed: true };

test("creates reservation and AVAILABLE credit without creating revenue or bill fields", () => {
  const f = fixture(), result = f.reservations.create(valid, cashier);
  assert.equal(result.reservation.status, "BOOKED");
  assert.equal(result.deposit.status, "AVAILABLE");
  assert.equal(result.deposit.amountSatang, 10000);
  assert.equal(result.deposit.billId, undefined);
  assert.deepEqual(f.audits.map(x => x[0]), ["DEPOSIT_RECEIVED", "RESERVATION_CREATED"]);
});

test("enforces required deposit, payment method, confirmation, and minimum", () => {
  const f = fixture();
  assert.throws(() => f.reservations.create({ ...valid, amountSatang: 5000 }, cashier), /at least/);
  assert.throws(() => f.reservations.create({ ...valid, paymentMethod: "" }, cashier), /Payment method/);
  assert.throws(() => f.reservations.create({ ...valid, paymentConfirmed: false }, cashier), /confirmed/);
});

test("due reservation awaits staff decision; open-now starts the table and check-in preserves its start", async () => {
  const f = fixture("2026-07-27T11:00:00.000Z"), { reservation } = f.reservations.create({ ...valid, reservationTime: "17:00" }, cashier);
  await f.reservations.processDue();
  const due = f.reservations.get(reservation.id);
  assert.equal(due.status, "AWAITING_DECISION");
  assert.deepEqual(f.relays, []);
  const { reservation: ready } = await f.reservations.openNow(reservation.id, cashier, due.version);
  assert.equal(ready.status, "OPENED_WAITING_CHECK_IN");
  assert.equal(ready.assignedTableId, 1);
  assert.deepEqual(f.relays, [[1, "on"]]);
  const checked = f.reservations.checkIn(reservation.id, cashier);
  assert.equal(checked.status, "CHECKED_IN");
  assert.equal(checked.checkInDeadlineAt, ready.checkInDeadlineAt);
});

test("staff decision moves a due reservation to waiting table when no table is free", async () => {
  const tables = [{ id: 1, name: "T1", status: "playing", relay: 1 }], f = fixture("2026-07-27T12:00:00.000Z", tables);
  const { reservation } = f.reservations.create({ ...valid, reservationTime: "18:00" }, cashier);
  await f.reservations.processDue();
  const due=f.reservations.get(reservation.id);
  assert.equal(due.status, "AWAITING_DECISION");
  const result=await f.reservations.openNow(reservation.id,cashier,due.version);
  assert.equal(result.reservation.status, "WAITING_TABLE");
});

test("opened reservation expiry cancels without bill and forfeits its deposit", async () => {
  const f = fixture("2026-07-27T12:00:00.000Z"), { reservation, deposit } = f.reservations.create({ ...valid, reservationTime: "18:00" }, cashier);
  await f.reservations.processDue();
  await f.reservations.openNow(reservation.id,cashier,f.reservations.get(reservation.id).version);
  f.setNow("2026-07-27T13:00:01.000Z");
  await f.reservations.processDue();
  assert.equal(f.reservations.get(reservation.id).status, "NO_SHOW");
  assert.equal(f.deposits.repository.findById(deposit.id).status, "FORFEITED");
  assert.deepEqual(f.relays.at(-1), [1, "off"]);
});

test("cancel retains AVAILABLE deposit; refund and void need manager plus reason", async () => {
  const f = fixture(), first = f.reservations.create(valid, cashier);
  await f.reservations.cancel(first.reservation.id, cashier);
  assert.equal(f.depositRepo.findById(first.deposit.id).status, "AVAILABLE");
  assert.throws(() => f.deposits.refund(first.deposit.id, "customer request", cashier), /Only OWNER/);
  assert.throws(() => f.deposits.refund(first.deposit.id, "", manager), /Reason/);
  assert.equal(f.deposits.refund(first.deposit.id, "customer request", manager).status, "REFUNDED");
  const second = f.reservations.create({ ...valid, phone: "0899999999" }, cashier);
  assert.equal(f.deposits.void(second.deposit.id, "duplicate payment", manager).status, "VOIDED");
});

test("reservation permissions follow Sprint 10A matrix", () => {
  assert.equal(hasPermission("STAFF", PERMISSIONS.RESERVATION_VIEW), true);
  assert.equal(hasPermission("STAFF", PERMISSIONS.RESERVATION_MANAGE), false);
  assert.equal(hasPermission("CASHIER", PERMISSIONS.RESERVATION_MANAGE), true);
  assert.equal(hasPermission("CASHIER", PERMISSIONS.RESERVATION_DEPOSIT_ADJUST), false);
  assert.equal(hasPermission("MANAGER", PERMISSIONS.RESERVATION_DEPOSIT_ADJUST), true);
});
