const crypto = require("crypto");

// O/0, I/1/L are left out on purpose: staff read these off creased paper vouchers and type them on
// a phone, and one confusable character turns into a support call that looks like a broken coupon.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const CODE_MODES = Object.freeze(["SHARED", "UNIQUE"]);
const DISCOUNT_TYPES = Object.freeze(["PERCENT", "FIXED"]);
const SCOPES = Object.freeze(["TABLE_CHARGE", "PRODUCTS", "WHOLE_BILL"]);
// The two ways a sale reaches a bill. These are the same values bills already carry as
// `saleSource`, so the channel a coupon allows can be checked straight against the bill.
const CHANNELS = Object.freeze(["TABLE", "WALK_IN"]);
const STATUSES = Object.freeze(["DRAFT", "ACTIVE", "PAUSED", "EXPIRED", "DEPLETED"]);
const RESERVED = "RESERVED", APPLIED = "APPLIED", RELEASED = "RELEASED";
const UNUSED = "UNUSED", USED = "USED", VOID = "VOID";
const MAX_BATCH_SIZE = 2000;
// Which fields stop being editable once a coupon has been redeemed even once. Past redemptions keep
// their own snapshot, so changing these would not rewrite history — it would just make the same
// coupon name mean two different things, which is worse.
const LOCKED_AFTER_REDEMPTION = Object.freeze(["discountType", "discountValue", "maxDiscountSatang", "scope"]);
const ALLOWED_STATUS_CHANGES = Object.freeze({ DRAFT: ["ACTIVE", "EXPIRED"], ACTIVE: ["PAUSED", "EXPIRED"], PAUSED: ["ACTIVE", "EXPIRED"], DEPLETED: ["ACTIVE", "EXPIRED"], EXPIRED: [] });

const text = value => String(value ?? "").trim();
// Coupon validity is a shop-floor date range, not an instant: "ใช้ได้ถึง 31 ส.ค." means the whole of
// 31 August in Bangkok, whatever UTC says. Same helper the reservation service uses.
const bangkokDay = date => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

class CouponService {
  constructor(repository, { clock = () => new Date(), audit = () => {}, memberById = () => null } = {}) { Object.assign(this, { repository, clock, audit, memberById }); }
  now() { return this.clock(); }
  stamp() { return this.now().toISOString(); }
  today() { return bangkokDay(this.now()); }
  fail(code, message) { const error = new Error(message); error.code = code; throw error; }

