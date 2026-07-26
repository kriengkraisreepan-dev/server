class BillHistoryService {
  constructor(repository) { this.repository = repository; }
  normalizeStatus(value) { const status = String(value || "").trim().toLowerCase(); return ["paid", "void", "awaiting_payment"].includes(status) ? status : ""; }
  search(query = {}) {
    const receipt = String(query.receipt || "").trim().toLowerCase();
    const table = String(query.table || "").trim().toLowerCase();
    const status = this.normalizeStatus(query.status);
    const from = String(query.from || "").trim(); const to = String(query.to || "").trim();
    if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("Invalid from date");
    if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error("Invalid to date");
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1); const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize, 10) || 20));
    const filtered = this.repository.bills().filter(bill => {
      const number = String(bill.receiptNumber || bill.number || "").toLowerCase();
      const tableValues = [bill.tableId, bill.tableName, bill.tableCode].map(value => String(value || "").toLowerCase());
      const date = String(bill.createdAt || "").slice(0, 10);
      return (!receipt || number.includes(receipt)) && (!table || tableValues.some(value => value.includes(table))) && (!status || bill.status === status) && (!from || date >= from) && (!to || date <= to);
    }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const total = filtered.length; return { items: filtered.slice((page - 1) * pageSize, page * pageSize), pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }
  details(billId) { const bill = this.repository.findBill(billId); if (!bill) throw new Error("Bill not found"); return { bill, payments: this.repository.payments().filter(payment => payment.billId === bill.id), auditEvents: this.repository.auditForBill(bill.id) }; }
}
module.exports = { BillHistoryService };
