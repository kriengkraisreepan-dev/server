const { bahtToSatang, satangToBaht } = require("../domain/money");

const asBaht = satang => Number(satangToBaht(satang));
const isDrink = item => /drink|beverage|เครื่องดื่ม/i.test(String(item.categoryName || item.category || item.categoryId || ""));

class CombinedBillingService {
  constructor({ sessionRepository, sessionService, posOrderRepository, billingRepository, billingService, inventoryService, getMember = () => null, getMemberName = () => "ลูกค้าทั่วไป", save }) {
    this.sessionRepository = sessionRepository;
    this.sessionService = sessionService;
    this.posOrderRepository = posOrderRepository;
    this.billingRepository = billingRepository;
    this.billingService = billingService;
    this.inventoryService = inventoryService;
    this.getMember = getMember;
    this.getMemberName = getMemberName;
    this.save = save;
  }

  requireActiveSession(sessionId) {
    const session = this.sessionRepository.findSession(sessionId);
    if (!session || !["ACTIVE", "PAUSED"].includes(session.state)) throw new Error("Session is not available for billing");
    const table = this.sessionRepository.findTable(session.tableId);
    if (!table) throw new Error("Table not found");
    if (this.billingRepository.bills().some(bill => bill.tableSessionId === session.id && bill.status !== "void")) {
      const error = new Error("This table session already has a bill"); error.code = "DUPLICATE_BILL"; throw error;
    }
    return { session, table };
  }

  ordersForSession(session) {
    return this.posOrderRepository.list().filter(order => order.status === "CONFIRMED" && order.billingStatus === "UNBILLED" && String(order.tableId) === String(session.tableId) && order.tableSessionId === session.id);
  }

  itemSnapshot(orders) {
    return orders.flatMap(order => (order.items || []).map(item => ({
      id: item.id,
      productId: item.productId,
      sku: item.sku || "",
      name: item.name,
      categoryId: item.categoryId || "",
      categoryName: item.categoryName || "",
      quantity: Number(item.quantity),
      price: Number(item.unitPrice),
      total: Number(item.lineSubtotal),
      priceSatang: bahtToSatang(item.unitPrice),
      totalSatang: bahtToSatang(item.lineSubtotal),
      posOrderId: order.id,
      posOrderNumber: order.orderNumber
    })));
  }

  buildPreview(sessionId, { manualDiscountSatang = 0 } = {}) {
    const { session, table } = this.requireActiveSession(sessionId);
    const requestedDiscountSatang = Math.round(Number(manualDiscountSatang) || 0);
    if (requestedDiscountSatang < 0) { const error = new Error("Discount amount must not be negative"); error.code = "INVALID_DISCOUNT_AMOUNT"; throw error; }
    const orders = this.ordersForSession(session);
    const items = this.itemSnapshot(orders);
    const rawTableChargeSatang = this.sessionService.previewCharge(session.id);
    const discountSatang = Math.min(requestedDiscountSatang, rawTableChargeSatang);
    const tableChargeSatang = rawTableChargeSatang - discountSatang;
    const productSatang = items.reduce((sum, item) => sum + item.totalSatang, 0);
    const drinkSatang = items.filter(isDrink).reduce((sum, item) => sum + item.totalSatang, 0);
    const foodSatang = productSatang - drinkSatang;
    const totalSatang = Math.ceil((tableChargeSatang + productSatang) / 100) * 100;
    return {
      tableSessionId: session.id,
      tableId: table.id,
      tableName: table.name,
      memberId: table.memberId || null,
      playDurationSeconds: this.sessionService.billableSeconds(session),
      posOrders: orders.map(order => ({ id: order.id, orderNumber: order.orderNumber, total: order.total })),
      items,
      breakdown: {
        tableCharge: asBaht(tableChargeSatang), tableChargeBeforeDiscount: asBaht(rawTableChargeSatang), food: asBaht(foodSatang), drink: asBaht(drinkSatang), products: asBaht(productSatang), discount: asBaht(discountSatang),
        total: asBaht(totalSatang), tableChargeSatang, rawTableChargeSatang, foodSatang, drinkSatang, productSatang, totalSatang
      }
    };
  }

