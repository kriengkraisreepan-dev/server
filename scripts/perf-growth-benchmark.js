// Growth benchmark: answers "is the shop still fast after N years of trading?"
//
// Builds a data directory sized like a real snooker club after N years, boots the server against
// it, then times the operations staff actually wait on: loading the screen, toggling a table
// light, and ringing up a POS sale.
//
//   node scripts/perf-growth-benchmark.js               # 1, 5 and 20 years
//   node scripts/perf-growth-benchmark.js 5 20          # only the years listed
//   node scripts/perf-growth-benchmark.js --legacy 1    # write history into store.json the old
//                                                       # way, so the first boot also has to run
//                                                       # the one-time migration
//
// Volumes below are modelled on the shop's own first weeks (~20 audit entries per bill) rounded to
// conservative round numbers; adjust DAILY if the real shop turns out busier.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DAILY = { bills: 30, payments: 30, posOrders: 20, sessions: 30, auditLogs: 600 };
const AUDIT_RETENTION_DAYS = 183; // must match AUDIT_LOG_RETENTION_MONTHS (6) in the billing repository
const DAY_MS = 86400000;

const uuid = () => crypto.randomUUID();
const iso = ms => new Date(ms).toISOString();

function baseStore() {
  return {
    settings: { shopName: "88 Snooker Club", hourlyRate: 100, minimumCharge: 50, tableCount: 6, promptPayId: "" },
    tables: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, code: `T${String(i + 1).padStart(2, "0")}`, name: `โต๊ะ ${i + 1}`, relay: i + 1, status: "free", memberId: null, startTime: null, items: [] })),
    members: [],
    products: Array.from({ length: 40 }, (_, i) => ({ id: `p-${i}`, name: `สินค้า ${i}`, sku: `SKU${i}`, price: 20 + i, costPrice: 10, categoryId: "c-1", category: "เครื่องดื่ม", active: true, trackStock: false })),
    productCategories: [{ id: "c-1", name: "เครื่องดื่ม", active: true, sortOrder: 1 }],
    bills: [], payments: [], posOrders: [], tableSessions: [], auditLogs: [],
    stockMovements: [], memberPointTransactions: [], users: []
  };
}

const item = seq => ({ id: uuid(), productId: "p-1", sku: "", name: "โค้ก", categoryId: "c-1", categoryName: "เครื่องดื่ม", quantity: 3, price: 25, total: 75, priceSatang: 2500, totalSatang: 7500, unitPrice: 25, unitCost: 10, lineSubtotal: 75, trackStock: false, note: "", addedAt: iso(seq), addedBy: "admin" });

// One trading day's worth of finished records, in the same shapes the app writes.
function recordsForDay(created, index, stamp, withAudit) {
  const day = { bills: [], payments: [], posOrders: [], tableSessions: [], auditLogs: [] };
  for (let n = 0; n < DAILY.bills; n += 1) {
    const at = created + n * 1000, billId = uuid(), number = `${stamp}-${String(n + 1).padStart(6, "0")}`;
    day.bills.push({ id: billId, number, receiptNumber: number, createdAt: iso(at), tableId: (n % 6) + 1, tableName: `โต๊ะ ${(n % 6) + 1}`, memberId: null, memberName: "ลูกค้าทั่วไป", memberCode: null, playStartedAt: iso(at - 3600000), playEndedAt: iso(at), playDurationSeconds: 3600, playAmount: 100, foodAmount: 75, total: 175, playAmountSatang: 10000, tableChargeSatang: 10000, foodAmountSatang: 7500, totalSatang: 17500, discount: 0, discountReason: "", pricingSnapshot: null, paymentMethod: "cash", status: "paid", saleSource: "TABLE", items: [item(at), item(at + 1)], paidAt: iso(at + 60000) });
    day.payments.push({ id: uuid(), billId, method: "cash", amountSatang: 17500, amount: 175, status: "paid", reference: number, createdAt: iso(at), paidAt: iso(at + 60000) });
  }
  for (let n = 0; n < DAILY.posOrders; n += 1) {
    const at = created + n * 1000;
    day.posOrders.push({ id: uuid(), orderNumber: `POS-${stamp}-${String(n + 1).padStart(4, "0")}`, orderType: "WALK_IN", tableId: null, tableName: null, tableSessionId: null, memberId: null, memberCode: null, memberName: null, status: "CONFIRMED", billingStatus: "BILLED", items: [item(at)], subtotal: 75, discountAmount: 0, total: 75, note: "", createdAt: iso(at), updatedAt: iso(at), confirmedAt: iso(at), cancelledAt: null, createdBy: "admin", updatedBy: "admin", confirmedBy: "admin", version: 1 });
  }
  for (let n = 0; n < DAILY.sessions; n += 1) {
    const at = created + n * 1000;
    day.tableSessions.push({ id: uuid(), tableId: (n % 6) + 1, memberId: null, state: "COMPLETED", openedAt: iso(at - 3600000), pausedAt: null, pausedSeconds: 0, pricingSnapshot: { id: "default", name: "Default", unit: "HOUR", rateSatang: 10000, minimumChargeSatang: 100, roundingRule: "UP_TO_BAHT", weekdayRules: [], timeRules: [] }, closedAt: iso(at), finalChargeSatang: 10000 });
  }
  if (withAudit) {
    for (let n = 0; n < DAILY.auditLogs; n += 1) {
      const at = created + n * 1000;
      day.auditLogs.push({ id: uuid(), occurredAt: iso(at), event: "POS_ORDER_ITEM_ADDED", tableId: (n % 6) + 1, sessionId: uuid(), billId: null, paymentId: null, actorId: "admin", userId: "admin", details: { orderId: uuid(), productId: "p-1", quantity: 3, lineSubtotal: 75 } });
    }
  }
  return day;
}

