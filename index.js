const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { JsonSettingsRepository } = require("./repositories/json-settings-repository");
const { JsonSessionRepository } = require("./repositories/json-session-repository");
const { SettingsService } = require("./services/settings-service");
const { TableSessionService } = require("./services/table-session-service");
const { JsonBillingRepository } = require("./repositories/json-billing-repository");
const { BillingService } = require("./services/billing-service");
const { PaymentService } = require("./services/payment-service");
const { BillHistoryService } = require("./services/bill-history-service");
const { bahtToSatang, satangToBaht } = require("./domain/money");

const app = express();
const PORT = process.env.PORT || 3000;
const dataDir = path.join(__dirname, "data");
const dataFile = path.join(dataDir, "store.json");
const backupsDir = path.join(dataDir, "backups");
const MAX_BACKUPS = 30;
const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

function seed() {
  return { settings: { shopName: "88 Snooker Club", hourlyRate: 100, minimumCharge: 50, tableCount: 3, promptPayId: "" }, tables: Array.from({ length: 3 }, (_, i) => ({ id: i + 1, code: `T${String(i + 1).padStart(2, "0")}`, name: `โต๊ะ ${i + 1}`, relay: i + 1, status: "free", memberId: null, startTime: null, items: [] })), members: [], products: [{ id: "p-water", name: "น้ำดื่ม", price: 15, category: "เครื่องดื่ม", active: true }, { id: "p-cola", name: "โค้ก", price: 25, category: "เครื่องดื่ม", active: true }, { id: "p-noodle", name: "มาม่า", price: 35, category: "อาหาร", active: true }], bills: [], payments: [] };
}
function load() { try { return JSON.parse(fs.readFileSync(dataFile, "utf8")); } catch { const value = seed(); fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(dataFile, JSON.stringify(value, null, 2)); return value; } }
let store = load();
function save() { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(dataFile, JSON.stringify(store, null, 2)); maybeAutoBackup(); }
const settingsRepository = new JsonSettingsRepository({ getStore: () => store, save });
const settingsService = new SettingsService(settingsRepository);
const sessionRepository = new JsonSessionRepository({ getStore: () => store, save });
const sessionService = new TableSessionService(sessionRepository);
const billingRepository = new JsonBillingRepository({ getStore: () => store, save });
const billingService = new BillingService(billingRepository);
const paymentService = new PaymentService(billingRepository, billingService);
const billHistoryService = new BillHistoryService(billingRepository);
function safeBackupName(name) { const base = path.basename(String(name || "")); return /^backup-[\dTZ.-]+\.json$/.test(base) ? base : null; }
function listBackups() {
  fs.mkdirSync(backupsDir, { recursive: true });
  return fs.readdirSync(backupsDir).filter(f => f.endsWith(".json")).map(file => { const stat = fs.statSync(path.join(backupsDir, file)); return { file, size: stat.size, createdAt: stat.mtime.toISOString() }; }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
function pruneBackups() { const list = listBackups(); list.slice(MAX_BACKUPS).forEach(b => fs.unlinkSync(path.join(backupsDir, b.file))); }
function backupNow() {
  fs.mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `backup-${stamp}.json`;
  fs.copyFileSync(dataFile, path.join(backupsDir, file));
  pruneBackups();
  return { file, createdAt: new Date().toISOString() };
}
function maybeAutoBackup() {
  const list = listBackups();
  const latest = list[0];
  if (!latest || Date.now() - new Date(latest.createdAt).getTime() > AUTO_BACKUP_INTERVAL_MS) backupNow();
}
function id(prefix) { return `${prefix}-${crypto.randomUUID().slice(0, 8)}`; }
function tableById(tableId) { return store.tables.find(t => String(t.id) === String(tableId)); }
function memberById(memberId) { return store.members.find(m => m.id === memberId); }
function elapsedSeconds(table) { return table.startTime ? Math.max(0, Math.floor((Date.now() - new Date(table.startTime).getTime()) / 1000)) : 0; }
function legacyTableChargeSatang(table) { return bahtToSatang(Math.max(store.settings.minimumCharge, elapsedSeconds(table) / 3600 * store.settings.hourlyRate)); }
function tableChargeSatang(table) { const session = sessionRepository.findSessionByTable(table.id); return session ? sessionService.previewCharge(session.id) : legacyTableChargeSatang(table); }
function apiBaht(satang) { return Number(satangToBaht(satang)); }
function enrichTable(table) { const session = sessionRepository.findSessionByTable(table.id); const active = table.status === "playing" || table.status === "paused" || table.status === "awaiting_payment"; return { ...table, elapsedSeconds: session ? sessionService.billableSeconds(session) : elapsedSeconds(table), currentPrice: active ? apiBaht(tableChargeSatang(table)) : 0, member: memberById(table.memberId) || null, sessionState: session?.state || null }; }
function createBill(table, closedSession) { return billingService.createBillDraft({ table, session: closedSession, memberName: memberById(table.memberId)?.name || "ลูกค้าทั่วไป" }); }
async function setRelayState(table, state) { table.relayState = state; const base = process.env.ESP32_BASE_URL; if (!base) return { connected: false }; try { await fetch(`${base.replace(/\/$/, "")}/relay/${table.relay}?state=${state}`, { signal: AbortSignal.timeout(3000) }); return { connected: true }; } catch { return { connected: false, failed: true }; } }

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.get("/api/state", (req, res) => res.json({ settings: settingsService.getSettings(), tables: store.tables.map(enrichTable), members: store.members, products: store.products, bills: store.bills, payments: store.payments, auditLogs: store.auditLogs || [] }));
app.get("/api/bills", (req, res) => { try { res.json(billHistoryService.search(req.query)); } catch (error) { res.status(400).json({ error: error.message }); } });
app.get("/api/bills/:id", (req, res) => { try { res.json(billHistoryService.details(req.params.id)); } catch (error) { res.status(error.message === "Bill not found" ? 404 : 400).json({ error: error.message }); } });
app.put("/api/settings", (req, res) => { try { res.json(settingsService.updateSettings(req.body)); } catch (error) { res.status(400).json({ error: error.message }); } });
app.get("/api/backups", (req, res) => res.json(listBackups()));
app.post("/api/backups", (req, res) => res.status(201).json(backupNow()));
app.get("/api/backups/:file/download", (req, res) => { const file = safeBackupName(req.params.file); if (!file) return res.status(400).json({ error: "ชื่อไฟล์ไม่ถูกต้อง" }); const full = path.join(backupsDir, file); if (!fs.existsSync(full)) return res.status(404).json({ error: "ไม่พบไฟล์สำรองข้อมูล" }); res.download(full, file); });
app.post("/api/backups/:file/restore", (req, res) => { const file = safeBackupName(req.params.file); if (!file) return res.status(400).json({ error: "ชื่อไฟล์ไม่ถูกต้อง" }); const full = path.join(backupsDir, file); if (!fs.existsSync(full)) return res.status(404).json({ error: "ไม่พบไฟล์สำรองข้อมูล" }); let restored; try { restored = JSON.parse(fs.readFileSync(full, "utf8")); } catch { return res.status(400).json({ error: "ไฟล์สำรองข้อมูลเสียหาย" }); } backupNow(); store = restored; save(); res.json({ message: `กู้คืนข้อมูลจาก ${file} แล้ว (ระบบสำรองข้อมูลก่อนกู้คืนไว้ให้อัตโนมัติ)` }); });
app.delete("/api/backups/:file", (req, res) => { const file = safeBackupName(req.params.file); if (!file) return res.status(400).json({ error: "ชื่อไฟล์ไม่ถูกต้อง" }); const full = path.join(backupsDir, file); if (!fs.existsSync(full)) return res.status(404).json({ error: "ไม่พบไฟล์สำรองข้อมูล" }); fs.unlinkSync(full); res.json({ message: `ลบไฟล์สำรองข้อมูล ${file} แล้ว` }); });
app.post("/api/members", (req, res) => { const { name, phone = "", points = 0, note = "" } = req.body; if (!name?.trim()) return res.status(400).json({ error: "กรุณาระบุชื่อสมาชิก" }); const member = { id: id("MEM"), code: `M${String(store.members.length + 1).padStart(4, "0")}`, name: name.trim(), phone, points: Number(points) || 0, note, createdAt: new Date().toISOString() }; store.members.unshift(member); save(); res.status(201).json(member); });
app.post("/api/products", (req, res) => { const { name, price, category = "อื่น ๆ" } = req.body; if (!name?.trim() || Number(price) < 0) return res.status(400).json({ error: "ข้อมูลสินค้าไม่ถูกต้อง" }); const product = { id: id("P"), name: name.trim(), price: Number(price), category, active: true }; store.products.push(product); save(); res.status(201).json(product); });
app.post("/api/tables/:id/start", async (req, res) => { try { const table = tableById(req.params.id); if (!table) return res.status(404).json({ error: "ไม่พบโต๊ะ" }); if (req.body.memberId && !memberById(req.body.memberId)) return res.status(400).json({ error: "ไม่พบสมาชิก" }); const settings = settingsService.getSettings(); const profile = settings.pricingProfiles.find(item => item.id === settings.defaultPricingProfileId); const session = sessionService.openSession({ tableId: table.id, memberId: req.body.memberId || null, pricingProfile: profile }); billingService.audit("TABLE_OPENED", { tableId: table.id, sessionId: session.id }); const relay = await setRelayState(table, "on"); save(); res.json({ ...enrichTable(table), warning: relay.failed ? "เปิดโต๊ะแล้ว แต่ติดต่อ ESP32 เพื่อเปิด Relay ไม่สำเร็จ" : undefined }); } catch (error) { res.status(409).json({ error: error.message }); } });
app.post("/api/tables/:id/pause", (req, res) => { try { const session = sessionRepository.findOpenSessionByTable(req.params.id); if (!session) return res.status(409).json({ error: "โต๊ะยังไม่ได้เปิดใช้งาน" }); sessionService.pauseSession(session.id); billingService.audit("TABLE_PAUSED", { tableId: Number(req.params.id), sessionId: session.id }); res.json(enrichTable(tableById(req.params.id))); } catch (error) { res.status(409).json({ error: error.message }); } });
app.post("/api/tables/:id/resume", (req, res) => { try { const session = sessionRepository.findOpenSessionByTable(req.params.id); if (!session) return res.status(409).json({ error: "โต๊ะยังไม่ได้เปิดใช้งาน" }); sessionService.resumeSession(session.id); billingService.audit("TABLE_RESUMED", { tableId: Number(req.params.id), sessionId: session.id }); res.json(enrichTable(tableById(req.params.id))); } catch (error) { res.status(409).json({ error: error.message }); } });
app.post("/api/tables/:id/cancel", async (req, res) => { try { const table = tableById(req.params.id), session = sessionRepository.findOpenSessionByTable(req.params.id); if (!table || !session) return res.status(409).json({ error: "ไม่มี Session ที่ยกเลิกได้" }); sessionService.cancelSession(session.id); billingService.audit("SESSION_CANCELLED", { tableId: table.id, sessionId: session.id }); const relay = await setRelayState(table, "off"); save(); res.json({ table: enrichTable(table), warning: relay.failed ? "ยกเลิก Session แล้ว แต่ติดต่อ ESP32 เพื่อปิด Relay ไม่สำเร็จ" : undefined }); } catch (error) { res.status(409).json({ error: error.message }); } });
app.post("/api/tables/:id/items", (req, res) => { const table = tableById(req.params.id); const product = store.products.find(p => p.id === req.body.productId); if (!table || table.status !== "playing") return res.status(400).json({ error: "โต๊ะยังไม่เปิดใช้งาน" }); if (!product) return res.status(404).json({ error: "ไม่พบสินค้า" }); const existing = table.items.find(i => i.productId === product.id); if (existing) existing.quantity += Number(req.body.quantity) || 1; else table.items.push({ productId: product.id, name: product.name, price: product.price, quantity: Number(req.body.quantity) || 1 }); save(); res.json(enrichTable(table)); });
app.post("/api/tables/:id/checkout", (req, res) => { try { const table = tableById(req.params.id), session = sessionRepository.findOpenSessionByTable(req.params.id); if (!table || !session || !["ACTIVE", "PAUSED"].includes(session.state)) return res.status(400).json({ error: "โต๊ะไม่ได้อยู่ในสถานะที่คิดเงินได้" }); const paymentMethod = req.body.paymentMethod || "cash"; const closedSession = sessionService.awaitPaymentSession(session.id); billingService.audit("SESSION_AWAITING_PAYMENT", { tableId: table.id, sessionId: closedSession.id }); const bill = createBill(table, closedSession); const { payment } = paymentService.createPayment({ billId: bill.id, method: paymentMethod, amountSatang: bill.totalSatang }); res.json({ bill, payment }); } catch (error) { res.status(409).json({ error: error.message }); } });
app.post("/api/payments/:id/confirm", async (req, res) => { try { const { bill, payment } = paymentService.confirmPayment(req.params.id); const table = tableById(bill.tableId); const session = table && sessionRepository.findOpenSessionByTable(table.id); if (session) sessionService.completeSession(session.id); billingService.audit("SESSION_CLOSED_AFTER_PAYMENT", { tableId: bill.tableId, sessionId: session?.id, billId: bill.id, paymentId: payment.id }); const relay = table ? await setRelayState(table, "off") : {}; if (table) sessionRepository.releaseTable(table.id); save(); res.json({ bill, payment, warning: relay.failed ? "ยืนยันชำระแล้ว แต่ติดต่อ ESP32 เพื่อปิด Relay ไม่สำเร็จ" : undefined }); } catch (error) { res.status(409).json({ error: error.message }); } });
app.post("/api/payments/:id/cancel", (req, res) => { try { res.json(paymentService.cancelPayment(req.params.id)); } catch (error) { res.status(409).json({ error: error.message }); } });
app.delete("/api/bills/:id", (req, res) => { try { const bill = billingRepository.findBill(req.params.id); if (!bill) return res.status(404).json({ error: "ไม่พบบิลที่ต้องการยกเลิก" }); const actorId = String(req.body?.actorId || req.get("x-actor-id") || "SYSTEM").trim() || "UNKNOWN"; billingRepository.payments().filter(payment => payment.billId === bill.id && payment.status === "pending").forEach(payment => paymentService.cancelPayment(payment.id)); billingService.voidBill(bill, req.body?.reason, actorId); const table = tableById(bill.tableId); const session = table && sessionRepository.findOpenSessionByTable(table.id); if (session) sessionService.cancelSession(session.id); if (table) sessionRepository.releaseTable(table.id); res.json({ message: `ยกเลิกบิล ${bill.number} แล้ว โดยเก็บประวัติไว้สำหรับตรวจสอบ`, bill }); } catch (error) { res.status(409).json({ error: error.message }); } });
app.post("/api/relay/:tableId", async (req, res) => { const table = tableById(req.params.tableId); if (!table) return res.status(404).json({ error: "ไม่พบโต๊ะ" }); const state = req.body.state === "on" ? "on" : "off"; const relay = await setRelayState(table, state); save(); if (relay.failed) return res.status(202).json({ table: enrichTable(table), warning: "บันทึกคำสั่งแล้ว แต่ติดต่อ ESP32 ไม่สำเร็จ" }); res.json({ table: enrichTable(table), message: process.env.ESP32_BASE_URL ? "ส่งคำสั่ง Relay แล้ว" : "บันทึกคำสั่งแล้ว (ตั้งค่า ESP32_BASE_URL เพื่อเชื่อมอุปกรณ์จริง)" }); });
app.get("/api/reports/summary", (req, res) => { const date = req.query.date || new Date().toISOString().slice(0, 10); const bills = store.bills.filter(b => b.status === "paid" && b.createdAt.startsWith(date)); const sum = key => bills.reduce((s, b) => s + (b[key] || 0), 0); res.json({ date, billCount: bills.length, revenue: sum("total"), tableRevenue: sum("playAmount"), posRevenue: sum("foodAmount"), bills }); });
app.get("/api/reports/analytics", (req, res) => {
  const type = req.query.type === "year" ? "year" : "month";
  const now = new Date();
  const period = req.query.period || (type === "year" ? String(now.getFullYear()) : now.toISOString().slice(0, 7));
  const part = date => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(new Date(date)).map(x => [x.type, x.value]));
  const dateKey = bill => { const p = part(bill.createdAt); return `${p.year}-${p.month}-${p.day}`; };
  const periodKey = bill => { const p = part(bill.createdAt); return type === "year" ? p.year : `${p.year}-${p.month}`; };
  const bills = store.bills.filter(b => b.status === "paid" && periodKey(b) === period);
  const sum = key => Number(bills.reduce((s, b) => s + (b[key] || 0), 0).toFixed(2));
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, bills: 0, revenue: 0 }));
  const weekdays = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"].map(name => ({ name, bills: 0, revenue: 0 }));
  const daily = {};
  const products = {};
  bills.forEach(b => { const p = part(b.createdAt); const hour = Number(p.hour); const day = new Date(`${p.year}-${p.month}-${p.day}T12:00:00+07:00`).getDay(); hours[hour].bills++; hours[hour].revenue += b.total; weekdays[day].bills++; weekdays[day].revenue += b.total; const key = dateKey(b); daily[key] = (daily[key] || 0) + b.total; (b.items || []).forEach(item => { const x = products[item.name] || { name: item.name, quantity: 0, revenue: 0 }; x.quantity += item.quantity; x.revenue += item.total; products[item.name] = x; }); });
  const top = list => list.reduce((best, item) => item.bills > best.bills || (item.bills === best.bills && item.revenue > best.revenue) ? item : best, { bills: 0, revenue: 0 });
  res.json({ type, period, billCount: bills.length, revenue: sum("total"), tableRevenue: sum("playAmount"), posRevenue: sum("foodAmount"), averageBill: bills.length ? Number((sum("total") / bills.length).toFixed(2)) : 0, peakHour: top(hours), peakWeekday: top(weekdays), hours, weekdays, daily: Object.entries(daily).sort(([a], [b]) => a.localeCompare(b)).map(([date, revenue]) => ({ date, revenue })), topProducts: Object.values(products).sort((a, b) => b.revenue - a.revenue).slice(0, 10) });
});
app.listen(PORT, () => console.log(`88 Snooker Club running at http://localhost:${PORT}`));
