const test = require("node:test");
const assert = require("node:assert/strict");
const { ReservationService } = require("../services/reservation-service");

// Booking for a member should not make staff retype the name and phone the member record already
// holds — that is how a booking ends up filed under a misspelling of a customer who is already in
// the system. The dialog fills and locks both fields; these tests pin the rule on the SERVER, which
// is what actually decides whether a reservation exists.
//
// The one thing the record cannot supply is a phone the member does not have. A phone reservation
// with no number to call back is useless, so that case is still refused.

const CONFIG = { depositRequired: true, minimumDepositAmount: 100, alertEnabled: true, alertRepeatMinutes: 1, tableFreeAlertMinutes: 5, deferMinutes: 20, checkInGraceMinutes: 60 };
const MEMBERS = {
  "m-full": { id: "m-full", memberCode: "M0001", displayName: "สมชาย ใจดี", phone: "0812345678", status: "ACTIVE" },
  "m-nophone": { id: "m-nophone", memberCode: "M0002", displayName: "สมหญิง รักเรียน", phone: "", status: "ACTIVE" },
  "m-inactive": { id: "m-inactive", memberCode: "M0003", displayName: "อดีตสมาชิก", phone: "0800000000", status: "DISABLED" }
};

function service() {
  const rows = [];
  const repository = { list: () => rows, findById: id => rows.find(row => row.id === id) || null, create: row => { rows.push(row); return row; }, update: row => row };
  return new ReservationService(repository, { create: () => ({ id: "dep-1" }), list: () => [] }, {
    settings: () => ({ reservation: CONFIG }), tables: () => [], clock: () => new Date("2026-08-20T03:00:00Z"),
    memberById: id => MEMBERS[id] || null
  });
}
const booking = extra => ({ reservationDate: "2026-08-25", reservationTime: "18:00", amountSatang: 10000, paymentMethod: "cash", paymentConfirmed: true, ...extra });
const USER = { userId: "u1", role: "CASHIER" };

test("a member booking needs no name or phone typed in — both come from the member record", () => {
  const { reservation } = service().create(booking({ memberId: "m-full" }), USER);
  assert.equal(reservation.customerName, "สมชาย ใจดี");
  assert.equal(reservation.phone, "0812345678");
  assert.equal(reservation.memberCode, "M0001");
});

test("a member with no phone on file cannot be booked without one being supplied", () => {
  assert.throws(() => service().create(booking({ memberId: "m-nophone" }), USER),
    error => error.code === "VALIDATION_ERROR" && /phone/i.test(error.message));
});

test("that same member books fine once a phone is typed for this booking", () => {
  const { reservation } = service().create(booking({ memberId: "m-nophone", phone: "0899999999" }), USER);
  assert.equal(reservation.customerName, "สมหญิง รักเรียน", "the name still comes from the record");
  assert.equal(reservation.phone, "0899999999");
});

test("anything typed by staff still wins over the member record", () => {
  // Booking on behalf of a member but for someone else's phone, or under a nickname they gave.
  const { reservation } = service().create(booking({ memberId: "m-full", customerName: "พี่ชาย", phone: "0777777777" }), USER);
  assert.equal(reservation.customerName, "พี่ชาย");
  assert.equal(reservation.phone, "0777777777");
});

test("a non-member booking still requires both fields, exactly as before", () => {
  assert.throws(() => service().create(booking({}), USER), error => error.code === "VALIDATION_ERROR");
  assert.throws(() => service().create(booking({ customerName: "ลูกค้าทั่วไป" }), USER),
    error => error.code === "VALIDATION_ERROR" && /phone/i.test(error.message));
  const { reservation } = service().create(booking({ customerName: "ลูกค้าทั่วไป", phone: "0811111111" }), USER);
  assert.equal(reservation.memberId, null);
});

test("an inactive member is refused before any field is derived from it", () => {
  assert.throws(() => service().create(booking({ memberId: "m-inactive" }), USER),
    error => error.code === "MEMBER_NOT_ACTIVE");
});
