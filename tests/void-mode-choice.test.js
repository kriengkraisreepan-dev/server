const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

// Voiding a bill that carried products has to say what happened to the goods. "Void" alone leaves
// both stock and revenue undecided, and the old single behaviour (always restock) silently
// inflated inventory whenever the customer had actually consumed the drinks.
//
//   CANCEL_RESTORE_STOCK — goods never handed over: back on the shelf, nothing charged.
//   RETURN_TO_TAB        — goods handed over, still owed: un-billed, stock stays deducted.
//   CANCEL_KEEP_STOCK    — goods consumed, not charged (comp/waste): stock stays deducted.

async function boot(t, prefix) {
  const root = path.resolve(__dirname, "..");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const port = 39400 + Math.floor(Math.random() * 90), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["index.js"], { cwd: root, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir }, stdio: "ignore" });
  t.after(() => child.kill());
  for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${base}/api/state`)).status === 401) break; } catch {} await new Promise(resolve => setTimeout(resolve, 50)); if (i === 99) throw new Error("server did not start"); }
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "123456789" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  return { base, headers: { Cookie: cookie, "Content-Type": "application/json" } };
}

// Opens table 1, sells 2 waters on a separate mid-session bill, and reports the stock before it.
// The seeded p-water carries no stock at all, so give it a real tracked quantity first — otherwise
// every stock assertion below would pass trivially by comparing 0 to 0.
async function sellDrinksOnPartialBill(base, headers) {
  await fetch(`${base}/api/products/p-water`, { method: "PATCH", headers, body: JSON.stringify({ trackStock: true }) });
  const received = await fetch(`${base}/api/products/p-water/stock/receive`, { method: "POST", headers, body: JSON.stringify({ quantity: 10, reason: "ตั้งต้นสำหรับเทสต์" }) });
  assert.equal(received.status, 200, "test setup: stock receive must succeed");
  await fetch(`${base}/api/tables/1/start`, { method: "POST", headers, body: "{}" });
  const stockBefore = (await (await fetch(`${base}/api/products/p-water`, { headers })).json()).stockQuantity;
  assert.equal(stockBefore, 10, "test setup: the baseline stock must be real, not zero");
  const order = (await (await fetch(`${base}/api/pos-orders`, { method: "POST", headers, body: JSON.stringify({ orderType: "TABLE", tableId: 1 }) })).json()).order;
  await fetch(`${base}/api/pos-orders/${order.id}/items`, { method: "POST", headers, body: JSON.stringify({ productId: "p-water", quantity: 2 }) });
  await fetch(`${base}/api/pos-orders/${order.id}/confirm`, { method: "POST", headers, body: "{}" });
  const created = await (await fetch(`${base}/api/tables/1/orders/create-bill`, { method: "POST", headers, body: JSON.stringify({ orderIds: [order.id], paymentMethod: "cash" }) })).json();
  return { order, bill: created.bill, stockBefore, stockAfterSale: stockBefore - 2 };
}

const stockOf = async (base, headers) => (await (await fetch(`${base}/api/products/p-water`, { headers })).json()).stockQuantity;
const orderOf = async (base, headers, id) => (await (await fetch(`${base}/api/pos-orders/${id}`, { headers })).json()).order;

test("RETURN_TO_TAB un-bills the drinks without touching stock, and the final checkout charges them", async t => {
  const { base, headers } = await boot(t, "lucky-void-mode-tab-");
  const sale = await sellDrinksOnPartialBill(base, headers);
  assert.equal(await stockOf(base, headers), sale.stockAfterSale);

  const response = await fetch(`${base}/api/bills/${sale.bill.id}`, { method: "DELETE", headers, body: JSON.stringify({ reason: "คิดเงินผิดวิธี", voidMode: "RETURN_TO_TAB" }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).bill.voidMode, "RETURN_TO_TAB");

  const order = await orderOf(base, headers, sale.order.id);
  assert.equal(order.status, "CONFIRMED", "the sale is still live, only its bill went away");
  assert.equal(order.billingStatus, "UNBILLED");
  assert.equal(await stockOf(base, headers), sale.stockAfterSale, "the drinks left the shelf and must stay deducted");

  // The whole point: the customer still pays for them, on the final bill.
  const finalBill = (await (await fetch(`${base}/api/tables/1/checkout`, { method: "POST", headers, body: JSON.stringify({ paymentMethod: "cash" }) })).json()).bill;
  assert.deepEqual(finalBill.posOrderIds, [sale.order.id]);
  assert.equal(finalBill.foodAmount, 30);
});

test("CANCEL_RESTORE_STOCK puts the drinks back on the shelf and charges nothing", async t => {
  const { base, headers } = await boot(t, "lucky-void-mode-restock-");
  const sale = await sellDrinksOnPartialBill(base, headers);

  const response = await fetch(`${base}/api/bills/${sale.bill.id}`, { method: "DELETE", headers, body: JSON.stringify({ reason: "กดผิด ลูกค้ายังไม่ได้รับของ", voidMode: "CANCEL_RESTORE_STOCK" }) });
  assert.equal(response.status, 200);

  const order = await orderOf(base, headers, sale.order.id);
  assert.equal(order.status, "CANCELLED");
  assert.equal(await stockOf(base, headers), sale.stockBefore, "never handed over, so the stock comes back");

  const finalBill = (await (await fetch(`${base}/api/tables/1/checkout`, { method: "POST", headers, body: JSON.stringify({ paymentMethod: "cash" }) })).json()).bill;
  assert.deepEqual(finalBill.posOrderIds, []);
});

test("CANCEL_KEEP_STOCK writes the drinks off — consumed, not charged, not restocked", async t => {
  const { base, headers } = await boot(t, "lucky-void-mode-comp-");
  const sale = await sellDrinksOnPartialBill(base, headers);

  const response = await fetch(`${base}/api/bills/${sale.bill.id}`, { method: "DELETE", headers, body: JSON.stringify({ reason: "แถมให้ลูกค้า", voidMode: "CANCEL_KEEP_STOCK" }) });
  assert.equal(response.status, 200);

  const order = await orderOf(base, headers, sale.order.id);
  assert.equal(order.status, "CANCELLED");
  assert.equal(await stockOf(base, headers), sale.stockAfterSale, "the drinks were consumed — stock must NOT come back");

  const finalBill = (await (await fetch(`${base}/api/tables/1/checkout`, { method: "POST", headers, body: JSON.stringify({ paymentMethod: "cash" }) })).json()).bill;
  assert.deepEqual(finalBill.posOrderIds, []);
});

test("RETURN_TO_TAB is refused once the table has closed and reopened for the next customer", async t => {
  const { base, headers } = await boot(t, "lucky-void-mode-reopened-");
  const sale = await sellDrinksOnPartialBill(base, headers);

  // Close the table out, then open it again — a different session on the same table.
  const checkout = await (await fetch(`${base}/api/tables/1/checkout`, { method: "POST", headers, body: JSON.stringify({ paymentMethod: "cash" }) })).json();
  await fetch(`${base}/api/payments/${checkout.payment.id}/confirm`, { method: "POST", headers, body: "{}" });
  const reopened = await fetch(`${base}/api/tables/1/start`, { method: "POST", headers, body: "{}" });
  assert.equal(reopened.status, 200);

  // There IS an open session on table 1 now, but it belongs to somebody else. Refusing this is the
  // whole reason the check matches the session id and not just the table.
  const response = await fetch(`${base}/api/bills/${sale.bill.id}`, { method: "DELETE", headers, body: JSON.stringify({ reason: "ลองย้ายกลับ", voidMode: "RETURN_TO_TAB" }) });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "TAB_NO_LONGER_OPEN");

  // Refused before anything was mutated — the bill must still be intact and voidable another way.
  const bill = (await (await fetch(`${base}/api/bills/${sale.bill.id}`, { headers })).json()).bill;
  assert.notEqual(bill.status, "void");
});

test("an unknown void mode is rejected and changes nothing", async t => {
  const { base, headers } = await boot(t, "lucky-void-mode-bad-");
  const sale = await sellDrinksOnPartialBill(base, headers);
  const response = await fetch(`${base}/api/bills/${sale.bill.id}`, { method: "DELETE", headers, body: JSON.stringify({ reason: "x", voidMode: "WHATEVER" }) });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "INVALID_VOID_MODE");
  const bill = (await (await fetch(`${base}/api/bills/${sale.bill.id}`, { headers })).json()).bill;
  assert.notEqual(bill.status, "void");
});
