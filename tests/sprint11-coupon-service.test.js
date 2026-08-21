const test = require("node:test");
const assert = require("node:assert/strict");
const { JsonCouponRepository } = require("../repositories/json-coupon-repository");
const { CouponService, CODE_ALPHABET } = require("../services/coupon-service");

function makeRig({ now = "2026-08-21T10:00:00.000Z" } = {}) {
  const store = { coupons: [], couponCodes: [], couponRedemptions: [] };
  const audits = [];
  const members = new Map();
  const clock = { value: new Date(now) };
  const repository = new JsonCouponRepository({ getStore: () => store, save: () => {} });
  const service = new CouponService(repository, {
    clock: () => clock.value,
    audit: (event, actor, details) => audits.push({ event, actor, details }),
    memberById: id => members.get(id) || null
  });
  const addMember = (id, status = "ACTIVE") => { const member = { id, status, displayName: id }; members.set(id, member); return member; };
  const at = iso => { clock.value = new Date(iso); };
  return { store, service, repository, audits, addMember, at };
}

// A ฿50-off drinks coupon on both channels: the shape the owner asked for on 2026-08-21.
const drinksCoupon = { name: "ส่วนลดเครื่องดื่ม 50 บาท", discountType: "FIXED", discountValue: 5000, scope: "PRODUCTS", channels: ["TABLE", "WALK_IN"], status: "ACTIVE" };
const tableBill = (tableChargeSatang, productSatang = 0, extra = {}) => ({ id: "bill-1", breakdown: { tableChargeSatang, productSatang, totalSatang: tableChargeSatang + productSatang }, ...extra });
const walkInBill = (productSatang, extra = {}) => ({ id: "bill-w", breakdown: { tableChargeSatang: 0, productSatang, totalSatang: productSatang }, ...extra });

// ---- code format ---------------------------------------------------------------------------

test("a generated shared code is 8 characters from the no-confusables alphabet", () => {
  const { service } = makeRig();
  const coupon = service.create({ ...drinksCoupon }, "owner");
  assert.equal(coupon.code.length, 8);
  assert.ok([...coupon.code].every(character => CODE_ALPHABET.includes(character)), `${coupon.code} uses only safe characters`);
  assert.ok(!/[O0I1L]/.test(coupon.code), "no character that could be misread off a paper voucher");
});

test("a typed code is matched regardless of case, spaces and dashes", () => {
  const { service } = makeRig();
  const coupon = service.create({ ...drinksCoupon, code: "SNK2026" }, "owner");
  assert.equal(service.resolveCode(" snk-2026 ").coupon.id, coupon.id);
});

test("two coupons cannot share a code", () => {
  const { service } = makeRig();
  service.create({ ...drinksCoupon, code: "SNK2026" }, "owner");
  assert.throws(() => service.create({ ...drinksCoupon, code: "snk 2026" }, "owner"), { code: "COUPON_CODE_EXISTS" });
});

// ---- creation rules ------------------------------------------------------------------------

test("a percent coupon is refused without a maximum discount", () => {
  const { service } = makeRig();
  assert.throws(() => service.create({ ...drinksCoupon, discountType: "PERCENT", discountValue: 20, maxDiscountSatang: undefined }, "owner"), { code: "VALIDATION_ERROR" });
});

test("a table-charge coupon cannot be offered on walk-in sales", () => {
  const { service } = makeRig();
  assert.throws(() => service.create({ ...drinksCoupon, scope: "TABLE_CHARGE", channels: ["TABLE", "WALK_IN"] }, "owner"), { code: "VALIDATION_ERROR" });
});

test("channels default to table only, and an unknown channel is refused", () => {
  const { service } = makeRig();
  assert.deepEqual(service.create({ ...drinksCoupon, channels: undefined }, "owner").channels, ["TABLE"]);
  assert.throws(() => service.create({ ...drinksCoupon, channels: ["ONLINE"] }, "owner"), { code: "VALIDATION_ERROR" });
});

