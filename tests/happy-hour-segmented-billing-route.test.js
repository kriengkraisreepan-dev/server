const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

// End-to-end: the rate segments computed by the pricing engine have to survive all the way onto the
// bill, because that is what the receipt prints. A session is snapshotted with the profile's BASE
// rate and its rules (not a rate already collapsed at open time), the segments are frozen when the
// session closes, and the bill carries them.

test("a real table session carries its rate segments through to the bill", async t => {
  const root = path.resolve(__dirname, "..");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-happy-hour-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const port = 39200 + Math.floor(Math.random() * 90), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["index.js"], { cwd: root, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir }, stdio: "ignore" });
  t.after(() => child.kill());
  for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${base}/api/state`)).status === 401) break; } catch {} await new Promise(resolve => setTimeout(resolve, 50)); if (i === 99) throw new Error("server did not start"); }

  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "123456789" }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0], headers = { Cookie: cookie, "Content-Type": "application/json" };

  // Give the default profile an all-day rule so the session is guaranteed to hit one, whatever
  // time the test happens to run. A window that depends on the wall clock would be flaky.
  const settings = (await (await fetch(`${base}/api/state`, { headers })).json()).settings;
  const pricingProfiles = settings.pricingProfiles.map(item => item.id === settings.defaultPricingProfileId
    ? { ...item, minimumChargeSatang: 0, roundingRule: "NONE", timeRules: [{ id: "allday", name: "โปรทั้งวัน", weekdays: [], startTime: "", endTime: "", rateSatang: 9000 }] }
    : item);
  // The minimum charge must be out of the way too: while it is doing the work the itemisation is
  // deliberately withheld, because the lines would sum to less than the charge printed above them.
  const saved = await fetch(`${base}/api/settings`, { method: "PUT", headers, body: JSON.stringify({ ...settings, minimumCharge: 0, pricingProfiles }) });
  assert.equal(saved.status, 200, await saved.text());

  assert.equal((await fetch(`${base}/api/tables/1/start`, { method: "POST", headers, body: "{}" })).status, 200);
  const state = await (await fetch(`${base}/api/state`, { headers })).json();
  const table = state.tables.find(item => item.id === 1);
  assert.ok(table.runtimeSessionId);

  // Let real billable seconds accrue — a zero-length session has no segment to itemise at all.
  await new Promise(resolve => setTimeout(resolve, 2200));

  const checkout = await (await fetch(`${base}/api/tables/1/checkout`, { method: "POST", headers, body: JSON.stringify({ paymentMethod: "cash" }) })).json();
  const bill = checkout.bill;

  assert.ok(Array.isArray(bill.rateSegments) && bill.rateSegments.length >= 1, "the bill must carry the rate breakdown the receipt prints");
  const segment = bill.rateSegments[0];
  assert.equal(segment.rateSatang, 9000, "the rule's rate, resolved against the clock rather than frozen at open");
  assert.equal(segment.ruleName, "โปรทั้งวัน", "the receipt names which rate it was");
  assert.ok(segment.from && segment.to, "each line needs its own time range");

  // The snapshot must keep the BASE rate, or the stretches no rule covers could never be priced.
  assert.equal(bill.pricingSnapshot.pricingMode, "SEGMENTED");
  assert.notEqual(bill.pricingSnapshot.rateSatang, 9000, "the snapshot keeps the profile's base rate, not the rule's");

  // Whatever the segments say, they must add up to what the customer is charged for table time.
  const segmentTotal = bill.rateSegments.reduce((sum, item) => sum + item.satang, 0);
  assert.equal(segmentTotal, bill.tableChargeSatang, "the printed lines must sum to the table charge");
});