  createBill(sessionId, actorId = "SYSTEM", { manualDiscountSatang = 0, discountReason = "" } = {}) {
    const preview = this.buildPreview(sessionId, { manualDiscountSatang });
    const beforeOrders = preview.posOrders.map(({ id }) => {
      const order = this.posOrderRepository.findById(id);
      return { order, billingStatus: order.billingStatus, billedBillId: order.billedBillId, billedAt: order.billedAt, billedBy: order.billedBy };
    });
    const closedSession = this.sessionService.awaitPaymentSession(sessionId);
    try {
      const table = this.sessionRepository.findTable(closedSession.tableId);
      const bill = this.billingService.createBillDraft({
        table,
        session: closedSession,
        memberName: this.getMemberName(table.memberId), memberCode: this.getMember(table.memberId)?.memberCode || this.getMember(table.memberId)?.code || null,
        actorId,
        extraItems: preview.items,
        tableSessionId: closedSession.id,
        posOrderIds: preview.posOrders.map(order => order.id),
        breakdown: preview.breakdown,
        discountReason: preview.breakdown.discount > 0 ? String(discountReason || "").trim() : "",
        saleSource: "TABLE"
      });
      for (const entry of beforeOrders) Object.assign(entry.order, { billingStatus: "BILLED", billedBillId: bill.id, billedAt: bill.createdAt, billedBy: actorId });
      this.posOrderRepository.persist();
      this.billingService.audit("COMBINED_BILL_CREATED", { tableId: table.id, sessionId: closedSession.id, billId: bill.id, actorId, data: { posOrderIds: bill.posOrderIds, breakdown: bill.breakdown } });
      return { bill, preview };
    } catch (error) {
      for (const entry of beforeOrders) Object.assign(entry.order, { billingStatus: entry.billingStatus, billedBillId: entry.billedBillId, billedAt: entry.billedAt, billedBy: entry.billedBy });
      // The session write occurs first. Restore its pre-billing state before exposing any failure.
      Object.assign(closedSession, { state: "ACTIVE", closedAt: null, finalChargeSatang: null, billableSeconds: undefined });
      this.sessionRepository.saveSession(closedSession);
      this.save();
      throw error;
    }
  }

  requireWalkInOrder(orderId) {
    const order = this.posOrderRepository.findById(orderId);
    if (!order) { const error = new Error("POS order not found"); error.code = "ORDER_NOT_FOUND"; throw error; }
    if (order.orderType !== "WALK_IN") { const error = new Error("Only walk-in orders can use this billing flow"); error.code = "INVALID_SALE_SOURCE"; throw error; }
    if (order.status !== "CONFIRMED") { const error = new Error("Walk-in order must be confirmed before billing"); error.code = "ORDER_STATUS_CONFLICT"; throw error; }
    if (order.billingStatus !== "UNBILLED") { const error = new Error("This walk-in order already has a bill"); error.code = "ORDER_ALREADY_BILLED"; error.details = { billId: order.billedBillId || null }; throw error; }
    return order;
  }

  previewWalkInBilling(orderId) {
    const order = this.requireWalkInOrder(orderId);
    const items = this.itemSnapshot([order]);
    const totalSatang = items.reduce((sum, item) => sum + item.totalSatang, 0);
    return { orderId: order.id, orderNumber: order.orderNumber, memberId: order.memberId || null, saleSource: "WALK_IN", items, subtotal: asBaht(totalSatang), discountAmount: 0, total: asBaht(totalSatang), subtotalSatang: totalSatang, totalSatang, paymentRequired: true };
  }

  createWalkInBill(orderId, actorId = "SYSTEM") {
    const preview = this.previewWalkInBilling(orderId), order = this.posOrderRepository.findById(orderId);
    const now = new Date().toISOString();
    const bill = this.billingService.createBillDraft({
      table: { id: null, name: "ขายหน้าร้าน", memberId: order.memberId || null, items: [] },
      session: { id: null, openedAt: null, closedAt: now, billableSeconds: 0, finalChargeSatang: 0, pricingSnapshot: null },
      memberName: order.memberName || "ลูกค้าทั่วไป", memberCode: order.memberCode || null, actorId, extraItems: preview.items, tableSessionId: null, posOrderIds: [order.id], saleSource: "WALK_IN",
      breakdown: { tableCharge: 0, food: preview.total, drink: 0, products: preview.total, discount: 0, total: preview.total, tableChargeSatang: 0, foodSatang: preview.totalSatang, drinkSatang: 0, productSatang: preview.totalSatang, totalSatang: preview.totalSatang }
    });
    Object.assign(order, { billingStatus: "BILLED", billedBillId: bill.id, billedAt: bill.createdAt, billedBy: actorId });
    this.posOrderRepository.persist();
    this.billingService.audit("WALK_IN_BILL_CREATED", { billId: bill.id, actorId, data: { orderId: order.id, orderNumber: order.orderNumber, totalSatang: bill.totalSatang } });
    return { bill, order, preview };
  }

  voidCombinedBill(bill, actorId) {
    if (!Array.isArray(bill.posOrderIds) || !bill.posOrderIds.length) return [];
    const restored = [];
    for (const id of bill.posOrderIds) {
      const order = this.posOrderRepository.findById(id);
      if (!order || order.billingStatus !== "BILLED" || order.billedBillId !== bill.id) continue;
      this.inventoryService.restoreStockForCancelledSale(order.items, { referenceId: order.id, actorId, reason: `Void combined bill ${bill.receiptNumber || bill.number}`, persist: false });
      order.status = "CANCELLED";
      order.billingStatus = "VOIDED";
      order.voidedBillId = bill.id;
      order.voidedAt = new Date().toISOString();
      order.voidedBy = actorId;
      restored.push(order.id);
    }
    if (restored.length) this.posOrderRepository.persist();
    return restored;
  }
}

module.exports = { CombinedBillingService };
