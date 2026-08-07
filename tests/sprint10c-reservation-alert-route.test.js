const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-sprint10c-alert-route-"));
const port = 37000 + Math.floor(Math.random() * 1000);
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

(async () => {
  try {
    await waitForServer();
    let response = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "123456789" })
    });
    assert.strictEqual(response.status, 200);
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie, "login must issue a session cookie");

    response = await fetch(`${base}/api/reservation-alerts/pending`, {
      headers: { Cookie: cookie }
    });
    assert.notStrictEqual(response.status, 404, "GET /api/reservation-alerts/pending must not reach the final 404 handler");
    assert.strictEqual(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /application\/json/);
    assert.deepStrictEqual(await response.json(), [], "no pending alerts must return an empty JSON array");

    response = await fetch(`${base}/api/reservations`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: "Pending Alert Route Test",
        phone: "0800000011",
        reservationDate: "2000-01-01",
        reservationTime: "10:00",
        amountSatang: 10000,
        paymentMethod: "cash",
        paymentConfirmed: true
      })
    });
    assert.strictEqual(response.status, 201);
    const created = await response.json();

    response = await fetch(`${base}/api/reservations`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: "Pending Alert Defer Test",
        phone: "0800000012",
        reservationDate: "2000-01-01",
        reservationTime: "10:05",
        amountSatang: 10000,
        paymentMethod: "cash",
        paymentConfirmed: true
      })
    });
    assert.strictEqual(response.status, 201);
    const deferredCandidate = await response.json();

    response = await fetch(`${base}/api/reservation-alerts/pending`, {
      headers: { Cookie: cookie }
    });
    assert.strictEqual(response.status, 200);
    const alerts = await response.json();
    assert.ok(Array.isArray(alerts), "pending alerts must always be a JSON array");
    const openAlert = alerts.find(item => item.reservationId === created.reservation.id);
    const deferAlert = alerts.find(item => item.reservationId === deferredCandidate.reservation.id);
    assert.ok(openAlert, "a due reservation must be returned as an alert");
    assert.ok(deferAlert, "a second due reservation must be returned as an alert");

    response = await fetch(`${base}/api/reservations/${openAlert.reservationId}/open-now`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: openAlert.version })
    });
    assert.strictEqual(response.status, 200, "Open Now must succeed on the first request with the alert version");

    response = await fetch(`${base}/api/reservations/${deferAlert.reservationId}/defer`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: deferAlert.version })
    });
    assert.strictEqual(response.status, 200, "Defer must succeed on the first request with the alert version");

    const source = fs.readFileSync(path.join(root, "index.js"), "utf8");
    const routeIndex = source.indexOf('app.get("/api/reservation-alerts/pending"');
    const notFoundIndex = source.indexOf('app.use("/api", (req, res) => res.status(404)');
    assert.ok(routeIndex >= 0, "the exact pending-alert route must be registered");
    assert.ok(notFoundIndex > routeIndex, "the pending-alert route must be registered before the final API 404 handler");

    console.log("Sprint 10C reservation alert route integration test passed");
  } finally {
    child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