test("a shared coupon defaults to one use per member, a unique-voucher coupon to unlimited", () => {
  const { service } = makeRig();
  assert.equal(service.create({ ...drinksCoupon }, "owner").perMemberLimit, 1);
  assert.equal(service.create({ ...drinksCoupon, codeMode: "UNIQUE" }, "owner").perMemberLimit, 0);
});

// ---- eligibility ---------------------------------------------------------------------------

test("a coupon is refused without a member, and for a disabled member", () => {
  const { service, addMember } = makeRig();
  const coupon = service.create({ ...drinksCoupon }, "owner");
  addMember("m-off", "DISABLED");
  assert.throws(() => service.validate({ code: coupon.code, memberId: null }), { code: "COUPON_MEMBER_REQUIRED" });
  assert.throws(() => service.validate({ code: coupon.code, memberId: "m-off" }), { code: "COUPON_MEMBER_REQUIRED" });
});

test("the allowed channels are enforced in both directions", () => {
  const { service, addMember } = makeRig();
  addMember("m1");
  const tableOnly = service.create({ ...drinksCoupon, channels: ["TABLE"] }, "owner");
  const walkInOnly = service.create({ ...drinksCoupon, channels: ["WALK_IN"] }, "owner");
  const both = service.create({ ...drinksCoupon }, "owner");
  assert.throws(() => service.validate({ code: tableOnly.code, memberId: "m1", channel: "WALK_IN" }), { code: "COUPON_CHANNEL_NOT_ALLOWED" });
  assert.throws(() => service.validate({ code: walkInOnly.code, memberId: "m1", channel: "TABLE" }), { code: "COUPON_CHANNEL_NOT_ALLOWED" });
  assert.equal(service.validate({ code: both.code, memberId: "m1", channel: "TABLE" }).channel, "TABLE");
  assert.equal(service.validate({ code: both.code, memberId: "m1", channel: "WALK_IN" }).channel, "WALK_IN");
});

test("a draft or paused coupon cannot be redeemed", () => {
  const { service, addMember } = makeRig();
  addMember("m1");
  const coupon = service.create({ ...drinksCoupon, status: "DRAFT" }, "owner");
  assert.throws(() => service.validate({ code: coupon.code, memberId: "m1" }), { code: "COUPON_NOT_ACTIVE" });
  service.setStatus(coupon.id, "ACTIVE", "owner");
  assert.ok(service.validate({ code: coupon.code, memberId: "m1" }));
  service.setStatus(coupon.id, "PAUSED", "owner");
  assert.throws(() => service.validate({ code: coupon.code, memberId: "m1" }), { code: "COUPON_NOT_ACTIVE" });
});

// The end date runs to the end of the Bangkok day, not to UTC midnight — a coupon printed
// "ใช้ได้ถึง 31 ส.ค." must still work at 23:00 on the 31st, which is already 1 September in UTC.
test("the end date is inclusive to the end of the Bangkok day", () => {
  const { service, addMember, at } = makeRig();
  addMember("m1");
  const coupon = service.create({ ...drinksCoupon, startsAt: "2026-08-01", endsAt: "2026-08-31" }, "owner");
  at("2026-08-31T16:00:00.000Z"); // 23:00 on 31 August in Bangkok — still valid
  assert.ok(service.validate({ code: coupon.code, memberId: "m1" }));
  at("2026-08-31T17:30:00.000Z"); // 00:30 on 1 September in Bangkok — over
  assert.throws(() => service.validate({ code: coupon.code, memberId: "m1" }), { code: "COUPON_EXPIRED" });
});

test("a coupon cannot be used before its start date", () => {
  const { service, addMember } = makeRig({ now: "2026-08-21T10:00:00.000Z" });
  addMember("m1");
  const coupon = service.create({ ...drinksCoupon, startsAt: "2026-09-01" }, "owner");
  assert.throws(() => service.validate({ code: coupon.code, memberId: "m1" }), { code: "COUPON_NOT_STARTED" });
});

test("an end date before the start date is refused", () => {
  const { service } = makeRig();
  assert.throws(() => service.create({ ...drinksCoupon, startsAt: "2026-09-01", endsAt: "2026-08-01" }, "owner"), { code: "VALIDATION_ERROR" });
});

