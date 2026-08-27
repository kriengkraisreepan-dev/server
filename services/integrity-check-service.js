// Bills, payments, POS orders, table sessions and the audit trail live in month files rather than
// in store.json (see infrastructure/history-store.js), so this check is given explicit suppliers
// for them. Live, they return the working set plus the recent months — the window where a
// consistency problem is still actionable — and a bill referenced from further back is resolved
// with a targeted lookup instead of by loading every bill ever taken. The backup dry-run passes a
// restored store object and no suppliers, and falls back to reading its arrays directly.
class IntegrityCheckService {
  constructor({ store, reservations = () => [], deposits = () => [], bills = null, auditLogs = null, findBill = null }) {
    this.store = store;
    this.reservations = reservations;
    this.deposits = deposits;
    this.billsSupplier = bills;
    this.auditLogsSupplier = auditLogs;
    this.findBill = findBill;
  }
  run() {
    const store = this.store(), reservations = this.reservations(), deposits = this.deposits();
    const bills = this.billsSupplier ? this.billsSupplier() : (store.bills || []);
    const auditLogs = this.auditLogsSupplier ? this.auditLogsSupplier() : (store.auditLogs || []);
    const issues = [];
    const add = (level, code, entityType, entityId, detail) => issues.push({ level, code, entityType, entityId, detail });
    const duplicate = (items, field, entityType, code) => {
      const seen = new Set();
      for (const item of items) {
        const value = item?.[field];
        if (value && seen.has(value)) add("ERROR", code, entityType, item.id || value, `${field}=${value}`);
        if (value) seen.add(value);
      }
    };
    const memberIds = new Set((store.members || []).map(item => item.id));
    const tableIds = new Set((store.tables || []).map(item => String(item.id)));
    const depositIds = new Set(deposits.map(item => item.id));
    const billIds = new Set(bills.map(item => item.id));
    for (const bill of bills) {
      if (bill.memberId && !memberIds.has(bill.memberId)) add("WARNING", "BILL_MEMBER_MISSING", "BILL", bill.id, bill.memberId);
      if (bill.depositId && !depositIds.has(bill.depositId)) add("ERROR", "BILL_DEPOSIT_MISSING", "BILL", bill.id, bill.depositId);
      if (bill.status === "paid" && Number.isInteger(bill.grossTotalSatang) && bill.grossTotalSatang !== Number(bill.depositAppliedSatang || 0) + Number(bill.remainingPaymentSatang || 0)) add("ERROR", "PAID_BILL_NOT_BALANCED", "BILL", bill.id, "gross != deposit + remaining");
    }
    for (const deposit of deposits) {
      if (deposit.status === "SETTLED" && (!deposit.settledBillId || !(billIds.has(deposit.settledBillId) || Boolean(this.findBill && this.findBill(deposit.settledBillId))))) add("ERROR", "SETTLED_DEPOSIT_BILL_MISSING", "DEPOSIT", deposit.id, deposit.settledBillId || "missing settledBillId");
      if (deposit.status === "AVAILABLE" && deposit.settledBillId) add("ERROR", "AVAILABLE_DEPOSIT_HAS_SETTLEMENT", "DEPOSIT", deposit.id, deposit.settledBillId);
      if (deposit.status === "FORFEITED" && !deposit.revenueRecognizedAt) add("ERROR", "FORFEITED_REVENUE_MISSING", "DEPOSIT", deposit.id, "revenueRecognizedAt missing");
    }
    for (const reservation of reservations) if (reservation.assignedTableId != null && !tableIds.has(String(reservation.assignedTableId))) add("ERROR", "RESERVATION_TABLE_MISSING", "RESERVATION", reservation.id, reservation.assignedTableId);
    const openByTable = new Map();
    for (const session of store.tableSessions || []) if (["ACTIVE","PAUSED","AWAITING_PAYMENT"].includes(session.state)) {
      const key = String(session.tableId);
      if (openByTable.has(key)) add("ERROR", "DUPLICATE_ACTIVE_TABLE_SESSION", "SESSION", session.id, key);
      openByTable.set(key, session.id);
    }
    duplicate(bills, "receiptNumber", "BILL", "DUPLICATE_RECEIPT_NUMBER");
    duplicate(bills, "number", "BILL", "DUPLICATE_BILL_NUMBER");
    duplicate(store.members || [], "memberCode", "MEMBER", "DUPLICATE_MEMBER_CODE");
    duplicate(deposits, "receiptNumber", "DEPOSIT", "DUPLICATE_DEPOSIT_RECEIPT");
    const idempotencyKeys=new Set();
    for(const event of auditLogs){const key=event.details?.idempotencyKey;if(key&&idempotencyKeys.has(key))add("ERROR","DUPLICATE_REVENUE_IDEMPOTENCY_KEY","AUDIT",event.id,key);if(key)idempotencyKeys.add(key);}
    for (const product of store.products || []) if (Number(product.stockQuantity) < 0) add("ERROR", "NEGATIVE_PRODUCT_STOCK", "PRODUCT", product.id, product.stockQuantity);
    const errors = issues.filter(item => item.level === "ERROR").length;
    const warnings = issues.filter(item => item.level === "WARNING").length;
    const depositTotals=deposits.reduce((totals,item)=>{totals.received+=Number(item.amountSatang||0);const key=String(item.status||"UNKNOWN").toLowerCase();totals[key]=(totals[key]||0)+Number(item.amountSatang||0);return totals;},{received:0,available:0,locked:0,settled:0,refunded:0,voided:0,forfeited:0});
    depositTotals.accounted=depositTotals.available+depositTotals.locked+depositTotals.settled+depositTotals.refunded+depositTotals.voided+depositTotals.forfeited;
    if(depositTotals.received!==depositTotals.accounted)add("ERROR","DEPOSIT_TOTALS_NOT_RECONCILED","DEPOSIT","ALL",`${depositTotals.received} != ${depositTotals.accounted}`);
    const finalErrors = issues.filter(item => item.level === "ERROR").length;
    return { status: finalErrors ? "ERROR" : warnings ? "WARNING" : "PASS", checkedAt: new Date().toISOString(), errors: finalErrors, warnings, financialReconciliation:{depositTotals}, issues };
  }
}

module.exports = { IntegrityCheckService };
