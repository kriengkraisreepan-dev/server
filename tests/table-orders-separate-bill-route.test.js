const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

// End-to-end coverage of POST /api/tables/:id/orders/{billing-preview,create-bill}: a customer
// orders drinks mid-session and pays for them right away, while the table itself keeps playing
// untouched (status, relay, session) — then the table's normal final checkout still works.

test("pays for a table's confirmed order separately without closing the table, then checks out normally", async t => {
  const root = path.resolve(__dirname, "..");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-table-orders-split-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const port = 39900 + Math.floor(Math.random() * 90), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["index.js"], { cwd: root, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir }, stdio: "ignore" });
  t.after(() => child.kill());
  for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${base}/api/state`)).status === 401) break; } catch {} await new Promise(resolve => setTimeout(resolve, 50)); if (i === 99) throw new Error("server did not start"); }

  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "123456789" }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0], headers = { Cookie: cookie, "Content-Type": "application/json" };

  let response = await fetch(`${base}/api/tables/1/start`, { method: "POST", headers, body: "{}" });
  assert.equal(response.status, 200);

  response = await fetch(`${base}/api/pos-orders`, { method: "POST", headers, body: JSON.stringify({ orderType: "TABLE", tableId: 1 }) });
  assert.equal(response.status, 201);
  const order = (await response.json()).order;
  response = await fetch(`${base}/api/pos-orders/${order.id}/items`, { method: "POST", headers, body: JSON.stringify({ productId: "p-water", quantity: 2 }) });
  assert.equal(response.status, 200);
  response = await fetch(`${base}/api/pos-orders/${order.id}/confirm`, { method: "POST", headers, body: "{}" });
  assert.equal(response.status, 200);

  response = await fetch(`${base}/api/tables/1/orders/billing-preview`, { method: "POST", headers, body: JSON.stringify({ orderIds: [order.id] }) });
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.equal(preview.total, 30);

  response = await fetch(`${base}/api/tables/1/orders/create-bill`, { method: "POST", headers, body: JSON.stringify({ orderIds: [order.id], paymentMethod: "cash" }) });
  assert.equal(response.status, 200);
  const created = await response.json();
  assert.equal(created.bill.partialOrdersOnly, true);
  assert.equal(created.bill.playAmount, 0);
  assert.equal(created.bill.total, 30);

  // Billing it again must be rejected — it's already billed.
  response = await fetch(`${base}/api/tables/1/orders/create-bill`, { method: "POST", headers, body: JSON.stringify({ orderIds: [order.id], paymentMethod: "cash" }) });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "ORDER_NOT_AVAILABLE");

  // Confirming payment for this partial bill must NOT close the table.
  response = await fetch(`${base}/api/payments/${created.payment.id}/confirm`, { method: "POST", headers, body: "{}" });
  assert.equal(response.status, 200);

  response = await fetch(`${base}/api/state`, { headers });
  const state = await response.json();
  const table = state.tables.find(item => item.id === 1);
  assert.equal(table.status, "playing");

  // The normal final checkout must still work — no DUPLICATE_BILL from the interim bill.
  response = await fetch(`${base}/api/tables/1/checkout`, { method: "POST", headers, body: JSON.stringify({ paymentMethod: "cash" }) });
  assert.equal(response.status, 200);
  const finalBill = (await response.json()).bill;
  assert.equal(finalBill.partialOrdersOnly, false);
  assert.deepEqual(finalBill.posOrderIds, []); // the drinks order was already billed separately, not swept in again

  response = await fetch(`${base}/api/state`, { headers });
  const finalState = await response.json();
  const finalTable = finalState.tables.find(item => item.id === 1);
  assert.equal(finalTable.status, "awaiting_payment");
});