// ---- quota, reserved at open -----------------------------------------------------------------

test("the last voucher cannot be claimed twice at once — the quota is held from the moment of the claim", () => {
  const { service, addMember } = makeRig();
  addMember("m1"); addMember("m2");
  const coupon = service.create({ ...drinksCoupon, totalQuota: 1, perMemberLimit: 0 }, "owner");
  service.reserve({ code: coupon.code, memberId: "m1", tableSessionId: "s1" }, "cashier");
  // Nothing has been paid yet, but the quota is already gone — this is the race the design exists for.
  assert.throws(() => service.reserve({ code: coupon.code, memberId: "m2", tableSessionId: "s2" }, "cashier"), { code: "COUPON_DEPLETED" });
  assert.equal(service.get(coupon.id).status, "DEPLETED");
  assert.equal(service.get(coupon.id).reservedCount, 1);
});

test("releasing a reservation gives the quota back and reopens the coupon", () => {
  const { service, addMember } = makeRig();
  addMember("m1"); addMember("m2");
  const coupon = service.create({ ...drinksCoupon, totalQuota: 1, perMemberLimit: 0 }, "owner");
  const reservation = service.reserve({ code: coupon.code, memberId: "m1", tableSessionId: "s1" }, "cashier");
  service.release(reservation.id, "SESSION_CANCELLED", "cashier");
  assert.equal(service.get(coupon.id).status, "ACTIVE");
  assert.equal(service.get(coupon.id).reservedCount, 0);
  assert.ok(service.reserve({ code: coupon.code, memberId: "m2", tableSessionId: "s2" }, "cashier"));
});

test("one sale cannot carry two coupons", () => {
  const { service, addMember } = makeRig();
  addMember("m1");
  const first = service.create({ ...drinksCoupon, perMemberLimit: 0 }, "owner");
  const second = service.create({ ...drinksCoupon, perMemberLimit: 0 }, "owner");
  service.reserve({ code: first.code, memberId: "m1", tableSessionId: "s1" }, "cashier");
  assert.throws(() => service.reserve({ code: second.code, memberId: "m1", tableSessionId: "s1" }, "cashier"), { code: "COUPON_ALREADY_RESERVED" });
});

test("the per-member limit counts reservations that have not been paid yet", () => {
  const { service, addMember } = makeRig();
  addMember("m1");
  const coupon = service.create({ ...drinksCoupon }, "owner"); // perMemberLimit defaults to 1
  service.reserve({ code: coupon.code, memberId: "m1", tableSessionId: "s1" }, "cashier");
  assert.throws(() => service.reserve({ code: coupon.code, memberId: "m1", tableSessionId: "s2" }, "cashier"), { code: "COUPON_MEMBER_LIMIT" });
});

test("a table claim needs a session and a walk-in claim needs an order", () => {
  const { service, addMember } = makeRig();
  addMember("m1");
  const coupon = service.create({ ...drinksCoupon }, "owner");
  assert.throws(() => service.reserve({ code: coupon.code, memberId: "m1", channel: "TABLE" }, "cashier"), { code: "VALIDATION_ERROR" });
  assert.throws(() => service.reserve({ code: coupon.code, memberId: "m1", channel: "WALK_IN" }, "cashier"), { code: "VALIDATION_ERROR" });
});

// ---- unique vouchers -------------------------------------------------------------------------

test("a voucher batch is unique, and each voucher walks UNUSED -> RESERVED -> USED", () => {
  const { service, store, addMember } = makeRig();
  addMember("m1");
  const coupon = service.create({ ...drinksCoupon, codeMode: "UNIQUE", codeCount: 5 }, "owner");
  assert.equal(coupon.code, null, "a unique-code coupon has no shared code to leak");
  assert.equal(store.couponCodes.length, 5);
  assert.equal(new Set(store.couponCodes.map(entry => entry.code)).size, 5);
  const voucher = store.couponCodes[0];
  const reservation = service.reserve({ code: voucher.code, memberId: "m1", tableSessionId: "s1" }, "cashier");
  assert.equal(store.couponCodes[0].status, "RESERVED");
  assert.throws(() => service.reserve({ code: voucher.code, memberId: "m1", tableSessionId: "s2" }, "cashier"), { code: "COUPON_CODE_USED" });
  service.apply(reservation.id, walkInBill(20000), "cashier");
  assert.equal(store.couponCodes[0].status, "USED");
  assert.equal(service.remainingQuota(service.get(coupon.id)), 4);
});

