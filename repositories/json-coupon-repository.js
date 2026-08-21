// Three additive collections on store.json. `coupons` is the campaign, `couponCodes` holds the
// printed vouchers of a UNIQUE-mode campaign, and `couponRedemptions` is the ledger — one row per
// attempt, and the only source of truth for how much quota is really gone. The counters kept on the
// coupon itself are a denormalised convenience for the list screen and are rebuilt from the ledger
// by CouponService#recount whenever a redemption changes state.
class JsonCouponRepository {
  constructor({ getStore, save }) { this.getStore = getStore; this.save = save; }
  collection(name) { const store = this.getStore(); if (!Array.isArray(store[name])) store[name] = []; return store[name]; }
  coupons() { return this.collection("coupons"); }
  codes() { return this.collection("couponCodes"); }
  redemptions() { return this.collection("couponRedemptions"); }

  findCoupon(id) { return this.coupons().find(coupon => coupon.id === id) || null; }
  // Codes are unique across ALL coupons (see CouponService#generateCode), so a lookup never has to
  // know which campaign it belongs to — which is the whole point: staff type a code, nothing else.
  findSharedByCode(code) { return this.coupons().find(coupon => coupon.codeMode === "SHARED" && coupon.code === code) || null; }
  findCodeByCode(code) { return this.codes().find(entry => entry.code === code) || null; }
  findCodeById(id) { return this.codes().find(entry => entry.id === id) || null; }
  codesForCoupon(couponId) { return this.codes().filter(entry => entry.couponId === couponId); }

  findRedemption(id) { return this.redemptions().find(entry => entry.id === id) || null; }
  redemptionsForCoupon(couponId) { return this.redemptions().filter(entry => entry.couponId === couponId); }
  redemptionsForMember(couponId, memberId) { return this.redemptions().filter(entry => entry.couponId === couponId && entry.memberId === memberId); }
  findReservedBySession(tableSessionId) { return this.redemptions().find(entry => entry.status === "RESERVED" && entry.tableSessionId && entry.tableSessionId === tableSessionId) || null; }
  findReservedByPosOrder(posOrderId) { return this.redemptions().find(entry => entry.status === "RESERVED" && entry.posOrderId && entry.posOrderId === posOrderId) || null; }
  // Used when a bill is voided or reopened, where the bill is all the caller has to go on.
  findLiveByBill(billId) { return this.redemptions().find(entry => entry.billId && entry.billId === billId && entry.status !== "RELEASED") || null; }

  saveCoupon(coupon) { const items = this.coupons(); const index = items.findIndex(item => item.id === coupon.id); if (index < 0) items.unshift(coupon); else items[index] = coupon; this.save(); return coupon; }
  saveCode(code) { const items = this.codes(); const index = items.findIndex(item => item.id === code.id); if (index < 0) items.push(code); else items[index] = code; this.save(); return code; }
  // A voucher batch is written in one go: generating 500 codes should cost one file write, not 500.
  addCodes(codes) { this.codes().push(...codes); this.save(); return codes; }
  saveRedemption(redemption) { const items = this.redemptions(); const index = items.findIndex(item => item.id === redemption.id); if (index < 0) items.unshift(redemption); else items[index] = redemption; this.save(); return redemption; }
}
module.exports = { JsonCouponRepository };
