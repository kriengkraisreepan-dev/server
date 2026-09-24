const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

// End-to-end coverage of the shared-shop-computer controls:
//   - the product screen needs the password re-entered (server-enforced, not just hidden in the UI)
//   - every Void needs the password
//   - cancelling a table/seat from its card leaves a "pending_review" bill instead of vanishing
//   - Bill History can filter by that status

async function boot(t, prefix) {
  const root = path.resolve(__dirname, "..");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const port = 39580 + Math.floor(Math.random() * 90), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["index.js"], { cwd: root, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir }, stdio: "ignore" });
  t.after(() => child.kill());
  for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${base}/api/state`)).status === 401) break; } catch {} await new Promise(resolve => setTimeout(resolve, 50)); if (i === 99) throw new Error("server did not start"); }
  const login = async (username, password) => { const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) }); assert.equal(response.status, 200, `login ${username}`); return { Cookie: response.headers.get("set-cookie").split(";")[0], "Content-Type": "application/json" }; };
  const owner = await login("admin", "123456789");
  const call = (headers, method, url, payload) => fetch(`${base}${url}`, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const addUser = async (username, role) => { assert.equal((await call(owner, "POST", "/api/users", { username, password: `${username}12345`, displayName: username, role })).status, 201); return login(username, `${username}12345`); };
  return { base, owner, call, addUser };
}

test("the product screen's edits need the password re-entered, and leaving it ends that", async t => {
  const { owner, call, addUser } = await boot(t, "lucky-reauth-products-");

  let response = await call(owner, "PATCH", "/api/products/p-water", { price: 20 });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "REAUTH_REQUIRED", "logged in is not enough on a shared computer");
  // Reading is untouched — the POS screen lists products all day without any re-auth.
  assert.equal((await call(owner, "GET", "/api/products?pageSize=10")).status, 200);

  response = await call(owner, "POST", "/api/auth/elevate", { scope: "products", password: "nope" });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "WRONG_PASSWORD");

  response = await call(owner, "POST", "/api/auth/elevate", { scope: "products", password: "123456789" });
  assert.equal(response.status, 200);
  assert.ok((await response.json()).elevatedUntil);
  response = await call(owner, "PATCH", "/api/products/p-water", { price: 20 });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).price, 20);
  assert.equal((await call(owner, "POST", "/api/product-categories", { name: "ทดสอบสิทธิ์" })).status, 201);

  // Leaving the screen drops it immediately, so nobody can walk back in on the owner's ten minutes.
  assert.equal((await call(owner, "DELETE", "/api/auth/elevate?scope=products")).status, 200);
  assert.equal((await call(owner, "PATCH", "/api/products/p-water", { price: 25 })).status, 403);

  // A CASHIER has no product-management rights, so there is nothing to step up into.
  const cashier = await addUser("cashier1", "CASHIER");
  assert.equal((await call(cashier, "POST", "/api/auth/elevate", { scope: "products", password: "cashier112345" })).status, 403);
  assert.equal((await call(owner, "POST", "/api/auth/elevate", { scope: "bogus", password: "123456789" })).status, 400);
});

test("every Void needs the account password, and voiding an old bill never touches the game now on that table", async t => {
  const { owner, call } = await boot(t, "lucky-reauth-void-");

  // Customer A plays and pays.
  let response = await call(owner, "POST", "/api/tables/1/start", {});
  const sessionA = (await response.json()).runtimeSessionId;
  const paid = await (await call(owner, "POST", `/api/table-sessions/${sessionA}/create-bill`, { paymentMethod: "cash" })).json();
  assert.equal((await call(owner, "POST", `/api/payments/${paid.payment.id}/confirm`, {})).status, 200);
  // Customer B is now playing on the same table.
  response = await call(owner, "POST", "/api/tables/1/start", {});
  const sessionB = (await response.json()).runtimeSessionId;

  response = await call(owner, "DELETE", `/api/bills/${paid.bill.id}`, { reason: "ทดสอบ" });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "WRONG_PASSWORD", "no password, no Void");
  response = await call(owner, "DELETE", `/api/bills/${paid.bill.id}`, { reason: "ทดสอบ", password: "wrong" });
  assert.equal(response.status, 403);
  assert.equal((await (await call(owner, "GET", `/api/bills/${paid.bill.id}`)).json()).bill.status, "paid", "a refused Void changes nothing");

  response = await call(owner, "DELETE", `/api/bills/${paid.bill.id}`, { reason: "คิดเงินผิด", password: "123456789" });
  assert.equal(response.status, 200);
  const state = await (await call(owner, "GET", "/api/state")).json();
  const table = state.tables.find(item => item.id === 1);
  assert.equal(table.status, "playing", "customer B's game must survive a Void of customer A's bill");
  assert.equal(table.runtimeSessionId, sessionB);
});

test("cancelling a table from its card leaves a pending_review bill with the time and products on it", async t => {
  const { owner, call, addUser } = await boot(t, "lucky-review-table-");
  const staff = await addUser("staff1", "STAFF");

  await call(owner, "POST", "/api/auth/elevate", { scope: "products", password: "123456789" });
  await call(owner, "PATCH", "/api/products/p-water", { trackStock: true });
  await call(owner, "POST", "/api/products/p-water/stock/receive", { quantity: 10, reason: "ตั้งต้น" });

  await call(owner, "POST", "/api/tables/2/start", {});
  const order = (await (await call(owner, "POST", "/api/pos-orders", { orderType: "TABLE", tableId: 2 })).json()).order;
  await call(owner, "POST", `/api/pos-orders/${order.id}/items`, { productId: "p-water", quantity: 3 });
  await call(owner, "POST", `/api/pos-orders/${order.id}/confirm`, {});

  // STAFF can cancel a table (as before) — the review bill is what makes that safe.
  let response = await call(staff, "POST", "/api/tables/2/cancel", { reason: "ลูกค้าเปลี่ยนใจ" });
  assert.equal(response.status, 200);
  const review = (await response.json()).reviewBill;
  assert.equal(review.status, "pending_review");
  assert.equal(review.reviewReason, "ลูกค้าเปลี่ยนใจ");
  assert.equal(review.reviewSource, "TABLE_CANCEL");
  assert.equal(review.foodAmount, 45, "3 waters at ฿15 are on the record, not lost");
  assert.ok(review.playAmount > 0, "the time used is on the record too");
  assert.deepEqual(review.posOrderIds, [order.id]);

  const state = await (await call(owner, "GET", "/api/state")).json();
  assert.equal(state.tables.find(item => item.id === 2).status, "free");
  assert.equal(state.posOrders.find(item => item.id === order.id).billingStatus, "BILLED", "the order is accounted for, not orphaned");
  // Nothing was restocked at cancel time — that is the reviewer's call.
  assert.equal((await (await call(owner, "GET", "/api/products/p-water")).json()).stockQuantity, 7);
  // Not revenue: reports count paid bills only.
  const summary = await (await call(owner, "GET", `/api/reports/summary?date=${new Date().toISOString().slice(0, 10)}`)).json();
  assert.equal(summary.billCount, 0);

  // Bill History can filter down to exactly the bills awaiting review.
  const filtered = await (await call(owner, "GET", "/api/bills?status=pending_review")).json();
  assert.deepEqual(filtered.items.map(item => item.id), [review.id]);

  // The owner reviews it and closes it out with Void — goods never left, so back on the shelf.
  response = await call(owner, "DELETE", `/api/bills/${review.id}`, { reason: "ตรวจแล้ว ลูกค้าไม่ได้ดื่ม", voidMode: "CANCEL_RESTORE_STOCK", password: "123456789" });
  assert.equal(response.status, 200);
  assert.equal((await (await call(owner, "GET", "/api/products/p-water")).json()).stockQuantity, 10);

  // A table already awaiting payment is paid or backed out of from its card, not cancelled.
  await call(owner, "POST", "/api/tables/3/start", {});
  const s3 = (await (await call(owner, "GET", "/api/state")).json()).tables.find(item => item.id === 3).runtimeSessionId;
  await call(owner, "POST", `/api/table-sessions/${s3}/create-bill`, { paymentMethod: "cash" });
  response = await call(owner, "POST", "/api/tables/3/cancel", { reason: "x" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "TABLE_AWAITING_PAYMENT");
});

test("cancelling an occupied seat from its card turns the whole tab into a pending_review bill and frees the seat", async t => {
  const { owner, call, addUser } = await boot(t, "lucky-review-seat-");
  const staff = await addUser("staff2", "STAFF");

  const seat = (await (await call(owner, "POST", "/api/seats", { name: "โต๊ะบาร์ 1" })).json()).seats[0];
  for (const [productId, quantity] of [["p-water", 1], ["p-cola", 2]]) {
    const order = (await (await call(owner, "POST", "/api/pos-orders", { orderType: "SEAT", seatId: seat.id })).json()).order;
    await call(owner, "POST", `/api/pos-orders/${order.id}/items`, { productId, quantity });
    await call(owner, "POST", `/api/pos-orders/${order.id}/confirm`, {});
  }
  await call(owner, "PATCH", `/api/seats/${seat.id}/nickname`, { nickname: "คุณเอ" });

  let response = await call(staff, "POST", `/api/seats/${seat.id}/cancel`, { reason: "ลูกค้าเดินออกไป" });
  assert.equal(response.status, 200, "same rule as a table card: staff can cancel, the owner reviews");
  const body = await response.json();
  assert.equal(body.reviewBill.status, "pending_review");
  assert.equal(body.reviewBill.reviewSource, "SEAT_CANCEL");
  assert.equal(body.reviewBill.seatId, seat.id);
  assert.equal(body.reviewBill.total, 65);
  assert.equal(body.reviewBill.memberName, "คุณเอ", "the nickname identifies whose tab it was on the review record");
  assert.equal(body.seat.status, "free");
  assert.equal(body.seat.nickname, null);
  assert.equal(body.seat.openOrderCount, 0);

  // Nothing left to cancel on a free seat.
  response = await call(owner, "POST", `/api/seats/${seat.id}/cancel`, { reason: "x" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "SEAT_NOT_OCCUPIED");
});