test("releasing a unique voucher puts the printed code back in circulation", () => {
  const { service, store, addMember } = makeRig();
  addMember("m1");
  service.create({ ...drinksCoupon, codeMode: "UNIQUE", codeCount: 1 }, "owner");
  const voucher = store.couponCodes[0];
  const reservation = service.reserve({ code: voucher.code, memberId: "m1", tableSessionId: "s1" }, "cashier");
  service.release(reservation.id, "COUPON_REMOVED", "cashier");
  assert.equal(store.couponCodes[0].status, "UNUSED");
  assert.equal(store.couponCodes[0].redemptionId, null);
  assert.ok(service.reserve({ code: voucher.code, memberId: "m1", tableSessionId: "s2" }, "cashier"));
});

test("only a unique-code coupon has voucher batches", () => {
  const { service } = makeRig();
  const shared = service.create({ ...drinksCoupon }, "owner");
  assert.throws(() => service.generateCodes(shared.id, 10, "owner"), { code: "VALIDATION_ERROR" });
});

// ---- discount arithmetic ---------------------------------------------------------------------

test("a percent discount is held under its ceiling, and rounds half-up", () => {
  const { service } = makeRig();
  const rule = { discountType: "PERCENT", discountValue: 15, maxDiscountSatang: 10000, scope: "WHOLE_BILL" };
  assert.equal(service.calculateDiscountSatang(rule, 1050), 158, "157.5 satang rounds up");
  assert.equal(service.calculateDiscountSatang(rule, 100000), 10000, "held at the ฿100 ceiling, not ฿150");
});

test("a discount can never exceed what is left to pay", () => {
  const { service } = makeRig();
  assert.equal(service.calculateDiscountSatang({ discountType: "FIXED", discountValue: 5000, scope: "PRODUCTS" }, 3000), 3000);
  assert.equal(service.calculateDiscountSatang({ discountType: "PERCENT", discountValue: 100, maxDiscountSatang: 999999, scope: "WHOLE_BILL" }, 4200), 4200);
  assert.equal(service.calculateDiscountSatang({ discountType: "FIXED", discountValue: 5000, scope: "PRODUCTS" }, 0), 0);
});

test("each scope measures the part of the bill it names", () => {
  const { service } = makeRig();
  const bill = tableBill(30000, 12000);
  assert.equal(service.scopeBaseSatang({ scope: "TABLE_CHARGE" }, bill), 30000);
  assert.equal(service.scopeBaseSatang({ scope: "PRODUCTS" }, bill), 12000);
  assert.equal(service.scopeBaseSatang({ scope: "WHOLE_BILL" }, bill), 42000);
  // A walk-in bill has no table time at all, so a whole-bill coupon there is a products coupon.
  assert.equal(service.scopeBaseSatang({ scope: "WHOLE_BILL" }, walkInBill(12000)), 12000);
  assert.equal(service.scopeBaseSatang({ scope: "TABLE_CHARGE" }, walkInBill(12000)), 0);
});

// ---- checkout --------------------------------------------------------------------------------

test("applying consumes the reservation and records what was actually given", () => {
  const { service, addMember } = makeRig();
  addMember("m1");
  const coupon = service.create({ ...drinksCoupon }, "owner");
  const reservation = service.reserve({ code: coupon.code, memberId: "m1", tableSessionId: "s1" }, "cashier");
  const result = service.apply(reservation.id, tableBill(30000, 12000), "cashier");
  assert.equal(result.discountSatang, 5000);
  assert.equal(result.redemption.status, "APPLIED");
  assert.equal(result.redemption.billId, "bill-1");
  assert.equal(service.get(coupon.id).usedCount, 1);
  assert.equal(service.get(coupon.id).reservedCount, 0);
});

