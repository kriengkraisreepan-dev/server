const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

// A checkout that got as far as "bill + pending payment created" but was never finished (dialog
// closed, browser refreshed, customer walked off) used to leave a table card with nothing on it but
// a dead "รอยืนยันการชำระเงิน" label — no way to either finish collecting the money or give up and
// reopen the table. POST /api/bills/:id/reopen (used by the table card's "ยกเลิก" button) is the
// general "give up on this stuck checkout" action; resuming payment reuses the ordinary
// GET /api/bills/:id + POST /api/payments/:id/confirm pair every checkout already goes through.

test("a stuck awaiting_payment table bill can be resumed and paid, or cancelled and reopened", async t => {
  const root = path.resolve(__dirname, "..");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-awaiting-payment-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const port = 39790 + Math.floor(Math.random() * 90), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["index.js"], { cwd: root, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir }, stdio: "ignore" });
  t.after(() => child.kill());
  for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${base}/api/state`)).status === 401) break; } catch {} await new Promise(resolve => setTimeout(resolve, 50)); if (i === 99) throw new Error("server did not start"); }

  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "123456789" }) });
  const headers = { Cookie: login.headers.get("set-cookie").split(";")[0], "Content-Type": "application/json" };

  async function openTableWithOneUnpaidBill(tableId) {
    let response = await fetch(`${base}/api/tables/${tableId}/start`, { method: "POST", headers, body: "{}" });
    assert.equal(response.status, 200);
    const table = await response.json();
    response = await fetch(`${base}/api/table-sessions/${table.runtimeSessionId}/create-bill`, { method: "POST", headers, body: JSON.stringify({ paymentMethod: "cash" }) });
    return (await response.json());
  }

  // Path 1: resume — the pending payment is still sitting there, findable via GET /api/bills/:id.
  let created = await openTableWithOneUnpaidBill(1);
  let response = await fetch(`${base}/api/state`, { headers });
  let table = (await response.json()).tables.find(t => t.id === 1);
  assert.equal(table.status, "awaiting_payment");

  response = await fetch(`${base}/api/bills/${created.bill.id}`, { headers });
  const pendingPayment = (await response.json()).payments.find(p => p.status === "pending");
  assert.ok(pendingPayment, "the bill must still have a resumable pending payment");
  response = await fetch(`${base}/api/payments/${pendingPayment.id}/confirm`, { method: "POST", headers, body: "{}" });
  assert.equal(response.status, 200);
  response = await fetch(`${base}/api/state`, { headers });
  assert.equal((await response.json()).tables.find(t => t.id === 1).status, "free");

  // Path 2: cancel — POST /api/bills/:id/reopen voids the stuck bill and reactivates the session,
  // putting the table right back to "playing" with its clock and confirmed orders intact.
  created = await openTableWithOneUnpaidBill(2);
  response = await fetch(`${base}/api/bills/${created.bill.id}/reopen`, { method: "POST", headers, body: "{}" });
  assert.equal(response.status, 200);
  response = await fetch(`${base}/api/state`, { headers });
  table = (await response.json()).tables.find(t => t.id === 2);
  assert.equal(table.status, "playing");
  response = await fetch(`${base}/api/bills/${created.bill.id}`, { headers });
  assert.equal((await response.json()).bill.status, "void");

  // Reopening an already-void bill (double-click, or resumed via another tab) must fail cleanly
  // rather than silently reactivating the session a second time.
  response = await fetch(`${base}/api/bills/${created.bill.id}/reopen`, { method: "POST", headers, body: "{}" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "BILL_NOT_AWAITING_PAYMENT");
});
