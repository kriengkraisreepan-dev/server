// Growth benchmark: answers "is the shop still fast after N years of trading?"
//
// Builds a synthetic store.json sized like a real snooker club after N years, boots the server
// against it in a throwaway data directory, then times the operations staff actually wait on:
// loading the screen, toggling a table light, and ringing up a POS sale.
//
//   node scripts/perf-growth-benchmark.js            # 0.1, 1, 5 and 20 years
//   node scripts/perf-growth-benchmark.js 5 20       # only the years listed
//
// Volumes below are modelled on the shop's own first weeks (~40 audit entries per bill) rounded
// to conservative round numbers; adjust DAILY if the real shop turns out busier.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DAILY = { bills: 30, payments: 30, posOrders: 20, sessions: 30, auditLogs: 600 };
const AUDIT_RETENTION_DAYS = 183; // must match AUDIT_LOG_RETENTION_MONTHS (6) in the billing repository

const uuid = () => crypto.randomUUID();
const iso = ms => new Date(ms).toISOString();

function buildStore(years) {
  const days = Math.max(1, Math.round(years * 365));
  const now = Date.now();
  const dayMs = 86400000;
  const at = (day, seq) => now - (days - day) * dayMs + seq * 1000;

  const tables = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, code: `T${String(i + 1).padStart(2, "0")}`, name: `โต๊ะ ${i + 1}`, relay: i + 1, status: "free", memberId: null, startTime: null, items: [] }));
  const products = Array.from({ length: 40 }, (_, i) => ({ id: `p-${i}`, name: `สินค้า ${i}`, sku: `SKU${i}`, price: 20 + i, costPrice: 10, categoryId: "c-1", category: "เครื่องดื่ม", active: true, trackStock: false }));
  const store = {
    settings: { shopName: "88 Snooker Club", hourlyRate: 100, minimumCharge: 50, tableCount: 6, promptPayId: "" },
    tables, members: [], products,
    productCategories: [{ id: "c-1", name: "เครื่องดื่ม", active: true, sortOrder: 1 }],
    bills: [], payments: [], posOrders: [], tableSessions: [], auditLogs: [],
    stockMovements: [], memberPointTransactions: [], users: []
  };

  const item = seq => ({ id: uuid(), productId: "p-1", sku: "", name: "โค้ก", categoryId: "c-1", categoryName: "เครื่องดื่ม", quantity: 3, price: 25, total: 75, priceSatang: 2500, totalSatang: 7500, unitPrice: 25, unitCost: 10, lineSubtotal: 75, trackStock: false, note: "", addedAt: iso(seq), addedBy: "admin" });

  for (let day = 0; day < days; day += 1) {
    const stamp = iso(at(day, 0)).slice(0, 10).replaceAll("-", "");
    for (let n = 0; n < DAILY.bills; n += 1) {
      const created = at(day, n);
      const billId = uuid();
      store.bills.push({ id: billId, number: `${stamp}-${String(n + 1).padStart(6, "0")}`, receiptNumber: `${stamp}-${String(n + 1).padStart(6, "0")}`, createdAt: iso(created), tableId: (n % 6) + 1, tableName: `โต๊ะ ${(n % 6) + 1}`, memberId: null, memberName: "ลูกค้าทั่วไป", memberCode: null, playStartedAt: iso(created - 3600000), playEndedAt: iso(created), playDurationSeconds: 3600, playAmount: 100, foodAmount: 75, total: 175, playAmountSatang: 10000, tableChargeSatang: 10000, foodAmountSatang: 7500, totalSatang: 17500, discount: 0, discountReason: "", pricingSnapshot: null, paymentMethod: "cash", status: "paid", saleSource: "TABLE", items: [item(created), item(created + 1)], paidAt: iso(created + 60000) });
      store.payments.push({ id: uuid(), billId, method: "cash", amountSatang: 17500, amount: 175, status: "paid", reference: `${stamp}-${String(n + 1).padStart(6, "0")}`, createdAt: iso(created), paidAt: iso(created + 60000) });
    }
    for (let n = 0; n < DAILY.posOrders; n += 1) {
      const created = at(day, n);
      store.posOrders.push({ id: uuid(), orderNumber: `POS-${stamp}-${String(n + 1).padStart(4, "0")}`, orderType: "WALK_IN", tableId: null, tableName: null, tableSessionId: null, memberId: null, memberCode: null, memberName: null, status: "BILLED", items: [item(created)], subtotal: 75, discountAmount: 0, total: 75, note: "", createdAt: iso(created), updatedAt: iso(created), confirmedAt: iso(created), cancelledAt: null, createdBy: "admin", updatedBy: "admin", confirmedBy: "admin" });
    }
    for (let n = 0; n < DAILY.sessions; n += 1) {
      const created = at(day, n);
      store.tableSessions.push({ id: uuid(), tableId: (n % 6) + 1, memberId: null, state: "COMPLETED", openedAt: iso(created - 3600000), pausedAt: null, pausedSeconds: 0, pricingSnapshot: { id: "default", name: "Default", unit: "HOUR", rateSatang: 10000, minimumChargeSatang: 100, roundingRule: "UP_TO_BAHT", weekdayRules: [], timeRules: [] }, closedAt: iso(created), finalChargeSatang: 10000 });
    }
    // Audit logs are pruned to a 6-month window, so only recent days contribute.
    if (days - day <= AUDIT_RETENTION_DAYS) {
      for (let n = 0; n < DAILY.auditLogs; n += 1) {
        const created = at(day, n);
        store.auditLogs.push({ id: uuid(), occurredAt: iso(created), event: "POS_ORDER_ITEM_ADDED", tableId: (n % 6) + 1, sessionId: uuid(), billId: null, paymentId: null, actorId: "admin", userId: "admin", details: { orderId: uuid(), productId: "p-1", quantity: 3, lineSubtotal: 75 } });
      }
    }
  }
  store.auditLogPrunedAt = iso(now);
  return store;
}

