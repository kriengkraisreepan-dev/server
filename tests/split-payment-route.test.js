const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

// End-to-end coverage of a split-payment table checkout: cash + transfer together in one bill,
// confirming both legs before the table actually closes, and the reports payment-method breakdown
// correctly attributing revenue to BOTH methods instead of collapsing to a single "mixed" bucket.
test("splits a table checkout into cash + transfer, table stays open until both legs are confirmed, reports attribute both methods", async t => {
  const root = path.resolve(__dirname, "..");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-split-payment-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const port = 39700 + Math.floor(Math.random() * 90), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["index.js"], { cwd: root, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir }, stdio: "ignore" });
  t.after(() => child.kill());
  for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${base}/api/state`)).status === 401) break; } catch {} await new Promise(resolve => setTimeout(resolve, 50)); if (i === 99) throw new Error("server did not start"); }

  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "123456789" }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0], headers = { Cookie: cookie, "Content-Type": "application/json" };

  let response = await fetch(`${base}/api/tables/1/start`, { method: "POST", headers, body: "{}" });
  assert.equal(response.status, 200);
  response = await fetch(`${base}/api/state`, { headers });
  const table = (await response.json()).tables.find(item => item.id === 1);

  // Reject a mismatched split before creating anything.
  response = await fetch(`${base}/api/table-sessions/${table.runtimeSessionId}/create-bill`, { method: "POST", headers, body: JSON.stringify({ splitPayments: [{ method: "cash", amount: 0.5 }, { method: "transfer", amount: 999 }] }) });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "SPLIT_PAYMENT_MISMATCH");

  // Fetch the actual amount due, then split it 40/60 across cash and transfer.
  response = await fetch(`${base}/api/table-sessions/${table.runtimeSessionId}/billing-preview`, { headers });
  const due = (await response.json()).preview.breakdown.total;
  const cashAmount = Number((due * 0.4).toFixed(2)), transferAmount = Number((due - cashAmount).toFixed(2));

  response = await fetch(`${base}/api/table-sessions/${table.runtimeSessionId}/create-bill`, { method: "POST", headers, body: JSON.stringify({ splitPayments: [{ method: "cash", amount: cashAmount }, { method: "transfer", amount: transferAmount }] }) });
  assert.equal(response.status, 200);
  const created = await response.json();
  assert.equal(created.bill.paymentMethod, "mixed");
  assert.equal(created.payments.length, 2);

  // Confirm only the first leg — the bill (and table, already "awaiting_payment" since checkout
  // started) must NOT be released/settled yet; the table must not have been freed early.
  response = await fetch(`${base}/api/payments/${created.payments[0].id}/confirm`, { method: "POST", headers });
  assert.equal(response.status, 200);
  let confirmed = await response.json();
  assert.equal(confirmed.bill.status, "awaiting_payment");
  response = await fetch(`${base}/api/state`, { headers });
  assert.equal((await response.json()).tables.find(item => item.id === 1).status, "awaiting_payment", "table must not be released until the SECOND leg is also confirmed");

  // Confirm the second leg — NOW the bill settles and the table closes.
  response = await fetch(`${base}/api/payments/${created.payments[1].id}/confirm`, { method: "POST", headers });
  assert.equal(response.status, 200);
  confirmed = await response.json();
  assert.equal(confirmed.bill.status, "paid");
  response = await fetch(`${base}/api/state`, { headers });
  assert.equal((await response.json()).tables.find(item => item.id === 1).status, "free", "table released once the bill is fully settled");

  // Reports must attribute BOTH methods, not collapse to one "mixed" bucket.
  const today = new Date().toISOString().slice(0, 10);
  response = await fetch(`${base}/api/reports/analytics?type=month&period=${today.slice(0, 7)}`, { headers });
  assert.equal(response.status, 200);
  const analytics = await response.json();
  const cashEntry = analytics.paymentMethodBreakdown.find(entry => entry.method === "cash");
  const transferEntry = analytics.paymentMethodBreakdown.find(entry => entry.method === "transfer");
  assert.ok(cashEntry && cashEntry.amount >= cashAmount - 0.01, "cash leg counted in the breakdown");
  assert.ok(transferEntry && transferEntry.amount >= transferAmount - 0.01, "transfer leg counted in the breakdown");
});