  // ---- codes -------------------------------------------------------------------------------
  // "abcd-2345" and "ABCD 2345" are the same code as far as a customer is concerned.
  normalizeCode(value) { return text(value).toUpperCase().replace(/[^A-Z0-9]/g, ""); }
  codeTaken(code) { return Boolean(this.repository.findSharedByCode(code) || this.repository.findCodeByCode(code)); }
  randomCode() { let code = ""; for (let index = 0; index < CODE_LENGTH; index += 1) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]; return code; }
  // Codes are unique across every coupon, so a lookup only ever needs the code itself. 30^8 is a
  // large enough space that the retry loop is a formality, but an unbounded one would hang the
  // request if it ever stopped being one.
  generateCode(taken = new Set()) { for (let attempt = 0; attempt < 50; attempt += 1) { const code = this.randomCode(); if (!taken.has(code) && !this.codeTaken(code)) return code; } return this.fail("COUPON_CODE_EXHAUSTED", "Could not generate a unique coupon code"); }

  // ---- validation helpers ------------------------------------------------------------------
  day(value, label) { const raw = text(value); if (!raw) return null; if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw; const parsed = new Date(raw); if (Number.isNaN(parsed.getTime())) this.fail("VALIDATION_ERROR", `${label} must be a valid date`); return bangkokDay(parsed); }
  nonNegativeInteger(value, label, fallback = 0) { const result = value === undefined || value === null || value === "" ? fallback : Number(value); if (!Number.isInteger(result) || result < 0) this.fail("VALIDATION_ERROR", `${label} must be a non-negative integer`); return result; }
  channelList(value, fallback = ["TABLE"]) { const list = value === undefined ? fallback : (Array.isArray(value) ? value : [value]).map(entry => text(entry).toUpperCase()); const unique = [...new Set(list)]; if (!unique.length) this.fail("VALIDATION_ERROR", "At least one channel is required"); for (const channel of unique) if (!CHANNELS.includes(channel)) this.fail("VALIDATION_ERROR", `Invalid channel: ${channel}`); return CHANNELS.filter(channel => unique.includes(channel)); }

  // A TABLE_CHARGE coupon on a walk-in sale would always discount zero — a walk-in bill has no table
  // time on it at all. Refusing the combination at creation is far kinder than letting the owner
  // print vouchers that silently do nothing at the counter.
  assertScopeChannels(scope, channels) { if (scope === "TABLE_CHARGE" && channels.includes("WALK_IN")) this.fail("VALIDATION_ERROR", "A table-charge coupon cannot be used on walk-in sales"); }

  validateRule(input, base = {}) {
    const rule = {};
    rule.discountType = text(input.discountType ?? base.discountType).toUpperCase();
    if (!DISCOUNT_TYPES.includes(rule.discountType)) this.fail("VALIDATION_ERROR", "Discount type must be PERCENT or FIXED");
    rule.discountValue = Number(input.discountValue ?? base.discountValue);
    if (!Number.isInteger(rule.discountValue) || rule.discountValue <= 0) this.fail("VALIDATION_ERROR", "Discount value must be a positive integer");
    if (rule.discountType === "PERCENT") {
      if (rule.discountValue > 100) this.fail("VALIDATION_ERROR", "Percent discount cannot exceed 100");
      // Without a ceiling a "20% off" coupon is an open-ended liability on a long session.
      rule.maxDiscountSatang = Number(input.maxDiscountSatang ?? base.maxDiscountSatang);
      if (!Number.isInteger(rule.maxDiscountSatang) || rule.maxDiscountSatang <= 0) this.fail("VALIDATION_ERROR", "A percent coupon needs a maximum discount");
    } else rule.maxDiscountSatang = null;
    rule.scope = text(input.scope ?? base.scope).toUpperCase();
    if (!SCOPES.includes(rule.scope)) this.fail("VALIDATION_ERROR", "Scope must be TABLE_CHARGE, PRODUCTS or WHOLE_BILL");
    return rule;
  }

  // ---- coupons -----------------------------------------------------------------------------
  get(id) { const coupon = this.repository.findCoupon(id); if (!coupon) this.fail("COUPON_NOT_FOUND", "Coupon not found"); return coupon; }

  list(query = {}) {
    const search = text(query.search).toLowerCase(), status = text(query.status).toUpperCase(), channel = text(query.channel).toUpperCase();
    return this.repository.coupons()
      .map(coupon => this.refresh(coupon))
      .filter(coupon => (!status || coupon.status === status) && (!channel || (coupon.channels || []).includes(channel)) && (!search || [coupon.name, coupon.code].some(value => text(value).toLowerCase().includes(search))))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  create(input, actor) {
    const name = text(input.name);
    if (!name) this.fail("VALIDATION_ERROR", "Coupon name is required");
    const codeMode = text(input.codeMode || "SHARED").toUpperCase();
    if (!CODE_MODES.includes(codeMode)) this.fail("VALIDATION_ERROR", "Code mode must be SHARED or UNIQUE");
    const rule = this.validateRule(input);
    const channels = this.channelList(input.channels);
    this.assertScopeChannels(rule.scope, channels);
    const startsAt = this.day(input.startsAt, "Start date") || this.today();
    const endsAt = this.day(input.endsAt, "End date");
    if (endsAt && endsAt < startsAt) this.fail("VALIDATION_ERROR", "End date cannot be before the start date");
    const status = text(input.status || "DRAFT").toUpperCase();
    if (!["DRAFT", "ACTIVE"].includes(status)) this.fail("VALIDATION_ERROR", "A new coupon can only be DRAFT or ACTIVE");
    // For UNIQUE the quota IS the number of vouchers printed, so a separate number would be a second
    // source of truth that could disagree with the codes actually in circulation.
    const totalQuota = codeMode === "SHARED" ? this.nonNegativeInteger(input.totalQuota, "Total quota") : 0;
    // A shared code with no per-member limit is one member's licence to use it forever, which is
    // rarely what a promotion means; one per member is the safe default the operator can raise.
    // A unique voucher is already one-use by construction, so it defaults to unlimited.
    const perMemberLimit = this.nonNegativeInteger(input.perMemberLimit, "Per-member limit", codeMode === "SHARED" ? 1 : 0);
    const code = codeMode === "SHARED" ? (this.normalizeCode(input.code) || this.generateCode()) : null;
    if (code) {
      if (code.length < 4) this.fail("VALIDATION_ERROR", "A shared code must be at least 4 characters");
      if (this.codeTaken(code)) this.fail("COUPON_CODE_EXISTS", "That coupon code is already in use");
    }
    const now = this.stamp();
    const coupon = { id: crypto.randomUUID(), name, codeMode, code, ...rule, channels, minSpendSatang: this.nonNegativeInteger(input.minSpendSatang, "Minimum spend"), startsAt, endsAt, totalQuota, perMemberLimit, usedCount: 0, reservedCount: 0, status, createdAt: now, createdBy: actor, updatedAt: now, updatedBy: actor, version: 1 };
    this.repository.saveCoupon(coupon);
    this.audit("COUPON_CREATED", actor, { couponId: coupon.id, name: coupon.name, codeMode, channels });
    const codeCount = this.nonNegativeInteger(input.codeCount, "Voucher count");
    if (codeMode === "UNIQUE" && codeCount) this.generateCodes(coupon.id, codeCount, actor);
    return coupon;
  }

  update(id, input, actor) {
    const coupon = this.get(id);
    const redeemed = this.repository.redemptionsForCoupon(id).some(entry => entry.status !== RELEASED);
    if (input.codeMode !== undefined && text(input.codeMode).toUpperCase() !== coupon.codeMode) this.fail("COUPON_IMMUTABLE", "Code mode cannot be changed after creation");
    if (input.code !== undefined && this.normalizeCode(input.code) !== (coupon.code || "")) this.fail("COUPON_IMMUTABLE", "The coupon code cannot be changed after creation");
    if (redeemed) for (const field of LOCKED_AFTER_REDEMPTION) if (input[field] !== undefined && input[field] !== coupon[field]) this.fail("COUPON_IMMUTABLE", "A coupon that has been redeemed can no longer change its discount or scope");
    const rule = redeemed ? { discountType: coupon.discountType, discountValue: coupon.discountValue, maxDiscountSatang: coupon.maxDiscountSatang, scope: coupon.scope } : this.validateRule(input, coupon);
    const channels = input.channels === undefined ? coupon.channels : this.channelList(input.channels);
    this.assertScopeChannels(rule.scope, channels);
    const startsAt = input.startsAt === undefined ? coupon.startsAt : (this.day(input.startsAt, "Start date") || coupon.startsAt);
    const endsAt = input.endsAt === undefined ? coupon.endsAt : this.day(input.endsAt, "End date");
    if (endsAt && endsAt < startsAt) this.fail("VALIDATION_ERROR", "End date cannot be before the start date");
    if (input.name !== undefined && !text(input.name)) this.fail("VALIDATION_ERROR", "Coupon name is required");
    const before = { ...coupon };
    Object.assign(coupon, rule, {
      name: input.name === undefined ? coupon.name : text(input.name),
      channels, startsAt, endsAt,
      minSpendSatang: input.minSpendSatang === undefined ? coupon.minSpendSatang : this.nonNegativeInteger(input.minSpendSatang, "Minimum spend"),
      totalQuota: input.totalQuota === undefined || coupon.codeMode === "UNIQUE" ? coupon.totalQuota : this.nonNegativeInteger(input.totalQuota, "Total quota"),
      perMemberLimit: input.perMemberLimit === undefined ? coupon.perMemberLimit : this.nonNegativeInteger(input.perMemberLimit, "Per-member limit"),
      updatedAt: this.stamp(), updatedBy: actor, version: Number(coupon.version || 1) + 1
    });
    this.repository.saveCoupon(coupon);
    this.audit("COUPON_UPDATED", actor, { couponId: coupon.id, before, after: coupon });
    return this.recount(coupon);
  }

  setStatus(id, status, actor) {
    const coupon = this.get(id), next = text(status).toUpperCase();
    if (!STATUSES.includes(next)) this.fail("VALIDATION_ERROR", "Invalid coupon status");
    if (next === coupon.status) return coupon;
    // DEPLETED is a fact about the ledger, not a decision — the service sets and clears it itself.
    if (next === "DEPLETED") this.fail("VALIDATION_ERROR", "DEPLETED is set automatically when the quota runs out");
    if (!(ALLOWED_STATUS_CHANGES[coupon.status] || []).includes(next)) this.fail("COUPON_STATUS_CONFLICT", `A ${coupon.status} coupon cannot become ${next}`);
    if (next === "ACTIVE" && coupon.status === "DEPLETED" && this.remainingQuota(coupon) === 0) this.fail("COUPON_DEPLETED", "Raise the quota or add vouchers before reactivating this coupon");
    const from = coupon.status;
    Object.assign(coupon, { status: next, updatedAt: this.stamp(), updatedBy: actor, version: Number(coupon.version || 1) + 1 });
    this.repository.saveCoupon(coupon);
    this.audit("COUPON_STATUS_CHANGED", actor, { couponId: coupon.id, from, to: next });
    return coupon;
  }

  // ---- voucher batches ---------------------------------------------------------------------
  // Codes are only ever added, never regenerated into an existing batch, so a reprint cannot
  // silently duplicate a code that is already in a customer's hand.
  generateCodes(id, count, actor) {
    const coupon = this.get(id);
    if (coupon.codeMode !== "UNIQUE") this.fail("VALIDATION_ERROR", "Only a unique-code coupon has voucher batches");
    const size = Number(count);
    if (!Number.isInteger(size) || size <= 0) this.fail("VALIDATION_ERROR", "Voucher count must be a positive integer");
    if (size > MAX_BATCH_SIZE) this.fail("VALIDATION_ERROR", `A batch cannot exceed ${MAX_BATCH_SIZE} vouchers`);
    const now = this.stamp(), taken = new Set(), codes = [];
    for (let index = 0; index < size; index += 1) {
      const code = this.generateCode(taken);
      taken.add(code);
      codes.push({ id: crypto.randomUUID(), couponId: coupon.id, code, status: UNUSED, redemptionId: null, createdAt: now, createdBy: actor });
    }
    this.repository.addCodes(codes);
    this.audit("COUPON_CODES_GENERATED", actor, { couponId: coupon.id, count: size });
    this.recount(coupon);
    return codes;
  }

  // ---- quota and counters ------------------------------------------------------------------
  // `null` means unlimited. The ledger is authoritative; the counters on the coupon are a cache.
  remainingQuota(coupon) {
    if (coupon.codeMode === "UNIQUE") return this.repository.codesForCoupon(coupon.id).filter(entry => entry.status === UNUSED).length;
    if (!coupon.totalQuota) return null;
    const ledger = this.repository.redemptionsForCoupon(coupon.id);
    return Math.max(0, coupon.totalQuota - ledger.filter(entry => entry.status !== RELEASED).length);
  }

  recount(coupon) {
    const ledger = this.repository.redemptionsForCoupon(coupon.id);
    coupon.usedCount = ledger.filter(entry => entry.status === APPLIED).length;
    coupon.reservedCount = ledger.filter(entry => entry.status === RESERVED).length;
    const remaining = this.remainingQuota(coupon);
    if (remaining === 0 && coupon.status === "ACTIVE") coupon.status = "DEPLETED";
    else if (remaining !== 0 && coupon.status === "DEPLETED") coupon.status = "ACTIVE";
    this.repository.saveCoupon(coupon);
    return coupon;
  }

  // Expiry is a date passing, not an action anybody takes, so it is settled on read.
  refresh(coupon) {
    if (coupon.endsAt && coupon.endsAt < this.today() && !["EXPIRED", "DRAFT"].includes(coupon.status)) {
      coupon.status = "EXPIRED";
      coupon.updatedAt = this.stamp();
      this.repository.saveCoupon(coupon);
    }
    return coupon;
  }

  // ---- discount arithmetic -----------------------------------------------------------------
  // Reads a preview or a bill through the same breakdown fields, so a table bill and a walk-in bill
  // are measured identically. All integer satang, consistent with the rest of the billing code.
  scopeBaseSatang(rule, bill) {
    const source = bill && bill.breakdown && Number.isInteger(bill.breakdown.tableChargeSatang) ? bill.breakdown : (bill || {});
    const tableCharge = Math.max(0, Number(source.tableChargeSatang) || 0);
    const products = Math.max(0, Number(source.productSatang ?? source.foodAmountSatang) || 0);
    if (rule.scope === "TABLE_CHARGE") return tableCharge;
    if (rule.scope === "PRODUCTS") return products;
    return tableCharge + products;
  }

  calculateDiscountSatang(rule, baseSatang) {
    const base = Math.max(0, Math.round(Number(baseSatang) || 0));
    if (!base) return 0;
    // Percent rounds half-up, then is held under both its own ceiling and the base — a coupon can
    // never drive a line negative, whatever the ceiling says.
    if (rule.discountType === "PERCENT") return Math.min(Math.round(base * rule.discountValue / 100), Number(rule.maxDiscountSatang) || base, base);
    return Math.min(Math.round(Number(rule.discountValue) || 0), base);
  }

  // ---- eligibility -------------------------------------------------------------------------
  resolveCode(rawCode) {
    const code = this.normalizeCode(rawCode);
    if (!code) this.fail("VALIDATION_ERROR", "A coupon code is required");
    const couponCode = this.repository.findCodeByCode(code);
    if (couponCode) return { coupon: this.refresh(this.get(couponCode.couponId)), couponCode };
    const shared = this.repository.findSharedByCode(code);
    if (!shared) this.fail("COUPON_CODE_NOT_FOUND", "That coupon code was not found");
    return { coupon: this.refresh(shared), couponCode: null };
  }

  // Everything that can be known before there is a bill. The remaining two rules — minimum spend and
  // the mutual exclusion with point redemption — need figures that do not exist yet at this point,
  // and are checked in #apply.
  validate({ code, memberId, channel = "TABLE" }) {
    const { coupon, couponCode } = this.resolveCode(code);
    const wanted = text(channel).toUpperCase();
    if (!CHANNELS.includes(wanted)) this.fail("VALIDATION_ERROR", "Invalid channel");
    // Each dead end gets its own code: the cashier's next move differs — an expired coupon is over,
    // a depleted one might come back, a paused one is a decision somebody made upstairs.
    if (coupon.status === "EXPIRED") this.fail("COUPON_EXPIRED", "This coupon has expired");
    if (coupon.status === "DEPLETED") this.fail("COUPON_DEPLETED", "This coupon has been fully used");
    if (coupon.status !== "ACTIVE") this.fail("COUPON_NOT_ACTIVE", "This coupon is not active");
    const today = this.today();
    if (coupon.startsAt && today < coupon.startsAt) this.fail("COUPON_NOT_STARTED", "This coupon cannot be used yet");
    if (coupon.endsAt && today > coupon.endsAt) this.fail("COUPON_EXPIRED", "This coupon has expired");
    if (!(coupon.channels || []).includes(wanted)) this.fail("COUPON_CHANNEL_NOT_ALLOWED", wanted === "WALK_IN" ? "This coupon cannot be used on walk-in sales" : "This coupon cannot be used on table sales");
    if (couponCode && couponCode.status !== UNUSED) this.fail("COUPON_CODE_USED", couponCode.status === VOID ? "This voucher has been cancelled" : "This voucher has already been used");
    if (!couponCode && this.remainingQuota(coupon) === 0) this.fail("COUPON_DEPLETED", "This coupon has been fully used");
    // Members only, enforced here rather than in the dialog — the dialog disabling the field is a
    // usability aid, the same way permissions are checked in the service and not only in the menu.
    const member = memberId ? this.memberById(memberId) : null;
    if (!member) this.fail("COUPON_MEMBER_REQUIRED", "A coupon can only be used by a member");
    if (member.status !== "ACTIVE") this.fail("COUPON_MEMBER_REQUIRED", "This member is not active");
    if (coupon.perMemberLimit) {
      const used = this.repository.redemptionsForMember(coupon.id, member.id).filter(entry => entry.status !== RELEASED).length;
      if (used >= coupon.perMemberLimit) this.fail("COUPON_MEMBER_LIMIT", `This member has already used this coupon ${coupon.perMemberLimit} time(s)`);
    }
    return { coupon, couponCode, member, channel: wanted, rule: this.ruleSnapshot(coupon) };
  }

  // Frozen onto the redemption so a receipt reprinted months later still shows what was actually
  // given, the same reason rewardPolicySnapshot and pricingSnapshot exist.
  ruleSnapshot(coupon) { return { name: coupon.name, discountType: coupon.discountType, discountValue: coupon.discountValue, maxDiscountSatang: coupon.maxDiscountSatang, scope: coupon.scope, minSpendSatang: coupon.minSpendSatang, channels: [...(coupon.channels || [])] }; }

  // ---- the ledger --------------------------------------------------------------------------
  reservedForSession(tableSessionId) { return tableSessionId ? this.repository.findReservedBySession(tableSessionId) : null; }
  reservedForPosOrder(posOrderId) { return posOrderId ? this.repository.findReservedByPosOrder(posOrderId) : null; }

  // Claimed when the table is opened (or when a walk-in sale is rung up), not at payment: the quota
  // has to be held for the duration of play, or two staff can open two tables on the last remaining
  // voucher and both succeed.
  reserve({ code, memberId, channel = "TABLE", tableSessionId = null, posOrderId = null }, actor) {
    const wanted = text(channel).toUpperCase();
    if (wanted === "TABLE" && !tableSessionId) this.fail("VALIDATION_ERROR", "A table coupon needs a table session");
    if (wanted === "WALK_IN" && !posOrderId) this.fail("VALIDATION_ERROR", "A walk-in coupon needs a POS order");
    if (this.reservedForSession(tableSessionId) || this.reservedForPosOrder(posOrderId)) this.fail("COUPON_ALREADY_RESERVED", "This sale already has a coupon");
    const { coupon, couponCode, member, channel: resolved, rule } = this.validate({ code, memberId, channel: wanted });
    const now = this.stamp();
    const redemption = { id: crypto.randomUUID(), couponId: coupon.id, couponCodeId: couponCode?.id || null, code: couponCode?.code || coupon.code, memberId: member.id, channel: resolved, tableSessionId, posOrderId, billId: null, status: RESERVED, discountSatang: 0, scopeSnapshot: rule.scope, couponSnapshot: rule, reservedAt: now, reservedBy: actor, appliedAt: null, appliedBy: null, releasedAt: null, releasedBy: null, releaseReason: null };
    this.repository.saveRedemption(redemption);
    if (couponCode) { Object.assign(couponCode, { status: RESERVED, redemptionId: redemption.id }); this.repository.saveCode(couponCode); }
    this.recount(coupon);
    this.audit("COUPON_RESERVED", actor, { couponId: coupon.id, redemptionId: redemption.id, memberId: member.id, code: redemption.code, channel: resolved, tableSessionId, posOrderId });
    return redemption;
  }

  // Consumes the reservation against a real bill. A coupon that turns out not to qualify does NOT
  // block the sale: it is released, the bill goes through without it, and the caller is told plainly.
  // Blocking payment over a promotion is the wrong trade at a counter with a queue.
  apply(redemptionId, bill, actor) {
    const redemption = this.repository.findRedemption(redemptionId);
    if (!redemption) this.fail("COUPON_REDEMPTION_NOT_FOUND", "Coupon redemption not found");
    if (redemption.status !== RESERVED) this.fail("COUPON_REDEMPTION_CONFLICT", `This coupon is already ${redemption.status.toLowerCase()}`);
    // Symmetrical to the refusal on the points side: neither discount silently drops the other.
    if (bill?.redeemSelected) this.fail("COUPON_POINTS_CONFLICT", `Points cannot be redeemed on the same bill as coupon ${redemption.couponSnapshot.name}`);
    const rule = redemption.couponSnapshot;
    const base = this.scopeBaseSatang(rule, bill);
    if (rule.minSpendSatang && base < rule.minSpendSatang) return { redemption: this.release(redemption.id, "MIN_SPEND_NOT_MET", actor), discountSatang: 0, released: "MIN_SPEND_NOT_MET", baseSatang: base };
    const discountSatang = this.calculateDiscountSatang(rule, base);
    // Nothing left to discount — burning a voucher for ฿0 is worse than handing it back.
    if (!discountSatang) return { redemption: this.release(redemption.id, "NO_DISCOUNT_AVAILABLE", actor), discountSatang: 0, released: "NO_DISCOUNT_AVAILABLE", baseSatang: base };
    Object.assign(redemption, { status: APPLIED, billId: bill?.id || null, discountSatang, appliedAt: this.stamp(), appliedBy: actor });
    this.repository.saveRedemption(redemption);
    const couponCode = redemption.couponCodeId ? this.repository.findCodeById(redemption.couponCodeId) : null;
    if (couponCode) { couponCode.status = USED; this.repository.saveCode(couponCode); }
    this.recount(this.get(redemption.couponId));
    this.audit("COUPON_APPLIED", actor, { couponId: redemption.couponId, redemptionId: redemption.id, memberId: redemption.memberId, billId: redemption.billId, discountSatang });
    return { redemption, discountSatang, released: null, baseSatang: base };
  }

  // Returns the quota and, for a unique voucher, puts the code back in circulation. Reachable from
  // both RESERVED (table cancelled, coupon removed at checkout) and APPLIED (the bill was voided).
  release(redemptionId, reason, actor) {
    const redemption = this.repository.findRedemption(redemptionId);
    if (!redemption) this.fail("COUPON_REDEMPTION_NOT_FOUND", "Coupon redemption not found");
    if (redemption.status === RELEASED) return redemption;
    Object.assign(redemption, { status: RELEASED, discountSatang: 0, releasedAt: this.stamp(), releasedBy: actor, releaseReason: text(reason) || "RELEASED" });
    this.repository.saveRedemption(redemption);
    const couponCode = redemption.couponCodeId ? this.repository.findCodeById(redemption.couponCodeId) : null;
    if (couponCode) { Object.assign(couponCode, { status: UNUSED, redemptionId: null }); this.repository.saveCode(couponCode); }
    this.recount(this.get(redemption.couponId));
    this.audit("COUPON_RELEASED", actor, { couponId: redemption.couponId, redemptionId: redemption.id, memberId: redemption.memberId, reason: redemption.releaseReason });
    return redemption;
  }

  // ---- reporting ---------------------------------------------------------------------------
  redemptions(couponId, query = {}) {
    const status = text(query.status).toUpperCase(), memberId = text(query.memberId);
    return this.repository.redemptionsForCoupon(couponId)
      .filter(entry => (!status || entry.status === status) && (!memberId || entry.memberId === memberId))
      .sort((a, b) => String(b.reservedAt).localeCompare(String(a.reservedAt)));
  }

  usageSummary(couponId) {
    const coupon = this.get(couponId), ledger = this.repository.redemptionsForCoupon(couponId);
    const applied = ledger.filter(entry => entry.status === APPLIED);
    return {
      couponId,
      reserved: ledger.filter(entry => entry.status === RESERVED).length,
      applied: applied.length,
      released: ledger.filter(entry => entry.status === RELEASED).length,
      discountSatang: applied.reduce((sum, entry) => sum + Number(entry.discountSatang || 0), 0),
      members: new Set(applied.map(entry => entry.memberId)).size,
      remainingQuota: this.remainingQuota(coupon)
    };
  }
}

module.exports = { CouponService, CODE_ALPHABET, CODE_LENGTH, CODE_MODES, DISCOUNT_TYPES, SCOPES, CHANNELS, STATUSES, MAX_BATCH_SIZE };
