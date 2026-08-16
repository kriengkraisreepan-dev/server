const assert = require("assert");
const { JsonSessionRepository } = require("../repositories/json-session-repository");
const { JsonBillingRepository } = require("../repositories/json-billing-repository");
const { JsonPosOrderRepository } = require("../repositories/json-pos-order-repository");
const { JsonMemberRepository } = require("../repositories/json-member-repository");
const { TableSessionService } = require("../services/table-session-service");
const { BillingService } = require("../services/billing-service");
const { CombinedBillingService } = require("../services/combined-billing-service");
const { MemberService } = require("../services/member-service");
const { normalizeSettings } = require("../services/settings-service");

// "ส่วนลด" (manual discount) and member point redemption must both come out of the table charge
// only, never the products/food total, so reports (tableCharge + products == total) stay accurate.

function newRig() {
  const now = new Date("2026-08-09T12:00:00.000Z");
  const store = {
    tables: [{ id: 1, name: "Table 1", status: "playing", items: [] }],
    tableSessions: [{ id: "session-1", tableId: 1, state: "ACTIVE", openedAt: "2026-08-09T11:00:00.000Z", pausedAt: null, pausedSeconds: 0, pricingSnapshot: { id: "standard", name: "Standard", unit: "HOUR", rateSatang: 30000, minimumChargeSatang: 0, roundingRule: "UP_TO_BAHT", weekdayRules: [], timeRules: [] }, closedAt: null, finalChargeSatang: null }],
    posOrders: [{ id: "pos-1", orderNumber: "POS-1", orderType: "TABLE", tableId: 1, tableSessionId: "session-1", status: "CONFIRMED", billingStatus: "UNBILLED", total: 40, items: [{ id: "i-1", productId: "water", name: "Water", categoryName: "Drink", quantity: 2, unitPrice: 20, lineSubtotal: 40 }] }],
    bills: [], payments: [], auditLogs: [], members: [], memberPointTransactions: []
  };
  const save = () => {};
  const sessions = new JsonSessionRepository({ getStore: () => store, save });
  const bills = new JsonBillingRepository({ getStore: () => store, save });
  const orders = new JsonPosOrderRepository({ getStore: () => store, save });
  const sessionService = new TableSessionService(sessions, () => now);
  const billingService = new BillingService(bills, () => now);
  const inventory = { restoreStockForCancelledSale: () => [] };
  const combined = new CombinedBillingService({ sessionRepository: sessions, sessionService, posOrderRepository: orders, billingRepository: bills, billingService, inventoryService: inventory, save });
  const memberService = new MemberService(new JsonMemberRepository({ getStore: () => store, save }));
  const settings = normalizeSettings({ hourlyRate: 100, minimumCharge: 0, tableCount: 1 });
  return { store, combined, memberService, settings };
}

// Table charge preview is 300 baht (1hr @ 300/hr), products 40 baht -> total 340.
{
  const { combined } = newRig();
  const preview = combined.buildPreview("session-1", { manualDiscountSatang: 5000 }); // 50 baht discount
  assert.strictEqual(preview.breakdown.tableCharge, 250, "discount must reduce tableCharge, not products");
  assert.strictEqual(preview.breakdown.products, 40, "products must be untouched by the discount");
  assert.strictEqual(preview.breakdown.discount, 50);
  assert.strictEqual(preview.breakdown.total, 290, "total must be tableCharge(after discount) + products");
}

// Discount larger than the table charge must be capped at the table charge, never go negative.
{
  const { combined } = newRig();
  const preview = combined.buildPreview("session-1", { manualDiscountSatang: 999999 });
  assert.strictEqual(preview.breakdown.tableCharge, 0, "table charge must floor at zero");
  assert.strictEqual(preview.breakdown.discount, 300, "applied discount must be capped at the raw table charge");
  assert.strictEqual(preview.breakdown.total, 40, "total must equal products only once table charge is fully discounted");
}

// createBill persists the discount onto the bill and keeps tableCharge + products == total.
{
  const { combined } = newRig();
  const created = combined.createBill("session-1", "cashier-1", { manualDiscountSatang: 5000, discountReason: "โปรโมชั่นทดสอบ" });
  assert.strictEqual(created.bill.discount, 50);
  assert.strictEqual(created.bill.discountReason, "โปรโมชั่นทดสอบ");
  assert.strictEqual(created.bill.playAmount, 250, "playAmount on the persisted bill must already reflect the discount");
  assert.strictEqual(created.bill.foodAmount, 40, "foodAmount must be untouched");
  assert.strictEqual(created.bill.total, 290);
  assert.strictEqual(created.bill.playAmount + created.bill.foodAmount, created.bill.total, "tableCharge + products must always equal total — this is the whole point of the feature");
}

// Manual discount + member point redemption combined must still cap at the raw table charge, and
// point redemption must also come out of the table charge, not the product total.
{
  const { store, combined, memberService, settings } = newRig();
  const member = memberService.create({ memberCode: "MDISC", displayName: "Discount Member" }, "owner");
  member.points = 1000; // 1000 * pointValue(1) = 1000 baht worth, far more than the 300 baht table charge
  store.tables[0].memberId = member.id;
  const created = combined.createBill("session-1", "cashier-1", { manualDiscountSatang: 20000 }); // 200 baht manual discount, 100 baht of table charge left
  assert.strictEqual(created.bill.tableChargeSatang, 10000, "100 baht of table charge should remain after the manual discount");
  const max = memberService.calculateMaximumRedeem(member, created.bill, settings);
  assert.strictEqual(max.maximumPoints, 100, "max redeemable points must be capped by the REMAINING table charge (100 baht), not the whole bill total");
  memberService.selectRedeem(created.bill, 100, settings, "cashier-1");
  assert.strictEqual(created.bill.tableChargeSatang, 0, "table charge must be fully consumed");
  assert.strictEqual(created.bill.playAmount, 0);
  assert.strictEqual(created.bill.foodAmount, 40, "products must remain untouched by point redemption too");
  assert.strictEqual(created.bill.total, 40, "total must equal products only, table charge fully discounted by manual + points combined");
  assert.strictEqual(created.bill.discount, 300, "bill.discount must report the combined manual + point discount");
}

// Zero discount is a no-op and must match the pre-existing behaviour exactly (no regression).
{
  const { combined } = newRig();
  const preview = combined.buildPreview("session-1");
  assert.strictEqual(preview.breakdown.tableCharge, 300);
  assert.strictEqual(preview.breakdown.total, 340);
  assert.strictEqual(preview.breakdown.discount, 0);
}

console.log("Discount table-charge-only tests passed");
