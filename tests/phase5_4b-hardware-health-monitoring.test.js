const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { HardwareHealthMonitoringService } = require("../services/hardware-health-monitoring-service");

function device(id = "hw-1", controller = "LRC-A", relayCount = 4) {
  return { id, deviceId: controller, deviceName: controller, ipAddress: `192.168.1.${id === "hw-1" ? 10 : 11}`, port: 80, apiKey: "secret-device-key", relayCount, firmwareVersion: "1.1.0", status: "UNKNOWN", consecutiveFailures: 0 };
}
function repository(devices) {
  return { devices, list() { return this.devices; }, findById(id) { return this.devices.find(x => x.id === id) || null; }, update(id, fields) { const item = this.findById(id); Object.assign(item, fields); return item; } };
}
function healthy(overrides = {}) { return { status: "HEALTHY", deviceId: "LRC-A", firmwareVersion: "1.1.0", uptimeSeconds: 1804, wifiConnected: true, rssi: -50, relayCount: 4, freeHeapBytes: 233504, ...overrides }; }
function harness(responses, devices = [device()]) {
  let index = 0, calls = 0, clock = Date.parse("2026-08-04T00:00:00.000Z");
  const logs = [], audits = [], repo = repository(devices);
  const driver = { async health(record, options) { calls++; assert.equal(options.timeoutMs, 5000); const response = responses[Math.min(index++, responses.length - 1)]; if (response instanceof Error) throw response; return typeof response === "function" ? response(record) : response; } };
  const monitor = new HardwareHealthMonitoringService({ repository: repo, driver, now: () => new Date(clock), log: (level, event, data) => logs.push({ level, event, data }), audit: (event, actor, data) => audits.push({ event, actor, data }) });
  return { monitor, repo, logs, audits, calls: () => calls, advance: ms => { clock += ms; } };
}
function failure(code) { return Object.assign(new Error(code), { code }); }

test("valid health marks ONLINE, records metrics and clears failures", async () => {
  const h = harness([healthy()]); h.repo.devices[0].status = "OFFLINE"; h.repo.devices[0].consecutiveFailures = 2;
  const result = await h.monitor.check("hw-1");
  assert.equal(result.status, "ONLINE"); assert.equal(result.consecutiveFailures, 0); assert.ok(result.lastSeen); assert.ok(result.lastCheckedAt);
  assert.equal(result.apiKey, undefined); assert.equal(result.apiKeyMasked, "••••••••");
  assert.equal(result.health.rssi, -50); assert.equal(result.health.uptimeSeconds, 1804); assert.equal(result.health.latencyMs, 0);
  assert.ok(h.audits.some(x => x.event === "HARDWARE_STATUS_RECOVERED"));
});

test("one and two timeouts remain TIMEOUT; third consecutive failure becomes OFFLINE", async () => {
  const h = harness([failure("DEVICE_TIMEOUT")]);
  assert.equal((await h.monitor.check("hw-1")).status, "TIMEOUT");
  assert.equal((await h.monitor.check("hw-1")).status, "TIMEOUT");
  const third = await h.monitor.check("hw-1");
  assert.equal(third.status, "OFFLINE"); assert.equal(third.consecutiveFailures, 3); assert.equal(third.lastErrorCode, "DEVICE_TIMEOUT");
});

test("offline device recovers automatically and refreshes lastSeen", async () => {
  const h = harness([failure("DEVICE_TIMEOUT"), failure("DEVICE_TIMEOUT"), failure("DEVICE_TIMEOUT"), healthy()]);
  await h.monitor.check("hw-1"); await h.monitor.check("hw-1"); await h.monitor.check("hw-1"); h.advance(1000);
  const recovered = await h.monitor.check("hw-1");
  assert.equal(recovered.status, "ONLINE"); assert.equal(recovered.consecutiveFailures, 0); assert.equal(recovered.lastSeen, "2026-08-04T00:00:01.000Z");
});

test("identity, relay count, invalid response, HTTP and disconnected Wi-Fi are categorized fail-closed", async () => {
  for (const [response, code] of [[healthy({ deviceId: "LRC-WRONG" }), "DEVICE_ID_MISMATCH"], [healthy({ relayCount: 8 }), "RELAY_COUNT_MISMATCH"], [{ nope: true }, "DEVICE_RESPONSE_INVALID"], [failure("DEVICE_API_ERROR"), "DEVICE_HTTP_ERROR"], [healthy({ wifiConnected: false }), "WIFI_DISCONNECTED"]]) {
    const h = harness([response]); const result = await h.monitor.check("hw-1");
    assert.equal(result.lastErrorCode, code); assert.notEqual(result.status, "ONLINE");
    assert.equal(result.deviceId, "LRC-A"); assert.equal(result.relayCount, 4);
  }
});