// Blocking payment over a promotion is the wrong trade at a counter with a queue.
test("a coupon that misses its minimum spend is released, and does not block the sale", () => {
  const { service, addMember } = makeRig();
  addMember("m1");
  const coupon = service.create({ ...drinksCoupon, minSpendSatang: 30000 }, "owner");
  const reservation = service.reserve({ code: coupon.code, memberId: "m1", tableSessionId: "s1" }, "cashier");
  const result = service.apply(reservation.id, tableBill(0, 12000), "cashier");
  assert.equal(result.released, "MIN_SPEND_NOT_MET");
  assert.equal(result.discountSatang, 0);
  assert.equal(result.redemption.status, "RELEASED");
  assert.equal(service.get(coupon.id).usedCount, 0, "the quota is not spent on a coupon that never applied");
});

test("a coupon with nothing left to discount is handed back rather than burnt", () => {
  const { service, addMember } = makeRig();
  addMember("m1");
  const coupon = service.create({ ...drinksCoupon }, "owner"); // PRODUCTS scope
  const reservation = service.reserve({ code: coupon.code, memberId: "m1", tableSessionId: "s1" }, "cashier");
  const result = service.apply(reservation.id, tableBill(30000, 0), "cashier");
  assert.equal(result.released, "NO_DISCOUNT_AVAILABLE");
  assert.equal(service.get(coupon.id).usedCount, 0);
});

test("a coupon and point redemption refuse each other on the same bill", () => {
  const { service, addMember } = makeRig();
  addMember("m1");
  const coupon = service.create({ ...drinksCoupon }, "owner");
  const reservation = service.reserve({ code: coupon.code, memberId: "m1", tableSessionId: "s1" }, "cashier");
  assert.throws(() => service.apply(reservation.id, tableBill(30000, 12000, { redeemSelected: true }), "cashier"), { code: "COUPON_POINTS_CONFLICT" });
  assert.equal(service.repository.findRedemption(reservation.id).status, "RESERVED", "the coupon is not silently dropped");
});

test("a redemption cannot be applied twice", () => {
  const { service, addMember } = makeRig();
  addMember("m1");
  const coupon = service.create({ ...drinksCoupon }, "owner");
  const reservation = service.reserve({ code: coupon.code, memberId: "m1", tableSessionId: "s1" }, "cashier");
  service.apply(reservation.id, walkInBill(20000), "cashier");
  assert.throws(() => service.apply(reservation.id, walkInBill(20000), "cashier"), { code: "COUPON_REDEMPTION_CONFLICT" });
});

test("voiding a paid bill releases the coupon it carried", () => {
  const { service, addMember } = makeRig();
  addMember("m1");
  const coupon = service.create({ ...drinksCoupon }, "owner");
  const reservation = service.reserve({ code: coupon.code, memberId: "m1", tableSessionId: "s1" }, "cashier");
  service.apply(reservation.id, walkInBill(20000), "cashier");
  const released = service.release(reservation.id, "BILL_VOIDED", "manager");
  assert.equal(released.status, "RELEASED");
  assert.equal(released.discountSatang, 0);
  assert.equal(service.get(coupon.id).usedCount, 0);
});

// ---- the walk-in channel end to end ------------------------------------------------------------

test("a ฿50-off drinks coupon works on a walk-in sale with no table", () => {
  const { service, addMember } = makeRig();
  addMember("m1");
  const coupon = service.create({ ...drinksCoupon }, "owner");
  const reservation = service.reserve({ code: coupon.code, memberId: "m1", channel: "WALK_IN", posOrderId: "pos-1" }, "cashier");
  assert.equal(reservation.channel, "WALK_IN");
  assert.equal(reservation.tableSessionId, null);
  assert.equal(service.reservedForPosOrder("pos-1").id, reservation.id);
  const result = service.apply(reservation.id, walkInBill(12000), "cashier");
  assert.equal(result.discountSatang, 5000);
});

// ---- editing a live coupon ---------------------------------------------------------------------

