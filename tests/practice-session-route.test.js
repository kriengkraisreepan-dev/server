const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

// End-to-end: pressing "ซ้อม" instead of "เปิดโต๊ะ" has to reach the bill. The table must advertise
// its practice rate (the button prints it), the session must open at that rate with Happy Hour out
// of the way, and the bill must say which mode it was so a cheap hour is explainable months later.

test("opening a table in ซ้อม mode charges the practice rate and says so on the bill", async t => {
  const root = path.resolve(__dirname, "..");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-practice-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const port = 39400 + Math.floor(Math.random() * 90), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["index.js"], { cwd: root, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir }, stdio: "ignore" });
  t.after(() => child.kill());
  for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${base}/api/state`)).status === 401) break; } catch {} await new Promise(resolve => setTimeout(resolve, 50)); if (i === 99) throw new Error("server did not start"); }

  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "123456789" }) });
  assert.equal(login.status, 200);
  const headers = { Cookie: login.headers.get("set-cookie").split(";")[0], "Content-Type": "application/json" };
  const readState = async () => (await (await fetch(`${base}/api/state`, { headers })).json());

  // Before anything is configured the mode must be refused rather than opened at the full rate.
  const unconfigured = await fetch(`${base}/api/tables/1/start`, { method: "POST", headers, body: JSON.stringify({ mode: "PRACTICE" }) });
  assert.equal(unconfigured.status, 400);
  assert.equal((await unconfigured.json()).error, "PRACTICE_RATE_NOT_CONFIGURED");

  // ปกติ ฿120, Happy Time ฿100 all day (so the clock cannot make this flaky), ซ้อมเดี่ยว ฿80.
  const settings = (await readState()).settings;
  const pricingProfiles = settings.pricingProfiles.map(item => item.id === settings.defaultPricingProfileId
    ? { ...item, rateSatang: 12000, minimumChargeSatang: 0, roundingRule: "NONE", pointsPerInterval: 5, practiceRateSatang: 8000, practicePointsPerInterval: 2, timeRules: [{ name: "Happy Time", weekdays: [], startTime: "", endTime: "", rateSatang: 10000, pointsPerInterval: 3 }] }
    : item);
  const saved = await fetch(`${base}/api/settings`, { method: "PUT", headers, body: JSON.stringify({ ...settings, minimumCharge: 0, pricingProfiles }) });
  assert.equal(saved.status, 200, await saved.text());

  // The card needs the rate to print on the button, and nothing to show on a profile without one.
  const beforeOpen = (await readState()).tables.find(item => item.id === 1);
  assert.equal(beforeOpen.practiceRateSatang, 8000);

  assert.equal((await fetch(`${base}/api/tables/1/start`, { method: "POST", headers, body: JSON.stringify({ mode: "PRACTICE" }) })).status, 200);
  const table = (await readState()).tables.find(item => item.id === 1);
  assert.equal(table.sessionMode, "PRACTICE", "the card has to be able to label the session");

  await new Promise(resolve => setTimeout(resolve, 2200));

  const preview = (await (await fetch(`${base}/api/table-sessions/${table.runtimeSessionId}/billing-preview`, { headers })).json()).preview;
  assert.equal(preview.sessionMode, "PRACTICE");
  assert.equal(preview.rateSegments[0].rateSatang, 8000, "the practice rate, not the Happy Time rule that covers the same moment");
  assert.equal(preview.pointsEstimate.points, 0, "not a full interval yet");

  const bill = (await (await fetch(`${base}/api/tables/1/checkout`, { method: "POST", headers, body: JSON.stringify({ paymentMethod: "cash" }) })).json()).bill;
  assert.equal(bill.sessionMode, "PRACTICE", "the receipt prints ประเภท: ซ้อมเดี่ยว from this");
  assert.equal(bill.rateSegments.length, 1, "practice is one flat rate — no Happy Hour split");
  assert.equal(bill.rateSegments[0].rateSatang, 8000);
  assert.equal(bill.rateSegments[0].pointsPerInterval, 2, "so the points awarded at payment are the practice ones");

  // ...and an ordinary open on the next table over still lands on the Happy Time rule. (Table 1 is
  // not free again yet — its bill is awaiting payment.)
  assert.equal((await fetch(`${base}/api/tables/2/start`, { method: "POST", headers, body: "{}" })).status, 200);
  const normal = (await readState()).tables.find(item => item.id === 2);
  assert.equal(normal.sessionMode, "NORMAL");
  await new Promise(resolve => setTimeout(resolve, 1100)); // a zero-length session has no segment to inspect
  const normalPreview = (await (await fetch(`${base}/api/table-sessions/${normal.runtimeSessionId}/billing-preview`, { headers })).json()).preview;
  assert.equal(normalPreview.rateSegments[0].rateSatang, 10000);
  assert.equal(normalPreview.rateSegments[0].pointsPerInterval, 3);
});
