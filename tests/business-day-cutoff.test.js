const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

// A snooker club trades past midnight, so a calendar day splits one night's takings across two
// reports — the owner reconciles in the morning and wants the whole night as one number. The
// business day now rolls at settings.businessDayStartHour (06:00 by default) instead of midnight.
//
// The clock hour must NOT move with it. A bill taken at 02:00 was taken at 02:00; shifting its hour
// would put the peak-hour figure and the hourly revenue chart out of step with the wall clock.
//
// Times below are UTC. The shop is Asia/Bangkok (UTC+7), so 19:00Z = 02:00 the next day, local.

async function boot(t) {
  const root = path.resolve(__dirname, "..");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-business-day-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const port = 39000 + Math.floor(Math.random() * 90), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["index.js"], { cwd: root, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir }, stdio: "ignore" });
  t.after(() => child.kill());
  for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${base}/api/state`)).status === 401) break; } catch {} await new Promise(resolve => setTimeout(resolve, 50)); if (i === 99) throw new Error("server did not start"); }
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "123456789" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  return { base, dataDir, headers: { Cookie: cookie, "Content-Type": "application/json" }, child };
}

// Writes bills straight into the store so their timestamps can be chosen exactly, then restarts the
// server so it reloads them. Going through the UI cannot produce a 02:00 bill on demand.
async function seedBills(context, t, bills, settingsPatch = {}) {
  context.child.kill();
  await new Promise(resolve => setTimeout(resolve, 200));
  const storePath = path.join(context.dataDir, "store.json");
  const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
  Object.assign(store.settings, settingsPatch);
  store.bills = bills.map((bill, index) => ({
    id: `b${index}`, number: `R-${index}`, status: "paid", tableId: 1, tableName: "โต๊ะ 1",
    playStartedAt: bill.at, createdAt: bill.at, total: bill.total, playAmount: bill.total, foodAmount: 0,
    items: [], totalSatang: bill.total * 100, tableChargeSatang: bill.total * 100, foodAmountSatang: 0
  }));
  fs.writeFileSync(storePath, JSON.stringify(store));
  const root = path.resolve(__dirname, "..");
  const port = new URL(context.base).port;
  const child = spawn(process.execPath, ["index.js"], { cwd: root, env: { ...process.env, PORT: port, LUCKY_DATA_DIR: context.dataDir }, stdio: "ignore" });
  t.after(() => child.kill());
  for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${context.base}/api/state`)).status === 401) break; } catch {} await new Promise(resolve => setTimeout(resolve, 50)); if (i === 99) throw new Error("server did not restart"); }
  const login = await fetch(`${context.base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "123456789" }) });
  context.headers = { Cookie: login.headers.get("set-cookie").split(";")[0], "Content-Type": "application/json" };
}

const analytics = (context, query) => fetch(`${context.base}/api/reports/analytics?${query}`, { headers: context.headers }).then(response => response.json());

test("a 02:00 bill counts toward the night before, not the calendar day it was paid on", async t => {
  const context = await boot(t);
  await seedBills(context, t, [
    { at: "2026-08-20T15:00:00Z", total: 500 },  // 22:00 on the 20th, local
    { at: "2026-08-20T19:00:00Z", total: 300 },  // 02:00 on the 21st, local — same night
    { at: "2026-08-21T04:00:00Z", total: 700 }   // 11:00 on the 21st, local — the next day's trade
  ]);

  const night = await analytics(context, "type=day&period=2026-08-20");
  assert.equal(night.revenue, 800, "the whole night, both sides of midnight, in one number");
  assert.equal(night.billCount, 2);

  const nextDay = await analytics(context, "type=day&period=2026-08-21");
  assert.equal(nextDay.revenue, 700, "trade after 06:00 belongs to the new day");
});

test("the clock hour stays true even though the day was shifted", async t => {
  const context = await boot(t);
  await seedBills(context, t, [{ at: "2026-08-20T19:00:00Z", total: 300 }]); // 02:00 local
  const report = await analytics(context, "type=day&period=2026-08-20");
  assert.equal(report.peakHour.hour, 2, "02:00 must report as 02:00, not shifted with the business day");
  assert.equal(report.hours[2].revenue, 300);
  assert.equal(report.hours[3].revenue, 0);
});

test("a bill just before the cutoff is yesterday's and one just after is today's", async t => {
  const context = await boot(t);
  await seedBills(context, t, [
    { at: "2026-08-20T22:59:00Z", total: 100 },  // 05:59 on the 21st, local
    { at: "2026-08-20T23:01:00Z", total: 200 }   // 06:01 on the 21st, local
  ]);
  assert.equal((await analytics(context, "type=day&period=2026-08-20")).revenue, 100);
  assert.equal((await analytics(context, "type=day&period=2026-08-21")).revenue, 200);
});

test("setting the cutoff to 0 restores plain calendar days", async t => {
  const context = await boot(t);
  await seedBills(context, t, [
    { at: "2026-08-20T15:00:00Z", total: 500 },  // 22:00 on the 20th
    { at: "2026-08-20T19:00:00Z", total: 300 }   // 02:00 on the 21st
  ], { businessDayStartHour: 0 });
  assert.equal((await analytics(context, "type=day&period=2026-08-20")).revenue, 500, "midnight splits the night again");
  assert.equal((await analytics(context, "type=day&period=2026-08-21")).revenue, 300);
});

test("the daily series and the monthly total follow the same cutoff", async t => {
  const context = await boot(t);
  await seedBills(context, t, [
    { at: "2026-08-20T15:00:00Z", total: 500 },
    { at: "2026-08-20T19:00:00Z", total: 300 },
    { at: "2026-08-21T04:00:00Z", total: 700 }
  ]);
  const month = await analytics(context, "type=month&period=2026-08");
  assert.equal(month.revenue, 1500);
  const byDate = Object.fromEntries(month.daily.map(entry => [entry.date, entry.revenue]));
  assert.equal(byDate["2026-08-20"], 800, "the chart's column for the 20th matches its day report");
  assert.equal(byDate["2026-08-21"], 700);
});

test("an out-of-range cutoff is rejected rather than silently corrupting every report", async t => {
  const context = await boot(t);
  const settings = (await (await fetch(`${context.base}/api/state`, { headers: context.headers })).json()).settings;
  assert.equal(settings.businessDayStartHour, 6, "06:00 is the default");
  const bad = await fetch(`${context.base}/api/settings`, { method: "PUT", headers: context.headers, body: JSON.stringify({ ...settings, businessDayStartHour: 24 }) });
  assert.equal(bad.status, 400);
  const good = await fetch(`${context.base}/api/settings`, { method: "PUT", headers: context.headers, body: JSON.stringify({ ...settings, businessDayStartHour: 4 }) });
  assert.equal(good.status, 200, await good.text());
});
