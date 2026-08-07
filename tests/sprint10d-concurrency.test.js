const test = require("node:test");
const assert = require("node:assert/strict");
const { ReservationService } = require("../services/reservation-service");

test("concurrent Open Now and Defer allow exactly one decision", async () => {
  const row = { id: "R1", reservationNumber: "RSV-1", status: "AWAITING_DECISION", reservedAt: "2026-01-01T00:00:00.000Z", effectiveReservationAt: "2026-01-01T00:00:00.000Z", timeline: [], version: 2 };
  const repo = { list: () => [row], findById: () => row, update: item => item };
  const depositService = { list: () => [] };
  let releaseRelay;
  const relayGate = new Promise(resolve => { releaseRelay = resolve; });
  const service = new ReservationService(repo, depositService, {
    settings: () => ({ reservation: { deferMinutes: 20, checkInGraceMinutes: 60 } }),
    tables: () => [{ id: 1, name: "T1", status: "free" }],
    relay: () => relayGate,
    startSession: () => ({ id: "S1" })
  });
  const user = { userId: "cashier", role: "CASHIER" };
  const open = service.openNow("R1", user, 2);
  assert.throws(() => service.defer("R1", user, 2), error => error.code === "RESERVATION_OPERATION_IN_PROGRESS");
  releaseRelay();
  const result = await open;
  assert.equal(result.reservation.status, "OPENED_WAITING_CHECK_IN");
  assert.equal(result.reservation.deferCount || 0, 0);
});

test("hundreds of sequential reservation numbers remain unique and monotonic", () => {
  const rows = [], deposits = [];
  const repo = { list: () => rows, findById: id => rows.find(item => item.id === id), create: item => (rows.push(item),item), update: item => item };
  const depositService = { create: input => { const value={id:`D${deposits.length+1}`,...input};deposits.push(value);return value; }, list: () => deposits };
  const service = new ReservationService(repo, depositService, { settings: () => ({ reservation: { depositRequired: true, minimumDepositAmount: 100 } }), tables: () => [] });
  const user = { userId: "cashier", role: "CASHIER" };
  for (let index=0;index<300;index+=1) service.create({customerName:`C${index}`,phone:`08${index}`,reservationDate:"2030-01-01",reservationTime:"10:00",amountSatang:10000,paymentMethod:"cash",paymentConfirmed:true},user);
  const numbers=rows.map(item=>item.reservationNumber);
  assert.equal(new Set(numbers).size,300);
  assert.equal(numbers[0],"RSV-20300101-0001");
  assert.equal(numbers[299],"RSV-20300101-0300");
});
