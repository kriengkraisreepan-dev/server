const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

// End-to-end coverage of the seat-table (bar/lounge tab) routes: a customer sits down without
// playing a billiard table, orders drinks across two rounds, and pays for the whole tab as one
// standalone bill — separate from any table bill, with the usual role split (STAFF can order,
// only CASHIER/OWNER/MANAGER can take payment).

test("seat orders park a tab until it is billed as one standalone, products-only bill", async t => {
  const root = path.resolve(__dirname, "..");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-seat-tab-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const port = 39990 + Math.floor(Math.random() * 90), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["index.js"], { cwd: root, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir }, stdio: "ignore" });
  t.after(() => child.kill());
  for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${base}/api/state`)).status === 401) break; } catch {} await new Promise(resolve => setTimeout(resolve, 50)); if (i === 99) throw new Error("server did not start"); }

  async function login(username, password) {
    const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
    assert.equal(response.status, 200, `login as ${username}`);
    return { Cookie: response.headers.get("set-cookie").split(";")[0], "Content-Type": "application/json" };
  }

  const ownerHeaders = await login("admin", "123456789");

  let response = await fetch(`${base}/api/users`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ username: "staff1", password: "staff12345", displayName: "พนักงาน", role: "STAFF" }) });
  assert.equal(response.status, 201);
  response = await fetch(`${base}/api/users`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ username: "cashier1", password: "cashier12345", displayName: "แคชเชียร์", role: "CASHIER" }) });
  assert.equal(response.status, 201);
  const staffHeaders = await login("staff1", "staff12345");
  const cashierHeaders = await login("cashier1", "cashier12345");

  // A STAFF member cannot create a seat zone (Settings-gated).
  response = await fetch(`${base}/api/seats`, { method: "POST", headers: staffHeaders, body: JSON.stringify({ name: "โต๊ะบาร์ 1" }) });
  assert.equal(response.status, 403);

  response = await fetch(`${base}/api/seats`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ name: "โต๊ะบาร์ 1" }) });
  assert.equal(response.status, 201);
  const seat = (await response.json()).seats[0];
  assert.equal(seat.status, "free");

  // STAFF can take the order (same as a table order), but confirming is CASHIER/OWNER/MANAGER
  // only — and, same as any other POS order, a CASHIER may only confirm a draft it created itself
  // (no POS_ORDER_VIEW_ALL); OWNER/MANAGER can confirm anyone's. The first confirmed order is what
  // occupies the seat even though it was never "started".
  response = await fetch(`${base}/api/pos-orders`, { method: "POST", headers: staffHeaders, body: JSON.stringify({ orderType: "SEAT", seatId: seat.id }) });
  assert.equal(response.status, 201);
  const firstOrder = (await response.json()).order;
  response = await fetch(`${base}/api/pos-orders/${firstOrder.id}/items`, { method: "POST", headers: staffHeaders, body: JSON.stringify({ productId: "p-water", quantity: 1 }) });
  assert.equal(response.status, 200);
  response = await fetch(`${base}/api/pos-orders/${firstOrder.id}/confirm`, { method: "POST", headers: staffHeaders, body: "{}" });
  assert.equal(response.status, 403);
  response = await fetch(`${base}/api/pos-orders/${firstOrder.id}/confirm`, { method: "POST", headers: cashierHeaders, body: "{}" });
  assert.equal(response.status, 403); // a different user's draft — CASHIER has no view_all
  response = await fetch(`${base}/api/pos-orders/${firstOrder.id}/confirm`, { method: "POST", headers: ownerHeaders, body: "{}" });
  assert.equal(response.status, 200);

  response = await fetch(`${base}/api/state`, { headers: staffHeaders });
  let state = await response.json();
  assert.equal(state.seatTables.find(s => s.id === seat.id).status, "occupied");
  assert.equal(state.seatTables.find(s => s.id === seat.id).openOrderCount, 1);

  // STAFF can label who's sitting here — same permission as starting the tab (POS_ORDER_CREATE),
  // not the Settings-gated permanent rename.
  response = await fetch(`${base}/api/seats/${seat.id}/nickname`, { method: "PATCH", headers: staffHeaders, body: JSON.stringify({ nickname: "  คุณเอ  " }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).seats.find(s => s.id === seat.id).nickname, "คุณเอ");

  // A second round on the same seat before it is paid.
  response = await fetch(`${base}/api/pos-orders`, { method: "POST", headers: staffHeaders, body: JSON.stringify({ orderType: "SEAT", seatId: seat.id }) });
  assert.equal(response.status, 201);
  const secondOrder = (await response.json()).order;
  response = await fetch(`${base}/api/pos-orders/${secondOrder.id}/items`, { method: "POST", headers: staffHeaders, body: JSON.stringify({ productId: "p-cola", quantity: 2 }) });
  assert.equal(response.status, 200);
  response = await fetch(`${base}/api/pos-orders/${secondOrder.id}/confirm`, { method: "POST", headers: ownerHeaders, body: "{}" });
  assert.equal(response.status, 200);

  // STAFF cannot take payment — that stays CASHIER/OWNER/MANAGER only, same as a table checkout.
  response = await fetch(`${base}/api/seats/${seat.id}/billing-preview`, { headers: staffHeaders });
  assert.equal(response.status, 403);

  response = await fetch(`${base}/api/seats/${seat.id}/billing-preview`, { headers: cashierHeaders });
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.equal(preview.orderIds.length, 2);
  assert.equal(preview.total, 15 + 50); // p-water 15 + 2x p-cola 25, per the seeded product prices

  // Cannot remove an occupied seat while its tab is still open.
  response = await fetch(`${base}/api/seats/${seat.id}`, { method: "DELETE", headers: ownerHeaders });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "SEAT_IN_USE");

  response = await fetch(`${base}/api/seats/${seat.id}/create-bill`, { method: "POST", headers: cashierHeaders, body: JSON.stringify({ paymentMethod: "cash" }) });
  assert.equal(response.status, 200);
  const created = await response.json();
  assert.equal(created.bill.saleSource, "SEAT");
  assert.equal(created.bill.playAmount, 0);
  assert.equal(created.bill.total, 65);
  assert.ok(created.payment);

  // Mirrors a table: the seat sits "awaiting_payment" (not "free") until this payment is actually
  // confirmed below — its nickname is still there too.
  response = await fetch(`${base}/api/state`, { headers: cashierHeaders });
  const midState = await response.json();
  const pending = midState.seatTables.find(s => s.id === seat.id);
  assert.equal(pending.status, "awaiting_payment");
  assert.equal(pending.nickname, "คุณเอ");

  response = await fetch(`${base}/api/payments/${created.payment.id}/confirm`, { method: "POST", headers: cashierHeaders, body: "{}" });
  assert.equal(response.status, 200);

  response = await fetch(`${base}/api/state`, { headers: cashierHeaders });
  state = await response.json();
  const freed = state.seatTables.find(s => s.id === seat.id);
  assert.equal(freed.status, "free");
  assert.equal(freed.openOrderCount, 0);
  assert.equal(freed.nickname, null); // cleared once the tab is paid off, not left for the next customer

  // Billing again with nothing open must fail cleanly.
  response = await fetch(`${base}/api/seats/${seat.id}/billing-preview`, { headers: cashierHeaders });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "NO_ORDERS_SELECTED");

  // Now the seat can be removed since it is free with no open orders.
  response = await fetch(`${base}/api/seats/${seat.id}`, { method: "DELETE", headers: ownerHeaders });
  assert.equal(response.status, 200);
});

// A checkout that was started (bill + pending payment created) but never finished — the dialog was
// closed, the browser refreshed, the customer walked off — previously left the seat and its bill
// stuck forever with no button anywhere to either finish or back out of it.
test("a stuck awaiting_payment seat bill can be resumed and paid, or cancelled and reopened", async t => {
  const root = path.resolve(__dirname, "..");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-seat-reopen-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const port = 39890 + Math.floor(Math.random() * 90), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["index.js"], { cwd: root, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir }, stdio: "ignore" });
  t.after(() => child.kill());
  for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${base}/api/state`)).status === 401) break; } catch {} await new Promise(resolve => setTimeout(resolve, 50)); if (i === 99) throw new Error("server did not start"); }

  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "123456789" }) });
  const headers = { Cookie: login.headers.get("set-cookie").split(";")[0], "Content-Type": "application/json" };

  async function openSeatWithOneUnpaidBill() {
    let response = await fetch(`${base}/api/seats`, { method: "POST", headers, body: JSON.stringify({ name: "โต๊ะบาร์ทดสอบ" }) });
    const seat = (await response.json()).seats.slice(-1)[0];
    response = await fetch(`${base}/api/pos-orders`, { method: "POST", headers, body: JSON.stringify({ orderType: "SEAT", seatId: seat.id }) });
    const order = (await response.json()).order;
    await fetch(`${base}/api/pos-orders/${order.id}/items`, { method: "POST", headers, body: JSON.stringify({ productId: "p-water", quantity: 1 }) });
    await fetch(`${base}/api/pos-orders/${order.id}/confirm`, { method: "POST", headers, body: "{}" });
    response = await fetch(`${base}/api/seats/${seat.id}/create-bill`, { method: "POST", headers, body: JSON.stringify({ paymentMethod: "cash" }) });
    const created = await response.json();
    return { seat, order, bill: created.bill, payment: created.payment };
  }

  // Path 1: resume — find the pending payment via GET /api/bills/:id and confirm it, same as a
  // fresh checkout would.
  let { seat, bill } = await openSeatWithOneUnpaidBill();
  let response = await fetch(`${base}/api/bills/${bill.id}`, { headers });
  assert.equal(response.status, 200);
  const details = await response.json();
  const pendingPayment = details.payments.find(p => p.status === "pending");
  assert.ok(pendingPayment, "the bill must still have a resumable pending payment");
  response = await fetch(`${base}/api/payments/${pendingPayment.id}/confirm`, { method: "POST", headers, body: "{}" });
  assert.equal(response.status, 200);
  response = await fetch(`${base}/api/state`, { headers });
  assert.equal((await response.json()).seatTables.find(s => s.id === seat.id).status, "free");

  // Path 2: cancel — POST /api/bills/:id/reopen voids the stuck bill and puts the seat (with its
  // order) back exactly as it was, ready to be billed again.
  ({ seat, bill } = await openSeatWithOneUnpaidBill());
  response = await fetch(`${base}/api/bills/${bill.id}/reopen`, { method: "POST", headers, body: "{}" });
  assert.equal(response.status, 200);
  response = await fetch(`${base}/api/state`, { headers });
  const reopened = (await response.json()).seatTables.find(s => s.id === seat.id);
  assert.equal(reopened.status, "occupied");
  assert.equal(reopened.openOrderCount, 1); // the order is billable again, not lost
  response = await fetch(`${base}/api/bills/${bill.id}`, { headers });
  assert.equal((await response.json()).bill.status, "void");
  // Reopening an already-void bill (double-click, or resumed via another tab) must fail cleanly
  // rather than silently reopening the seat a second time.
  response = await fetch(`${base}/api/bills/${bill.id}/reopen`, { method: "POST", headers, body: "{}" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "BILL_NOT_AWAITING_PAYMENT");
});
