const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

// Covers the manual Relay button's post-ON cooldown (index.js's RELAY_MANUAL_TOGGLE_COOLDOWN_MS):
// turning a relay OFF within RELAY_MANUAL_TOGGLE_COOLDOWN_MS of turning it ON must be rejected to
// protect the physical relay contacts from rapid ON/OFF cycling — see /api/relay/:tableId.

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const close = server => new Promise(resolve => server.close(resolve));

test("manual relay toggle rejects OFF within the cooldown window, then allows it once elapsed", async t => {
  const esp = http.createServer((req, res) => {
    let body = ""; req.on("data", chunk => body += chunk); req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/v1/health") return res.end(JSON.stringify({ success: true, uptimeSeconds: 10, rssi: -40, freeHeapBytes: 90000, relayCount: 4 }));
      if (req.url === "/api/v1/device") return res.end(JSON.stringify({ success: true, deviceId: "LRC-TEST", firmwareVersion: "1.0.0", apiVersion: "1", hardwareStandard: "LHS-1.0" }));
      if (req.url === "/api/v1/config/relay") return res.end(JSON.stringify({ success: true, relayCount: body ? JSON.parse(body).relayCount : 4 }));
      if (req.url === "/api/v1/relays") return res.end(JSON.stringify({ success: true, relayCount: 4, relays: [] }));
      return res.end(JSON.stringify({ success: true }));
    });
  });
  await new Promise(resolve => esp.listen(0, "127.0.0.1", resolve));
  const espPort = esp.address().port, dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-relay-cooldown-")), appPort = 39000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ["index.js"], { cwd: path.resolve(__dirname, ".."), env: { ...process.env, PORT: String(appPort), LUCKY_DATA_DIR: dataDir }, stdio: "ignore" });
  t.after(async () => { child.kill(); await close(esp); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${appPort}`;
  for (let i = 0; i < 50; i += 1) { try { if ((await fetch(`${base}/api/state`)).status === 401) break; } catch {} await pause(100); }

  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "123456789" }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0], headers = { Cookie: cookie, "Content-Type": "application/json" };

  let response = await fetch(`${base}/api/hardware/devices`, { method: "POST", headers, body: JSON.stringify({ deviceName: "Cooldown Test Controller", ipAddress: "127.0.0.1", port: espPort, apiKey: "top-secret", deviceType: "RELAY_CONTROLLER" }) });
  assert.equal(response.status, 201);
  const device = (await response.json()).device;
  response = await fetch(`${base}/api/hardware/tables/1/relay`, { method: "PUT", headers, body: JSON.stringify({ deviceId: device.id, relayChannel: 1 }) });
  assert.equal(response.status, 200);

  // Turn ON — starts the cooldown clock.
  response = await fetch(`${base}/api/relay/1`, { method: "POST", headers, body: JSON.stringify({ state: "on" }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).table.relayState, "on");

  // Immediately try OFF — must be rejected, relay must remain reported ON.
  response = await fetch(`${base}/api/relay/1`, { method: "POST", headers, body: JSON.stringify({ state: "off" }) });
  assert.equal(response.status, 429);
  const rejected = await response.json();
  assert.equal(rejected.error, "RELAY_COOLDOWN_ACTIVE");
  assert.ok(rejected.retryAfterMs > 0 && rejected.retryAfterMs <= 5000);
  response = await fetch(`${base}/api/state`, { headers });
  assert.equal((await response.json()).tables.find(table => table.id === 1).relayState, "on");

  // Once the cooldown has elapsed, OFF must succeed.
  await pause(5100);
  response = await fetch(`${base}/api/relay/1`, { method: "POST", headers, body: JSON.stringify({ state: "off" }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).table.relayState, "off");
});
