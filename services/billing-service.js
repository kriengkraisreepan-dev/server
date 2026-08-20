const crypto = require("crypto");
const { bahtToSatang, satangToBaht, requireNonNegativeSatang } = require("../domain/money");

const apiBaht = satang => Number(satangToBaht(satang));
class BillingService {
  constructor(repository, clock = () => new Date()) { this.repository = repository; this.clock = clock; }
  now() { return this.clock().toISOString(); }
  audit(event, details = {}) { const actorId = String(details.actorId || details.userId || "SYSTEM").trim() || "UNKNOWN"; return this.repository.appendAudit({ id: crypto.randomUUID(), occurredAt: this.now(), event, tableId: details.tableId || null, sessionId: details.sessionId || null, billId: details.billId || null, paymentId: details.paymentId || null, actorId, userId: actorId, details: details.data || {} }); }
  createBillDraft({ table, session, memberName = "ลูกค้าทั่วไป", memberCode = null, actorId = "SYSTEM", extraItems = [], tableSessionId = null, posOrderIds = [], breakdown = null, discountReason = "", partialOrdersOnly = false, saleSource = "TABLE", rateSegments = null }) {
    if (!session?.finalChargeSatang && session?.finalChargeSatang !== 0) throw new Error("Session has no final charge");
    const legacyItems = (table.items || []).map(item => {
      const priceSatang = bahtToSatang(item.price); const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("Invalid bill item quantity");
      return { ...item, quantity, price: apiBaht(priceSatang), total: apiBaht(priceSatang * quantity), priceSatang, totalSatang: priceSatang * quantity };
    });
    const posItems = extraItems.map(item => {
      const quantity = Number(item.quantity), priceSatang = Number.isInteger(item.priceSatang) ? item.priceSatang : bahtToSatang(item.price);
      if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("Invalid POS bill item quantity");
      return { ...item, quantity, price: apiBaht(priceSatang), total: apiBaht(priceSatang * quantity), priceSatang, totalSatang: priceSatang * quantity };
    });
    const items = [...legacyItems, ...posItems];
    // breakdown.tableChargeSatang reflects any manual discount already applied by the caller
    // (CombinedBillingService#buildPreview) — session.finalChargeSatang never does, it's the raw
    // pricing-engine charge. Prefer the breakdown's number so the bill reflects the discount.
    const rawPlayAmountSatang = requireNonNegativeSatang(session.finalChargeSatang, "play amount");
    const playAmountSatang = Number.isInteger(breakdown?.tableChargeSatang) ? breakdown.tableChargeSatang : rawPlayAmountSatang;
    const foodAmountSatang = items.reduce((sum, item) => sum + item.totalSatang, 0);
    const totalSatang = Number.isInteger(breakdown?.totalSatang) ? breakdown.totalSatang : Math.ceil((playAmountSatang + foodAmountSatang) / 100) * 100;
    const discount = Number(breakdown?.discount || 0);
    const createdAt = session.closedAt || this.now();
    const receiptNumber = this.repository.nextReceiptNumber(createdAt);
    const bill = { id: crypto.randomUUID(), number: receiptNumber, receiptNumber, createdAt, tableId: table.id, tableName: table.name, memberId: table.memberId || null, memberName, memberCode, playStartedAt: session.openedAt, playEndedAt: session.closedAt, playDurationSeconds: session.billableSeconds, playAmount: apiBaht(playAmountSatang), foodAmount: apiBaht(foodAmountSatang), total: apiBaht(totalSatang), playAmountSatang, tableChargeSatang: playAmountSatang, foodAmountSatang, totalSatang, discount, discountReason: discount > 0 ? String(discountReason || "").trim() : "", pricingSnapshot: session.pricingSnapshot || null, rateSegments: rateSegments || session.rateSegments || null, paymentMethod: null, status: "awaiting_payment", items, tableSessionId: tableSessionId || session.id || null, posOrderIds: [...posOrderIds], saleSource: ["TABLE", "WALK_IN", "LEGACY"].includes(saleSource) ? saleSource : "LEGACY", partialOrdersOnly: Boolean(partialOrdersOnly), breakdown: breakdown || { tableCharge: apiBaht(playAmountSatang), products: apiBaht(foodAmountSatang), food: apiBaht(foodAmountSatang), drink: 0, discount: 0, total: apiBaht(totalSatang), tableChargeSatang: playAmountSatang, productSatang: foodAmountSatang, totalSatang } };
    this.repository.saveBill(bill); this.audit("BILL_DRAFT_CREATED", { tableId: table.id, sessionId: session.id, billId: bill.id, actorId, data: { receiptNumber, totalSatang } }); return bill;
  }
  markPaid(bill) { if (!["awaiting_payment", "pending"].includes(bill.status)) throw new Error("Bill is not awaiting payment"); bill.status = "paid"; bill.paidAt = this.now(); this.repository.saveBill(bill); return bill; }
  // voidMode records what was decided about the bill's goods — restocked, moved back onto the
  // table's tab, or written off. It is on the bill (and in the audit event) so reporting can tell
  // an honest mistake apart from a comp instead of seeing one undifferentiated "void" pile.
  voidBill(bill, reason = "", actorId = "SYSTEM", voidMode = "CANCEL_RESTORE_STOCK") { if (!bill || bill.status === "void") throw new Error("Bill cannot be voided"); const voidReason = String(reason || "").trim(); if (!voidReason) throw new Error("Void reason is required"); bill.status = "void"; bill.voidedAt = this.now(); bill.voidReason = voidReason; bill.voidMode = voidMode; bill.voidedBy = String(actorId || "UNKNOWN").trim() || "UNKNOWN"; bill.originalReceiptNumber = bill.receiptNumber || bill.number; this.repository.saveBill(bill); this.audit("BILL_VOIDED", { tableId: bill.tableId, billId: bill.id, actorId: bill.voidedBy, data: { reason: bill.voidReason, voidMode, receiptNumber: bill.originalReceiptNumber } }); return bill; }
}
module.exports = { BillingService };
