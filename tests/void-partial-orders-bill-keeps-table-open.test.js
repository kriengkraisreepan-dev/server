const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

// Regression: voiding a partial "pay for these drinks now, keep playing" bill used to run the same
// side effects as voiding a table's final bill — cancelSession() (which zeroes finalChargeSatang)
// and releaseTable() (which wipes startTime/memberId/items). The table went to "free" and the play
// time accrued so far was destroyed while the customers were still on the table.
//
// DELETE /api/bills/:id must undo a partial bill and hand its POS orders back, and leave the
// running session completely alone.

test("voiding a partial table-orders bill leaves the table playing and the clock intact", async t => {
  const root = path.resolve(__dirname, "..");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-void-partial-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const port = 39700 + Math.floor(Math.random() * 90), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["index.js"], { cwd: root, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir }, stdio: "ignore" });
  t.after(() => child.kill());
  for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${base}/api/state`)).status === 401) break; } catch {} await new Promise(resolve => setTimeout(resolve, 50)); if (i === 99) throw new Error("server did not start"); }

  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "123456789" }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0], headers = { Cookie: cookie, "Content-Type": "application/json" };
  const tableState = async () => (await (await fetch(`${base}/api/state`, { headers })).json()).tables.find(item => item.id === 1);

  let response = await fetch(`${base}/api/tables/1/start`, { method: "POST", headers, body: "{}" });
  assert.equal(response.status, 200);
  const opened = await tableState();
  assert.equal(opened.status, "playing");

  response = await fetch(`${base}/api/pos-orders`, { method: "POST", headers, body: JSON.stringify({ orderType: "TABLE", tableId: 1 }) });
  assert.equal(response.status, 201);
  const order = (await response.json()).order;
  response = await fetch(`${base}/api/pos-orders/${order.id}/items`, { method: "POST", headers, body: JSON.stringify({ productId: "p-water", quantity: 2 }) });
  assert.equal(response.status, 200);
  response = await fetch(`${base}/api/pos-orders/${order.id}/confirm`, { method: "POST", headers, body: "{}" });
  assert.equal(response.status, 200);

  response = await fetch(`${base}/api/tables/1/orders/create-bill`, { method: "POST", headers, body: JSON.stringify({ orderIds: [order.id], paymentMethod: "cash" }) });
  assert.equal(response.status, 200);
  const created = await response.json();
  assert.equal(created.bill.partialOrdersOnly, true);

  response = await fetch(`${base}/api/bills/${created.bill.id}`, { method: "DELETE", headers, body: JSON.stringify({ reason: "คิดเงินผิดรายการ" }) });
  assert.equal(response.status, 200);
  const voided = await response.json();
  assert.equal(voided.bill.status, "void");
  assert.deepEqual(voided.restoredPosOrderIds, [order.id]); // the drinks go back to being unbilled

  // The whole point: the table is untouched.
  const after = await tableState();
  assert.equal(after.status, "playing");
  assert.equal(after.startTime, opened.startTime); // clock never restarted
  assert.ok(after.runtimeSessionId, "the running session must survive the void");

  // Voiding a combined bill cancels its POS orders outright and returns their stock. That is the
  // pre-existing behaviour for a table's final bill, which a partial bill simply inherits — the
  // drinks do NOT go back onto the tab. Whether that is the right call when the table is still
  // playing is a separate product question; pinning it here means the session fix above cannot
  // quietly change it either way.
  response = await fetch(`${base}/api/pos-orders/${order.id}`, { headers });
  assert.equal(response.status, 200);
  const restoredOrder = (await response.json()).order;
  assert.equal(restoredOrder.status, "CANCELLED");
  assert.equal(restoredOrder.billingStatus, "VOIDED");

  // The table still checks out normally afterwards — table time only, no leftover DUPLICATE_BILL.
  response = await fetch(`${base}/api/tables/1/checkout`, { method: "POST", headers, body: JSON.stringify({ paymentMethod: "cash" }) });
  assert.equal(response.status, 200);
  const finalBill = (await response.json()).bill;
  assert.equal(finalBill.partialOrdersOnly, false);
  assert.deepEqual(finalBill.posOrderIds, []);
});
