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
    // A partial "pay for these orders now, keep playing" bill (see #createTableOrdersBill) does
    // NOT count toward this guard — only a full/final bill for the session does.
    if (this.billingRepository.bills().some(bill => bill.tableSessionId === session.id && bill.status !== "void" && !bill.partialOrdersOnly)) {
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
      // Unit cost is snapshotted onto the bill rather than looked up from the product at report
      // time, so editing a product's cost later never rewrites the profit of past sales. The POS
      // order item already captures unitCost (productSnapshot); it was simply being dropped here,
      // which left every bill with no cost basis. Field names match the ones already present on
      // pre-existing bills so historical and new bills report through the same path.
      cost: Number(item.unitCost || 0),
      costSatang: bahtToSatang(item.unitCost || 0),
      costTotal: Number(item.unitCost || 0) * Number(item.quantity),
      costTotalSatang: bahtToSatang(Number(item.unitCost || 0) * Number(item.quantity)),
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
    const { chargeSatang: rawTableChargeSatang, segments: rateSegments } = this.sessionService.previewBreakdown(session.id);
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
      rateSegments,
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

  // Reverts a bill that was successfully created but never got a valid payment attached (e.g. the
  // client's split-payment amounts didn't add up) — reopens the table session (mirrors createBill's
  // own internal revert-on-failure branch) so the table isn't left stuck in "awaiting payment" with
  // nothing to pay, un-bills its POS orders back to UNBILLED (not cancelled — nothing was ever
  // charged), and voids the orphaned bill record.
  reopenUnpaidBill(bill, actorId = "SYSTEM") {
    if (!bill || bill.status !== "awaiting_payment") return;
    const session = bill.tableSessionId ? this.sessionRepository.findSession(bill.tableSessionId) : null;
    if (session) {
      Object.assign(session, { state: "ACTIVE", closedAt: null, finalChargeSatang: null, billableSeconds: undefined });
      this.sessionRepository.saveSession(session);
    }
    if (Array.isArray(bill.posOrderIds) && bill.posOrderIds.length) {
      for (const id of bill.posOrderIds) {
        const order = this.posOrderRepository.findById(id);
        if (order && order.billedBillId === bill.id) Object.assign(order, { billingStatus: "UNBILLED", billedBillId: null, billedAt: null, billedBy: null });
      }
      this.posOrderRepository.persist();
    }
    this.billingService.voidBill(bill, "ไม่สามารถสร้างรายการชำระเงินได้ (เช่น ยอดแบ่งชำระไม่ถูกต้อง)", actorId);
  }

  // "Put these drinks back on the table's tab" is only meaningful while the tab they came from is
  // still open. It matches the SESSION, not just the table: once a table closes and reopens for the
  // next customer there IS an open session again, and moving the previous customer's drinks onto it
  // would bill the wrong person.
  canReturnOrdersToTab(bill) {
    if (!bill?.partialOrdersOnly || !bill.tableSessionId) return false;
    if (!Array.isArray(bill.posOrderIds) || !bill.posOrderIds.length) return false;
    const session = this.sessionRepository.findOpenSessionByTable(bill.tableId);
    return Boolean(session && session.id === bill.tableSessionId && ["ACTIVE", "PAUSED"].includes(session.state));
  }

  // Three outcomes, because voiding a bill says nothing on its own about where the goods went.
  // Each combination of (stock, money) is a different real situation:
  //   CANCEL_RESTORE_STOCK — the sale never happened; goods go back on the shelf, nothing charged.
  //   RETURN_TO_TAB        — goods were handed over and are still owed; un-bill them so the final
  //                          checkout picks them up. Stock stays deducted: it left the shelf.
  //   CANCEL_KEEP_STOCK    — goods were consumed but will not be charged (comp, waste, write-off).
  //                          Stock stays deducted, nothing collected.
  // Restoring stock for goods the customer actually drank is the one outcome that silently
  // corrupts inventory, which is why it is no longer the only option.
  voidCombinedBill(bill, actorId, voidMode = "CANCEL_RESTORE_STOCK") {
    if (!Array.isArray(bill.posOrderIds) || !bill.posOrderIds.length) return [];
    if (voidMode === "RETURN_TO_TAB" && !this.canReturnOrdersToTab(bill)) {
      const error = new Error("ไม่สามารถเอารายการกลับไปรวมบิลโต๊ะได้ เพราะโต๊ะปิดไปแล้วหรือเปิดให้ลูกค้ารายใหม่แล้ว");
      error.code = "TAB_NO_LONGER_OPEN";
      throw error;
    }
    const affected = [];
    for (const id of bill.posOrderIds) {
      const order = this.posOrderRepository.findById(id);
      if (!order || order.billingStatus !== "BILLED" || order.billedBillId !== bill.id) continue;
      if (voidMode === "RETURN_TO_TAB") {
        // Un-billed, not cancelled — the order is still a live sale, it just has no bill again.
        // Same shape as reopenUnpaidBill() above.
        Object.assign(order, { billingStatus: "UNBILLED", billedBillId: null, billedAt: null, billedBy: null });
      } else {
        if (voidMode !== "CANCEL_KEEP_STOCK") this.inventoryService.restoreStockForCancelledSale(order.items, { referenceId: order.id, actorId, reason: `Void combined bill ${bill.receiptNumber || bill.number}`, persist: false });
        order.status = "CANCELLED";
        order.billingStatus = "VOIDED";
        order.voidedBillId = bill.id;
        order.voidedAt = new Date().toISOString();
        order.voidedBy = actorId;
        order.stockRestored = voidMode !== "CANCEL_KEEP_STOCK";
      }
      affected.push(order.id);
    }
    if (affected.length) this.posOrderRepository.persist();
    return affected;
  }

  // "Pay for these drinks now, keep playing" — bills a subset of a table's confirmed, still-unbilled
  // orders immediately, leaving the table session (and its accruing time charge) completely
  // untouched. The eventual final checkout only sweeps up whatever is still UNBILLED at that point.
  previewTableOrdersBilling(tableId, orderIds) {
    const ids = Array.isArray(orderIds) ? orderIds.filter(Boolean) : [];
    if (!ids.length) { const error = new Error("No orders selected for billing"); error.code = "NO_ORDERS_SELECTED"; throw error; }
    const session = this.sessionRepository.findOpenSessionByTable(tableId);
    if (!session) { const error = new Error("Table has no active session"); error.code = "SESSION_NOT_ACTIVE"; throw error; }
    const orders = ids.map(orderId => {
      const order = this.posOrderRepository.findById(orderId);
      if (!order || order.status !== "CONFIRMED" || order.billingStatus !== "UNBILLED" || order.tableSessionId !== session.id || String(order.tableId) !== String(tableId)) {
        const error = new Error("One or more orders are not available for billing"); error.code = "ORDER_NOT_AVAILABLE"; throw error;
      }
      return order;
    });
    const items = this.itemSnapshot(orders);
    const productSatang = items.reduce((sum, item) => sum + item.totalSatang, 0);
    const drinkSatang = items.filter(isDrink).reduce((sum, item) => sum + item.totalSatang, 0);
    const foodSatang = productSatang - drinkSatang;
    return {
      tableId, tableSessionId: session.id, orderIds: orders.map(order => order.id), items,
      total: asBaht(productSatang), totalSatang: productSatang, foodSatang, drinkSatang, productSatang
    };
  }

  createTableOrdersBill(tableId, orderIds, actorId = "SYSTEM") {
    const preview = this.previewTableOrdersBilling(tableId, orderIds);
    const table = this.sessionRepository.findTable(tableId);
    const session = this.sessionRepository.findSession(preview.tableSessionId);
    const now = new Date().toISOString();
    const breakdown = {
      tableCharge: 0, tableChargeBeforeDiscount: 0, food: asBaht(preview.foodSatang), drink: asBaht(preview.drinkSatang), products: preview.total, discount: 0,
      total: preview.total, tableChargeSatang: 0, rawTableChargeSatang: 0, foodSatang: preview.foodSatang, drinkSatang: preview.drinkSatang, productSatang: preview.productSatang, totalSatang: preview.totalSatang
    };
    const bill = this.billingService.createBillDraft({
      table,
      // A synthetic, already-"closed" session snapshot with a zero time-charge — the real session
      // (openedAt/pricingSnapshot/etc.) is left completely untouched in the repository.
      session: { id: session.id, openedAt: session.openedAt, closedAt: now, billableSeconds: 0, finalChargeSatang: 0, pricingSnapshot: session.pricingSnapshot || null },
      memberName: this.getMemberName(table.memberId), memberCode: this.getMember(table.memberId)?.memberCode || this.getMember(table.memberId)?.code || null,
      actorId,
      extraItems: preview.items,
      tableSessionId: session.id,
      posOrderIds: preview.orderIds,
      breakdown,
      partialOrdersOnly: true,
      saleSource: "TABLE"
    });
    for (const orderId of preview.orderIds) {
      const order = this.posOrderRepository.findById(orderId);
      Object.assign(order, { billingStatus: "BILLED", billedBillId: bill.id, billedAt: bill.createdAt, billedBy: actorId });
    }
    this.posOrderRepository.persist();
    this.billingService.audit("TABLE_ORDERS_BILL_CREATED", { tableId, sessionId: session.id, billId: bill.id, actorId, data: { posOrderIds: bill.posOrderIds, totalSatang: bill.totalSatang } });
    return { bill, preview };
  }
}

module.exports = { CombinedBillingService };