const ARCHIVE_NAME = { bills: "bills", payments: "payments", posOrders: "pos-orders", tableSessions: "table-sessions", auditLogs: "audit" };
const TIMESTAMP = { bills: r => r.createdAt, payments: r => r.createdAt, posOrders: r => r.createdAt, tableSessions: r => r.openedAt, auditLogs: r => r.occurredAt };

// Streams each day straight into the month files the app itself would have written, so a 20-year
// dataset never has to exist as a single in-memory JSON document.
function seedDataDirectory(dataDir, years, { legacy = false } = {}) {
  const days = Math.max(1, Math.round(years * 365));
  const now = Date.now();
  const store = baseStore();
  const historyDir = path.join(dataDir, "history");
  fs.mkdirSync(historyDir, { recursive: true });
  const handles = new Map();
  const buffers = new Map();
  const openFor = (key, month) => {
    const file = path.join(historyDir, `${ARCHIVE_NAME[key]}-${month}.jsonl`);
    if (!handles.has(file)) handles.set(file, fs.openSync(file, "a"));
    return file;
  };

  for (let day = 0; day < days; day += 1) {
    const created = now - (days - day) * DAY_MS;
    const stamp = iso(created).slice(0, 10).replaceAll("-", "");
    const records = recordsForDay(created, day, stamp, days - day <= AUDIT_RETENTION_DAYS);
    for (const [key, list] of Object.entries(records)) {
      if (!list.length) continue;
      if (legacy) { store[key].push(...list); continue; }
      const month = iso(created).slice(0, 7);
      const file = openFor(key, month);
      if (!buffers.has(file)) buffers.set(file, []);
      const buffer = buffers.get(file);
      for (const record of list) buffer.push(`${JSON.stringify(record)}\n`);
      if (buffer.length > 4000) { fs.writeFileSync(handles.get(file), buffer.join("")); buffer.length = 0; }
    }
  }
  for (const [file, buffer] of buffers) if (buffer.length) fs.writeFileSync(handles.get(file), buffer.join(""));
  for (const handle of handles.values()) fs.closeSync(handle);

  if (!legacy) { store.historySchemaVersion = 1; store.historyMigratedAt = iso(now); }
  store.auditLogPrunedAt = iso(now);
  const serialized = JSON.stringify(store);
  fs.mkdirSync(path.join(dataDir, "database"), { recursive: true });
  for (const file of [path.join(dataDir, "store.json"), path.join(dataDir, "database", "store.json")]) fs.writeFileSync(file, serialized);
  // Sanity check: the generated month files must match what TIMESTAMP says, or the server would
  // read them into the wrong period and the benchmark would flatter itself.
  void TIMESTAMP;
  return { seededBytes: Buffer.byteLength(serialized) + directoryBytes(historyDir) };
}

function directoryBytes(directory) {
  try { return fs.readdirSync(directory).reduce((sum, file) => sum + fs.statSync(path.join(directory, file)).size, 0); } catch { return 0; }
}

async function waitForServer(base) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).status === 401) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("server did not start");
}

async function time(label, runs, fn) {
  await fn(); // warm up
  const started = process.hrtime.bigint();
  for (let n = 0; n < runs; n += 1) await fn();
  return { label, ms: Number(process.hrtime.bigint() - started) / 1e6 / runs };
}