async function waitForServer(base) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
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

async function measure(years) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "snooker-perf-"));
  const store = buildStore(years);
  fs.mkdirSync(path.join(dataDir, "database"), { recursive: true });
  const layouts = [path.join(dataDir, "store.json"), path.join(dataDir, "database", "store.json")];
  const serialized = JSON.stringify(store);
  for (const file of layouts) fs.writeFileSync(file, serialized);
  const bytes = Buffer.byteLength(serialized);

  const port = 41000 + Math.floor(Math.random() * 2000);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["index.js"], { cwd: ROOT, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir, LUCKY_HARDWARE_HEALTH_POLLING: "0" }, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = ""; child.stderr.on("data", chunk => { stderr += chunk; });
  const results = [];
  try {
    const bootStarted = process.hrtime.bigint();
    await waitForServer(base);
    results.push({ label: "boot to first response", ms: Number(process.hrtime.bigint() - bootStarted) / 1e6 });

    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "123456789" }) });
    if (login.status !== 200) throw new Error(`login failed: ${login.status} ${await login.text()}`);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const headers = { Cookie: cookie, "Content-Type": "application/json" };

    results.push(await time("GET /api/state (polled every 15s)", 5, async () => {
      const response = await fetch(`${base}/api/state`, { headers });
      await response.arrayBuffer();
    }));
    const stateBytes = (await (await fetch(`${base}/api/state`, { headers })).arrayBuffer()).byteLength;

    // A light toggle with no ESP32 attached still runs the full save() path, which is what we measure.
    results.push(await time("POST /api/relay/1 (light on/off -> save)", 5, async () => {
      const response = await fetch(`${base}/api/relay/1`, { method: "POST", headers, body: JSON.stringify({ state: "on" }) });
      await response.arrayBuffer();
    }));
    results.push(await time("POST /api/pos-orders (new walk-in bill)", 5, async () => {
      const response = await fetch(`${base}/api/pos-orders`, { method: "POST", headers, body: JSON.stringify({ orderType: "WALK_IN" }) });
      await response.arrayBuffer();
    }));
    results.push(await time("GET /api/reports/summary (today)", 5, async () => {
      const response = await fetch(`${base}/api/reports/summary`, { headers });
      await response.arrayBuffer();
    }));
    results.push(await time("GET /api/bills (history, page 1)", 5, async () => {
      const response = await fetch(`${base}/api/bills`, { headers });
      await response.arrayBuffer();
    }));
    return { years, bytes, stateBytes, results };
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
  const years = process.argv.slice(2).map(Number).filter(value => value > 0);
  for (const value of (years.length ? years : [0.1, 1, 5, 20])) {
    const report = await measure(value);
    const label = report.years < 1 ? `${Math.round(report.years * 12)} month(s)` : `${report.years} year(s)`;
    console.log(`\n=== ${label} of trading — store.json ${(report.bytes / 1048576).toFixed(1)} MB, /api/state payload ${(report.stateBytes / 1048576).toFixed(2)} MB ===`);
    for (const row of report.results) console.log(`  ${row.label.padEnd(44)} ${row.ms.toFixed(0).padStart(7)} ms`);
  }
})().catch(error => { console.error(error); process.exit(1); });
