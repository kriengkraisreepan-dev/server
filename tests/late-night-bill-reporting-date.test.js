const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

// A table opened before midnight (Thai time, UTC+7) but paid off after it must count toward the
// day it was OPENED, not the day the bill happened to close — see billReportingTimestamp() in
// index.js and billReportingDateKey() in public/js/app.js.

test("a bill opened before midnight and closed after it reports under the opening day", async t => {
  const root = path.resolve(__dirname, "..");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-late-night-bill-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  // 2026-08-13T16:50:00Z is 2026-08-13 23:50 in Thailand (UTC+7) — table opened just before midnight.
  const openedAt = "2026-08-13T16:50:00.000Z";
  // 2026-08-13T17:10:00Z is 2026-08-14 00:10 in Thailand — bill closed/paid just after midnight.
  const closedAt = "2026-08-13T17:10:00.000Z";
  const bill = {
    id: "B-LATE-1", number: "LATE-0001", receiptNumber: "LATE-0001", status: "paid",
    createdAt: closedAt, paidAt: closedAt, playStartedAt: openedAt, playEndedAt: closedAt,
    playDurationSeconds: 1200, tableId: 1, tableName: "T1",
    total: 100, totalSatang: 10000, playAmount: 100, playAmountSatang: 10000, foodAmount: 0, foodAmountSatang: 0,
    items: [], paymentMethod: "cash"
  };
  const store = {
    settings: { shopName: "Late Night Test", hourlyRate: 100, minimumCharge: 50, tableCount: 1, promptPayId: "" },
    tables: [{ id: 1, code: "T01", name: "T1", status: "free", items: [] }],
    members: [], products: [], bills: [bill], payments: [], auditLogs: []
  };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "store.json"), JSON.stringify(store));

  const port = 39500 + Math.floor(Math.random() * 400), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["index.js"], { cwd: root, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir }, stdio: "ignore" });
  t.after(() => child.kill());
  for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${base}/api/state`)).status === 401) break; } catch {} await new Promise(resolve => setTimeout(resolve, 50)); if (i === 99) throw new Error("server did not start"); }

  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "123456789" }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0], headers = { Cookie: cookie };

  // The opening day (Aug 13, Thai time) must show the bill's revenue.
  let response = await fetch(`${base}/api/reports/analytics?type=day&period=2026-08-13`, { headers });
  assert.equal(response.status, 200);
  let report = await response.json();
  assert.equal(report.billCount, 1);
  assert.equal(report.revenue, 100);
  assert.deepEqual(report.daily, [{ date: "2026-08-13", revenue: 100 }]);

  // The closing day (Aug 14, Thai time) must NOT double-count it.
  response = await fetch(`${base}/api/reports/analytics?type=day&period=2026-08-14`, { headers });
  assert.equal(response.status, 200);
  report = await response.json();
  assert.equal(report.billCount, 0);
  assert.equal(report.revenue, 0);

  // /api/reports/summary follows the same rule.
  response = await fetch(`${base}/api/reports/summary?date=2026-08-13`, { headers });
  assert.equal(response.status, 200);
  let summary = await response.json();
  assert.equal(summary.billCount, 1);
  assert.equal(summary.revenue, 100);

  response = await fetch(`${base}/api/reports/summary?date=2026-08-14`, { headers });
  assert.equal(response.status, 200);
  summary = await response.json();
  assert.equal(summary.billCount, 0);
});