function start(dataDir, port) {
  return spawn(process.execPath, ["index.js"], { cwd: ROOT, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir, LUCKY_HARDWARE_HEALTH_POLLING: "0" }, stdio: ["ignore", "ignore", "pipe"] });
}

async function measure(years, { legacy = false } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "snooker-perf-"));
  seedDataDirectory(dataDir, years, { legacy });

  const port = 41000 + Math.floor(Math.random() * 2000);
  const base = `http://127.0.0.1:${port}`;
  const child = start(dataDir, port);
  let stderr = ""; child.stderr.on("data", chunk => { stderr += chunk; });
  const results = [];
  try {
    const bootStarted = process.hrtime.bigint();
    await waitForServer(base);
    results.push({ label: legacy ? "boot to first response (incl. migration)" : "boot to first response", ms: Number(process.hrtime.bigint() - bootStarted) / 1e6 });

    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "123456789" }) });
    if (login.status !== 200) throw new Error(`login failed: ${login.status} ${await login.text()}`);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const headers = { Cookie: cookie, "Content-Type": "application/json" };

    results.push(await time("GET /api/state (polled every 15s)", 5, async () => { await (await fetch(`${base}/api/state`, { headers })).arrayBuffer(); }));
    const stateBytes = (await (await fetch(`${base}/api/state`, { headers })).arrayBuffer()).byteLength;
    // A light toggle with no ESP32 attached still runs the full save() path, which is what we measure.
    results.push(await time("POST /api/relay/1 (light on/off -> save)", 5, async () => { await (await fetch(`${base}/api/relay/1`, { method: "POST", headers, body: JSON.stringify({ state: "on" }) })).arrayBuffer(); }));
    results.push(await time("POST /api/pos-orders (new walk-in bill)", 5, async () => { await (await fetch(`${base}/api/pos-orders`, { method: "POST", headers, body: JSON.stringify({ orderType: "WALK_IN" }) })).arrayBuffer(); }));
    results.push(await time("GET /api/pos-orders (order list)", 3, async () => { await (await fetch(`${base}/api/pos-orders`, { headers })).arrayBuffer(); }));
    results.push(await time("GET /api/reports/summary (today)", 5, async () => { await (await fetch(`${base}/api/reports/summary`, { headers })).arrayBuffer(); }));
    results.push(await time("GET /api/reports/analytics (this month)", 3, async () => { await (await fetch(`${base}/api/reports/analytics`, { headers })).arrayBuffer(); }));
    results.push(await time("GET /api/bills (history, page 1)", 5, async () => { await (await fetch(`${base}/api/bills`, { headers })).arrayBuffer(); }));
    results.push(await time("GET /api/audit-logs (page 1)", 3, async () => { await (await fetch(`${base}/api/audit-logs`, { headers })).arrayBuffer(); }));

    child.kill();
    await new Promise(resolve => setTimeout(resolve, 500));
    const restarted = start(dataDir, port + 1);
    try {
      const restartStarted = process.hrtime.bigint();
      await waitForServer(`http://127.0.0.1:${port + 1}`);
      results.push({ label: "boot to first response (restart)", ms: Number(process.hrtime.bigint() - restartStarted) / 1e6 });
    } finally { restarted.kill(); }

    return { years, results, stateBytes, hotBytes: fs.statSync(path.join(dataDir, "store.json")).size, archiveBytes: directoryBytes(path.join(dataDir, "history")) };
  } catch (error) {
    error.message += `\n--- server stderr ---\n${stderr.slice(0, 2000)}`;
    throw error;
  } finally {
    child.kill();
    await new Promise(resolve => setTimeout(resolve, 300));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

(async () => {
  const argv = process.argv.slice(2);
  const legacy = argv.includes("--legacy");
  const years = argv.filter(value => Number(value) > 0).map(Number);
  const mb = value => `${(value / 1048576).toFixed(2)} MB`;
  for (const value of (years.length ? years : [1, 5, 20])) {
    const report = await measure(value, { legacy });
    console.log(`\n=== ${report.years} year(s) of trading — history on disk ${mb(report.archiveBytes)}, store.json (rewritten on every click) ${mb(report.hotBytes)}, /api/state payload ${mb(report.stateBytes)} ===`);
    for (const row of report.results) console.log(`  ${row.label.padEnd(44)} ${row.ms.toFixed(0).padStart(7)} ms`);
  }
})().catch(error => { console.error(error); process.exit(1); });