test("a redeemed coupon can be renamed but not repriced", () => {
  const { service, addMember } = makeRig();
  addMember("m1");
  const coupon = service.create({ ...drinksCoupon }, "owner");
  const reservation = service.reserve({ code: coupon.code, memberId: "m1", tableSessionId: "s1" }, "cashier");
  service.apply(reservation.id, walkInBill(20000), "cashier");
  assert.equal(service.update(coupon.id, { name: "ส่วนลดเครื่องดื่ม (เดือนสิงหาคม)" }, "owner").name, "ส่วนลดเครื่องดื่ม (เดือนสิงหาคม)");
  assert.throws(() => service.update(coupon.id, { discountValue: 10000 }, "owner"), { code: "COUPON_IMMUTABLE" });
  assert.throws(() => service.update(coupon.id, { scope: "WHOLE_BILL" }, "owner"), { code: "COUPON_IMMUTABLE" });
});

test("an untouched coupon can still be repriced, but never recoded", () => {
  const { service } = makeRig();
  const coupon = service.create({ ...drinksCoupon }, "owner");
  assert.equal(service.update(coupon.id, { discountValue: 7500 }, "owner").discountValue, 7500);
  assert.throws(() => service.update(coupon.id, { code: "OTHERONE" }, "owner"), { code: "COUPON_IMMUTABLE" });
  assert.throws(() => service.update(coupon.id, { codeMode: "UNIQUE" }, "owner"), { code: "COUPON_IMMUTABLE" });
});

test("an expired coupon is a dead end, and DEPLETED is never set by hand", () => {
  const { service } = makeRig();
  const coupon = service.create({ ...drinksCoupon }, "owner");
  service.setStatus(coupon.id, "EXPIRED", "owner");
  assert.throws(() => service.setStatus(coupon.id, "ACTIVE", "owner"), { code: "COUPON_STATUS_CONFLICT" });
  const other = service.create({ ...drinksCoupon }, "owner");
  assert.throws(() => service.setStatus(other.id, "DEPLETED", "owner"), { code: "VALIDATION_ERROR" });
});

// The snapshot is why a receipt reprinted months later still shows what was actually given.
test("a redemption freezes the rule it was claimed under", () => {
  const { service, addMember } = makeRig();
  addMember("m1");
  const coupon = service.create({ ...drinksCoupon }, "owner");
  const reservation = service.reserve({ code: coupon.code, memberId: "m1", tableSessionId: "s1" }, "cashier");
  service.update(coupon.id, { name: "renamed" }, "owner");
  assert.equal(reservation.couponSnapshot.name, "ส่วนลดเครื่องดื่ม 50 บาท");
  assert.equal(reservation.couponSnapshot.discountValue, 5000);
  assert.equal(reservation.scopeSnapshot, "PRODUCTS");
});

// ---- audit trail --------------------------------------------------------------------------------

test("every step of a coupon's life is audited", () => {
  const { service, audits, addMember } = makeRig();
  addMember("m1");
  const coupon = service.create({ ...drinksCoupon, codeMode: "UNIQUE", codeCount: 2 }, "owner");
  service.setStatus(coupon.id, "PAUSED", "owner");
  service.setStatus(coupon.id, "ACTIVE", "owner");
  service.update(coupon.id, { minSpendSatang: 1000 }, "owner");
  const voucher = service.repository.codesForCoupon(coupon.id)[0];
  const reservation = service.reserve({ code: voucher.code, memberId: "m1", tableSessionId: "s1" }, "cashier");
  service.apply(reservation.id, walkInBill(20000), "cashier");
  service.release(reservation.id, "BILL_VOIDED", "manager");
  assert.deepEqual(audits.map(entry => entry.event), [
    "COUPON_CREATED", "COUPON_CODES_GENERATED", "COUPON_STATUS_CHANGED", "COUPON_STATUS_CHANGED", "COUPON_UPDATED",
    "COUPON_RESERVED", "COUPON_APPLIED", "COUPON_RELEASED"
  ]);
  assert.equal(audits.at(-1).actor, "manager");
  assert.equal(audits.at(-1).details.reason, "BILL_VOIDED");
});
