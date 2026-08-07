const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-sprint10a-route-"));
const port = 36000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["index.js"], {
  cwd: root,
  env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir },
  stdio: "ignore"
});

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/state`);
      if (response.status === 401) return;
    } catch {}
    await pause(100);
  }
  throw new Error("Test server did not start");
}
async function json(response) {
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  return response.json();
}

(async () => {
  try {
    await waitForServer();

    let response = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "123456789" })
    });
    assert.strictEqual(response.status, 200);
    const cookie = response.headers.get("set-cookie");
    assert.ok(cookie, "login must issue a session cookie");

    response = await fetch(`${base}/api/reservations`, {
      method: "POST",
      headers: {
        Cookie: cookie.split(";")[0],
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        customerName: "Reservation Route Test",
        phone: "0800000010",
        reservationDate: "2030-01-15",
        reservationTime: "18:00",
        amountSatang: 10000,
        paymentMethod: "cash",
        paymentConfirmed: true
      })
    });

    assert.notStrictEqual(response.status, 404, "POST /api/reservations must not reach the final 404 handler");
    assert.strictEqual(response.status, 201);
    const created = await json(response);
    assert.ok(created.reservation?.id);
    assert.strictEqual(created.reservation.status, "BOOKED");
    assert.strictEqual(created.deposit.status, "AVAILABLE");

    const source = fs.readFileSync(path.join(root, "index.js"), "utf8");
    const routeIndex = source.indexOf('app.post("/api/reservations"');
    const notFoundIndex = source.indexOf('app.use("/api", (req, res) => res.status(404)');
    assert.ok(routeIndex >= 0, "the exact POST /api/reservations route must be registered");
    assert.ok(notFoundIndex > routeIndex, "the reservation route must be registered before the final API 404 handler");

    console.log("Sprint 10A reservation POST route integration test passed");
  } finally {
    child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
