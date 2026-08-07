const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const close = server => new Promise(resolve => server.close(resolve));

test("hardware API proxies ESP32, enforces role, redacts key, and maps tables", async t => {
  const received = [];
  const esp = http.createServer((req, res) => {
    let body = ""; req.on("data", chunk => body += chunk); req.on("end", () => {
      received.push({ url: req.url, method: req.method, key: req.headers["x-lucky-device-key"], body });
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/v1/health") return res.end(JSON.stringify({ success: true, uptimeSeconds: 10, rssi: -40, freeHeapBytes: 90000, relayCount: 4 }));
      if (req.url === "/api/v1/device") return res.end(JSON.stringify({ success: true, deviceId: "LRC-TEST", firmwareVersion: "1.0.0", apiVersion: "1", hardwareStandard: "LHS-1.0" }));
      if (req.url === "/api/v1/config/relay") return res.end(JSON.stringify({ success: true, relayCount: body ? JSON.parse(body).relayCount : 4 }));
      if (req.url === "/api/v1/relays") return res.end(JSON.stringify({ success: true, relayCount: 4, relays: [] }));
      return res.end(JSON.stringify({ success: true }));
    });
  });
  await listen(esp);
  const espPort = esp.address().port, dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-hardware-api-")), appPort = 38000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ["index.js"], { cwd: path.resolve(__dirname, ".."), env: { ...process.env, PORT: String(appPort), LUCKY_DATA_DIR: dataDir }, stdio: "ignore" });
  t.after(async () => { child.kill(); await close(esp); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${appPort}`;
  for (let i=0;i<50;i+=1) { try { if ((await fetch(`${base}/api/state`)).status === 401) break; } catch {} await pause(100); }
  const login = await fetch(`${base}/api/auth/login`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({username:"admin",password:"123456789"}) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0], headers = { Cookie:cookie, "Content-Type":"application/json" };
  let response = await fetch(`${base}/api/hardware/devices`, { method:"POST", headers, body:JSON.stringify({deviceName:"Test Controller",ipAddress:"127.0.0.1",port:espPort,apiKey:"top-secret",deviceType:"RELAY_CONTROLLER"}) });
  assert.equal(response.status, 201);
  const created = (await response.json()).device;
  assert.equal(created.apiKey, undefined);
  assert.equal(created.apiKeyMasked, "••••••••");
  response = await fetch(`${base}/api/hardware/tables/1/relay`, { method:"PUT", headers, body:JSON.stringify({deviceId:created.id,relayChannel:1}) });
  assert.equal(response.status, 200);
  response = await fetch(`${base}/api/hardware/devices/${created.id}/relays/1/state`, { method:"POST", headers, body:JSON.stringify({state:true}) });
  assert.equal(response.status, 200);
  const command = received.find(item => item.url === "/api/v1/relays/1/state");
  assert.equal(command.key, "top-secret");
  assert.equal(JSON.parse(command.body).state, "ON");
  response = await fetch(`${base}/api/users`, { method:"POST", headers, body:JSON.stringify({username:"hardware_cashier",displayName:"Hardware Cashier",role:"CASHIER",password:"cashier-test-123"}) });
  assert.equal(response.status, 201);
  const cashierLogin = await fetch(`${base}/api/auth/login`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({username:"hardware_cashier",password:"cashier-test-123"}) });
  assert.equal(cashierLogin.status, 200);
  const cashierCookie = cashierLogin.headers.get("set-cookie").split(";")[0];
  response = await fetch(`${base}/api/hardware/devices`, { headers:{Cookie:cashierCookie} });
  assert.equal(response.status, 403);
  const persisted = fs.readFileSync(path.join(dataDir, "hardware-devices.json"), "utf8");
  assert.doesNotMatch(persisted, /top-secret|apiKey/);
  assert.match(persisted, /secretId/);
  assert.equal(JSON.stringify(created).includes("top-secret"), false);
});

test("Hardware Manager UI contains protected navigation and polling cleanup", () => {
  const root = path.resolve(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  const js = fs.readFileSync(path.join(root, "public/js/app.js"), "utf8");
  assert.ok(html.indexOf('data-page="hardware"') < html.indexOf('data-page="settings"'));
  assert.match(js, /setInterval\(pollHardwareHealth,15000\)/);
  assert.match(js, /function stopHardwarePolling\(\).*clearInterval/s);
  assert.match(js, /if\(button\.dataset\.page!=="hardware"\)stopHardwarePolling/);
  assert.doesNotMatch(js, /localStorage\.[^(]*\([^)]*apiKey/i);
  assert.match(js, /\/api\/hardware\/devices/);
});