test("a timeout on one device does not affect another", async () => {
  const devices = [device("hw-1", "LRC-A"), device("hw-2", "LRC-B")];
  const h = harness([record => { if (record.id === "hw-1") throw failure("DEVICE_TIMEOUT"); return healthy({ deviceId: "LRC-B" }); }], devices);
  const results = await h.monitor.checkAll();
  assert.equal(results[0].status, "TIMEOUT"); assert.equal(results[1].status, "ONLINE");
});

test("same-device checks deduplicate and checkAll limits concurrency to four", async () => {
  const devices = Array.from({ length: 9 }, (_, i) => device(`hw-${i + 1}`, `LRC-${i + 1}`));
  let active = 0, maximum = 0, calls = 0;
  const driver = { health: async record => { calls++; active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 4)); active--; return healthy({ deviceId: record.deviceId }); } };
  const monitor = new HardwareHealthMonitoringService({ repository: repository(devices), driver });
  const first = monitor.check("hw-1"), second = monitor.check("hw-1"); await Promise.all([first, second]); assert.equal(calls, 1);
  await monitor.checkAll(); assert.ok(maximum <= 4);
});

test("manual refresh is immediate but enforces three-second cooldown", async () => {
  const h = harness([healthy()]);
  await h.monitor.check("hw-1", { manual: true });
  await assert.rejects(h.monitor.check("hw-1", { manual: true }), error => error.code === "HEALTH_CHECK_COOLDOWN");
  h.advance(3000); await h.monitor.check("hw-1", { manual: true }); assert.equal(h.calls(), 2);
});

test("timer starts once, supports feature flag and stops cleanly", () => {
  const h = harness([healthy()]); assert.equal(h.monitor.start(), true); assert.equal(h.monitor.start(), false); assert.ok(h.monitor.timer); assert.equal(h.monitor.stop(), true); assert.equal(h.monitor.timer, null); assert.equal(h.monitor.stop(), false);
  const disabled = new HardwareHealthMonitoringService({ repository: h.repo, driver: {}, enabled: false }); assert.equal(disabled.start(), false);
});

test("stale status is derived after 90 seconds without altering identity", () => {
  const h = harness([healthy()]); h.repo.devices[0].status = "ONLINE"; h.repo.devices[0].lastCheckedAt = "2026-08-03T23:58:29.000Z";
  const result = h.monitor.publicDevice(h.repo.devices[0]); assert.equal(result.status, "STALE"); assert.equal(result.deviceId, "LRC-A");
});

test("a REPLACED_ARCHIVED device is never re-probed, so background polling cannot resurrect it as ONLINE", async () => {
  const h = harness([healthy()]); h.repo.devices[0].status = "REPLACED_ARCHIVED"; h.repo.devices[0].replacementDeviceId = "hw-2";
  const result = await h.monitor.check("hw-1");
  assert.equal(result.status, "REPLACED_ARCHIVED");
  assert.equal(h.calls(), 0, "the driver should never be contacted for an archived device");
});

