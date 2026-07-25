const crypto = require("crypto");
function categoryId(name) { return `legacy-category-${crypto.createHash("sha256").update(name).digest("hex").slice(0, 16)}`; }
function referenceOrNull(value, known) { return value && known.has(value) ? value : null; }
function importStore(db, store) {
  const now = new Date().toISOString(), counts = {};
  const insert = (table, sql, values) => { db.prepare(sql).run(...values); counts[table] = (counts[table] || 0) + 1; };
  const tableIds = new Set(store.tables.map(item => item.id)), memberIds = new Set(store.members.map(item => item.id)), productIds = new Set(store.products.map(item => item.id));
  Object.entries(store.settings).forEach(([key, value]) => insert("app_settings", "INSERT INTO app_settings VALUES (?, ?, ?)", [key, JSON.stringify(value), now]));
  store.members.forEach(member => insert("members", "INSERT INTO members VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [member.id, member.code, member.name, member.phone || null, member.points || 0, member.note || null, member.createdAt, 1]));
  const categories = [...new Set(store.products.map(product => String(product.category || "Uncategorized").trim() || "Uncategorized"))];
  categories.forEach(name => insert("product_categories", "INSERT INTO product_categories VALUES (?, ?, ?, ?)", [categoryId(name), name, 1, now]));
  store.products.forEach(product => { const name = String(product.category || "Uncategorized").trim() || "Uncategorized"; insert("products", "INSERT INTO products VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [product.id, categoryId(name), product.name, product.price, null, product.active ? 1 : 0, now, now]); });
  store.tables.forEach(table => insert("snooker_tables", "INSERT INTO snooker_tables VALUES (?, ?, ?, ?, ?)", [table.id, table.code, table.name, Number.isInteger(table.relay) ? table.relay : null, 1]));
  insert("rate_plans", "INSERT INTO rate_plans VALUES (?, ?, ?, ?, ?, ?)", ["legacy-default-rate", "Imported legacy default rate", store.settings.hourlyRate, store.settings.minimumCharge, "NONE", 1]);
  store.tables.filter(table => table.status === "playing").forEach(table => { const sessionId = `legacy-session-${table.id}`; insert("table_sessions", "INSERT INTO table_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [sessionId, table.id, referenceOrNull(table.memberId, memberIds), "legacy-default-rate", table.startTime, null, "OPEN", table.relayState || null, String(table.id)]); (table.items || []).forEach((item, index) => insert("session_items", "INSERT INTO session_items VALUES (?, ?, ?, ?, ?, ?)", [`${sessionId}:item:${index}`, sessionId, referenceOrNull(item.productId, productIds), item.name, item.price, item.quantity])); });
  store.bills.forEach(bill => { const status = bill.status === "paid" ? "PAID" : bill.status === "pending" ? "PENDING" : "VOID"; insert("sales", "INSERT INTO sales VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [bill.id, bill.number, referenceOrNull(bill.tableId, tableIds), referenceOrNull(bill.memberId, memberIds), bill.tableName || "Unknown table", bill.memberName || "General customer", bill.playStartedAt || null, bill.playEndedAt || bill.createdAt, bill.playDurationSeconds || 0, bill.playAmount || 0, bill.foodAmount || 0, 0, bill.total, status, bill.createdAt, bill.id]); (bill.items || []).forEach((item, index) => insert("sale_items", "INSERT INTO sale_items VALUES (?, ?, ?, ?, ?, ?, ?)", [`${bill.id}:item:${index}`, bill.id, referenceOrNull(item.productId, productIds), item.name, item.price, item.quantity, item.total])); });
  store.payments.forEach(payment => { const status = String(payment.status || "").toUpperCase(); const safeStatus = ["PENDING", "PAID", "VOID", "FAILED"].includes(status) ? status : "FAILED"; insert("payments", "INSERT INTO payments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [payment.id, payment.billId, "QR", payment.amount, safeStatus, payment.reference || null, payment.createdAt, payment.paidAt || null, payment.id]); });
  return counts;
}
module.exports = { importStore };
