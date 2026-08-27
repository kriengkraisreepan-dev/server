const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

// End-to-end cover for the move of bills, payments, orders, sessions and the audit trail out of
// store.json and into month files: an existing shop's data must survive the one-time migration and
// stay reachable from every screen that used to read it out of the hot store.
const ROOT = path.resolve(__dirname, "..");
const DAY_MS = 86400000;
const iso = ms => new Date(ms).toISOString();

function legacyStore(now) {
  const oldAt = now - 120 * DAY_MS;
  const recentAt = now - 1 * DAY_MS;
  const oldDay = iso(oldAt).slice(0, 10);
  const bill = (id, at, number) => ({
    id, number, receiptNumber: number, createdAt: iso(at), tableId: 1, tableName: "โต๊ะ 1",
    memberId: null, memberName: "ลูกค้าทั่วไป", memberCode: null,
    playStartedAt: iso(at - 3600000), playEndedAt: iso(at), playDurationSeconds: 3600,
    playAmount: 100, foodAmount: 75, total: 175, playAmountSatang: 10000, tableChargeSatang: 10000,
    foodAmountSatang: 7500, totalSatang: 17500, discount: 0, discountReason: "", pricingSnapshot: null,
    paymentMethod: "cash", status: "paid", saleSource: "TABLE", items: [], paidAt: iso(at + 60000)
  });
  return {
    store: {
      settings: { shopName: "88 Snooker Club", hourlyRate: 100, minimumCharge: 50, tableCount: 3, promptPayId: "" },
      tables: [1, 2, 3].map(id => ({ id, code: `T0${id}`, name: `โต๊ะ ${id}`, relay: id, status: "free", memberId: null, startTime: null, items: [] })),
      members: [], products: [], productCategories: [],
      bills: [bill("old-bill", oldAt, "20260101-000001"), bill("recent-bill", recentAt, "20260801-000001")],
      payments: [{ id: "old-payment", billId: "old-bill", method: "cash", amountSatang: 17500, amount: 175, status: "paid", reference: "20260101-000001", createdAt: iso(oldAt), paidAt: iso(oldAt + 60000) }],
      posOrders: [], tableSessions: [], stockMovements: [], memberPointTransactions: [],
      auditLogs: [
        { id: "old-event", occurredAt: iso(oldAt), event: "BILL_CREATED", tableId: 1, sessionId: null, billId: "old-bill", paymentId: null, actorId: "admin", userId: "admin", details: {} },
        { id: "recent-event", occurredAt: iso(recentAt), event: "TABLE_OPENED", tableId: 1, sessionId: null, billId: null, paymentId: null, actorId: "admin", userId: "admin", details: {} }
      ]
    },
    oldDay
  };
}

async function waitForServer(base) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).status === 401) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("server did not start");
}

test("history moves out of store.json on first boot and stays reachable from every screen", { timeout: 30000 }, async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-history-server-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const now = Date.now();
  const { store, oldDay } = legacyStore(now);
  fs.writeFileSync(path.join(dataDir, "store.json"), JSON.stringify(store));

  const port = 42000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["index.js"], { cwd: ROOT, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir, LUCKY_HARDWARE_HEALTH_POLLING: "0" }, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = ""; child.stderr.on("data", chunk => { stderr += chunk; });
  t.after(() => child.kill());

  try {
    await waitForServer(base);
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "123456789" }) });
    assert.equal(login.status, 200);
    const headers = { Cookie: login.headers.get("set-cookie").split(";")[0], "Content-Type": "application/json" };
    const get = async url => { const response = await fetch(`${base}${url}`, { headers }); assert.equal(response.status, 200, `${url} -> ${response.status}`); return response.json(); };

    // The file rewritten on every click no longer carries the old bill, and the month files do.
    const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
    assert.equal(persisted.historySchemaVersion, 1);
    assert.deepEqual(persisted.bills.map(item => item.id), ["recent-bill"], "only the working set stays hot");
    assert.deepEqual(persisted.auditLogs, [], "the audit trail is not held in the hot file at all");
    const archived = fs.readdirSync(path.join(dataDir, "history"));
    assert.ok(archived.some(file => file.startsWith("bills-")), `expected bill month files, saw ${archived.join(", ")}`);

    // ...and every read path still finds it.
    const details = await get("/api/bills/old-bill");
    assert.equal(details.bill.receiptNumber, "20260101-000001");
    assert.deepEqual(details.payments.map(payment => payment.id), ["old-payment"], "its payment came back from the archive too");
    assert.deepEqual(details.auditEvents.map(event => event.id), ["old-event"]);

    const searched = await get(`/api/bills?from=${oldDay}&to=${oldDay}`);
    assert.deepEqual(searched.items.map(item => item.id), ["old-bill"]);
    assert.equal(searched.scope.bounded, false);

    const summary = await get(`/api/reports/summary?date=${oldDay}`);
    assert.equal(summary.billCount, 1, "a report for an archived day reads that day's month file");
    assert.equal(summary.revenue, 175);

    const analytics = await get(`/api/reports/analytics?type=day&period=${oldDay}`);
    assert.equal(analytics.billCount, 1, "analytics for an archived period reads that period's month files");
    assert.equal(analytics.revenue, 175);

    const audit = await get(`/api/audit-logs?from=${oldDay}&to=${oldDay}`);
    assert.deepEqual(audit.items.map(item => item.id), ["old-event"]);
    assert.ok((await get("/api/audit-logs/event-types")).items.includes("BILL_CREATED"));

    // The default (no date range) view is the recent window, and the recent bill is in it.
    const recent = await get("/api/bills");
    assert.equal(recent.scope.bounded, true);
    assert.ok(recent.items.some(item => item.id === "recent-bill"));

    // /api/state carries the working set, not the shop's history.
    const state = await get("/api/state");
    assert.deepEqual(state.bills.map(item => item.id), ["recent-bill"]);
  } catch (error) {
    error.message += `\n--- server stderr ---\n${stderr.slice(0, 2000)}`;
    throw error;
  }
});