test("health monitoring issues no device commands of its own and logs contain no secrets", async () => {
  const h = harness([failure("DEVICE_TIMEOUT")]); await h.monitor.check("hw-1");
  const source = fs.readFileSync(path.join(__dirname, "../services/hardware-health-monitoring-service.js"), "utf8");
  // The guarantee is that this service only ever READS from the controller. Relay recovery after a
  // restart does command the box, but it goes through the injected reconcileRelays hook into
  // HardwareService, which owns the table mapping and the coil-stagger — none of that belongs to a
  // poller. Asserting on the driver methods used says exactly that, where the old substring
  // blacklist also banned the word "restart" and so banned describing the thing being recovered from.
  const driverMethods = [...new Set([...source.matchAll(/this\.driver\.(\w+)/g)].map(match => match[1]))];
  assert.deepEqual(driverMethods, ["health"], `health monitoring may only call driver.health(), saw: ${driverMethods.join(", ")}`);
  assert.doesNotMatch(source, /\/api\/v1\//, "endpoint paths belong in the driver");
  const serialized = JSON.stringify({ logs: h.logs, audits: h.audits });
  assert.doesNotMatch(serialized, /secret-device-key|X-Lucky-Device-Key|Setup Code|password|HMAC/i);
});

test("a controller restart is detected from its uptime going backwards, and reported", async () => {
  const h = harness([healthy({ uptimeSeconds: 3600 }), healthy({ uptimeSeconds: 12 })]);
  await h.monitor.check("hw-1");
  assert.equal(h.audits.some(x => x.event === "HARDWARE_CONTROLLER_RESTARTED"), false, "the first reading has nothing to compare against");
  await h.monitor.check("hw-1");
  const restart = h.audits.find(x => x.event === "HARDWARE_CONTROLLER_RESTARTED");
  assert.ok(restart, "a controller whose uptime dropped from 3600s to 12s restarted");
  assert.equal(restart.data.previousUptimeSeconds, 3600);
  assert.equal(restart.data.uptimeSeconds, 12);
});

test("normal uptime growth is never mistaken for a restart", async () => {
  const h = harness([healthy({ uptimeSeconds: 3600 }), healthy({ uptimeSeconds: 3660 })]);
  await h.monitor.check("hw-1");
  await h.monitor.check("hw-1");
  assert.equal(h.audits.some(x => x.event === "HARDWARE_CONTROLLER_RESTARTED"), false);
});

test("every successful poll asks HardwareService to reconcile the relays, with the reason why", async () => {
  const reconciled = [];
  const h = harness([healthy({ uptimeSeconds: 3600 }), healthy({ uptimeSeconds: 5 })]);
  h.monitor.reconcileRelays = async (deviceId, options) => { reconciled.push({ deviceId, ...options }); return { corrected: [], failed: [] }; };
  await h.monitor.check("hw-1");
  await h.monitor.check("hw-1");
  assert.deepEqual(reconciled.map(item => item.reason), ["RECONNECTED", "CONTROLLER_RESTARTED"]);
  assert.deepEqual([...new Set(reconciled.map(item => item.deviceId))], ["hw-1"]);
});

test("a failing reconcile is logged but never fails the health check itself", async () => {
  const h = harness([healthy()]);
  h.monitor.reconcileRelays = async () => { throw Object.assign(new Error("boom"), { code: "RELAY_READ_FAILED" }); };
  assert.equal((await h.monitor.check("hw-1")).status, "ONLINE");
  assert.ok(h.logs.some(x => x.event === "HARDWARE_RELAY_RECONCILE_FAILED"));
});

test("an unreachable controller is never asked to reconcile", async () => {
  let called = false;
  const h = harness([failure("DEVICE_TIMEOUT")]);
  h.monitor.reconcileRelays = async () => { called = true; return { corrected: [], failed: [] }; };
  await h.monitor.check("hw-1");
  assert.equal(called, false);
});

test("UI exposes health details and polling lifecycle without color-only status", () => {
  const app = fs.readFileSync(path.join(__dirname, "../public/js/app.js"), "utf8");
  assert.match(app, /setInterval\(pollHardwareHealth,15000\)/); assert.match(app, /if\(hardwareTimer\|\|page!=="hardware"/);
  assert.match(app, /stopHardwarePolling/); assert.match(app, /ออนไลน์ล่าสุด/); assert.match(app, /ตรวจล่าสุด/); assert.match(app, /ล้มเหลวต่อเนื่อง/);
  for (const label of ["กำลังตรวจสอบ", "ออนไลน์", "ออฟไลน์", "ไม่ได้ตรวจมานาน", "หมดเวลาติดต่อ", "ข้อมูลอุปกรณ์ไม่ตรง"]) assert.match(app, new RegExp(label));
  assert.match(app, /health\/check/); assert.doesNotMatch(app.split(/\r?\n/).find(line => line.startsWith("async function pollHardwareHealth")) || "", /relay|alloff/i);
});

test("routes preserve authentication, background cleanup and existing workflows", () => {
  const index = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
  assert.match(index, /\/api\/hardware\/health\/check-all", requireHardwareAdmin/);
  assert.match(index, /\/health\/check", requireHardwareAdmin/);
  assert.match(index, /hardwareHealthMonitoringService\.stop\(\)/);
  assert.match(index, /LUCKY_HARDWARE_HEALTH_POLLING/);
});
