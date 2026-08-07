const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { HardwareRepository } = require("../repositories/hardware-repository");
const { HardwareService } = require("../services/hardware-service");
const { HardwareWifiProvisioningService } = require("../services/hardware-wifi-provisioning-service");

function repositoryFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-phase3-"));
  const repository = new HardwareRepository(path.join(directory, "hardware-devices.json"));
  const device = repository.create({ deviceName: "Main", deviceId: "LRC-UNIQUE000001", ipAddress: "192.168.1.50", port: 80, apiKey: "bootstrap-key", relayCount: 4, status: "ONLINE" });
  return { directory, repository, device };
}

test("unique key enrollment stages, challenges, commits, and never exposes or logs the generated key", async t => {
  const x = repositoryFixture(); t.after(() => fs.rmSync(x.directory, { recursive: true, force: true }));
  const calls = [], audits = [];
  const driver = {
    stageDeviceKey: async (device, transitionId, newKey) => calls.push({ op: "stage", transitionId, oldKey: device.apiKey, newKey }),
    verifyDevice: async device => (calls.push({ op: "verify", key: device.apiKey }), { verified: true, deviceId: x.device.deviceId }),
    commitDeviceKey: async (device, transitionId) => calls.push({ op: "commit", transitionId, key: device.apiKey }),
    rollbackDeviceKey: async () => calls.push({ op: "rollback" })
  };
  const service = new HardwareService(x.repository, driver, { tables: () => [], saveTables: () => {}, audit: (event, actor, data) => audits.push({ event, actor, data }) });
  const result = await service.enrollUniqueDeviceKey(x.device.id, "owner");
  assert.equal(result.enrolled, true);
  assert.equal(result.device.apiKey, undefined);
  assert.equal(result.device.hasApiKey, true);
  assert.deepEqual(calls.map(call => call.op), ["stage", "verify", "commit"]);
  assert.ok(Buffer.from(calls[0].newKey, "base64url").length >= 32);
  assert.equal(x.repository.findById(x.device.id).apiKey, calls[0].newKey);
  assert.equal(JSON.stringify(audits).includes(calls[0].newKey), false);
});

test("key enrollment failure rolls back and preserves committed backend key", async t => {
  const x = repositoryFixture(); t.after(() => fs.rmSync(x.directory, { recursive: true, force: true }));
  let rollbacks = 0;
  const driver = {
    stageDeviceKey: async () => ({ success: true }),
    verifyDevice: async () => { throw Object.assign(Error("bad proof"), { code: "DEVICE_VERIFY_PROOF_INVALID" }); },
    rollbackDeviceKey: async () => { rollbacks += 1; }
  };
  const service = new HardwareService(x.repository, driver, { tables: () => [], saveTables: () => {}, audit: () => {} });
  await assert.rejects(() => service.enrollUniqueDeviceKey(x.device.id, "owner"), { code: "DEVICE_VERIFY_PROOF_INVALID" });
  assert.equal(x.repository.findById(x.device.id).apiKey, "bootstrap-key");
  assert.ok(rollbacks >= 1);
});

test("Wi-Fi provisioning rejects active Relay and never sends candidate or all-off", async () => {
  const calls = [];
  const device = { id: "hw-1", deviceId: "LRC-1", apiKey: "unique", ipAddress: "192.168.1.50", port: 80 };
  const driver = {
    relays: async () => ({ relays: [{ channel: 1, state: "OFF" }, { channel: 2, state: "ON" }] }),
    stageWifiCandidate: async () => calls.push("stage"),
    allOff: async () => calls.push("allOff")
  };
  const service = new HardwareWifiProvisioningService({
    hardwareService: { getRequired: () => device }, discoveryService: {}, driver
  });
  await assert.rejects(() => service.start("hw-1", { ssid: "New", password: "secret", confirmedSafe: true }, "owner"), { code: "RELAY_SAFE_STATE_CONFLICT" });
  assert.deepEqual(calls, []);
});

test("successful Wi-Fi transition rediscovers Device ID, verifies HMAC path, commits, then updates IP", async () => {
  const calls = [], device = { id: "hw-1", deviceId: "LRC-1", apiKey: "unique", ipAddress: "192.168.1.50", port: 80 };
  let transition;
  const hardwareService = {
    getRequired: () => device,
    updateDiscoveredLocation: (id, found) => calls.push({ op: "update", id, ip: found.ipAddress })
  };
  const discoveryService = {
    start: () => ({ id: "d-1", state: "COMPLETED" }),
    get: () => ({ id: "d-1", state: "COMPLETED", results: [{ deviceId: "LRC-1", ipAddress: "192.168.1.99", port: 80, firmwareVersion: "1.2.0", apiVersion: "1", hardwareStandard: "LHS-1.0", relayCount: 4, health: {} }] })
  };
  const driver = {
    relays: async () => ({ relays: [{ channel: 1, state: "OFF" }] }),
    stageWifiCandidate: async (_device, transitionId) => { transition = transitionId; calls.push({ op: "stage" }); },
    verifyDevice: async candidate => calls.push({ op: "verify", ip: candidate.ipAddress }),
    wifiStatus: async () => ({ state: "WAITING_FOR_COMMIT", transitionId: transition }),
    commitWifi: async () => calls.push({ op: "commit" }),
    rollbackWifi: async () => calls.push({ op: "rollback" })
  };
  const service = new HardwareWifiProvisioningService({ hardwareService, discoveryService, driver, wait: () => Promise.resolve() });
  const started = await service.start("hw-1", { ssid: "New", password: "secret", confirmedSafe: true }, "owner");
  for (let index = 0; index < 20 && service.get(started.id).state !== "COMPLETED"; index += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(service.get(started.id).state, "COMPLETED", JSON.stringify(service.get(started.id)));
  assert.deepEqual(calls.map(call => call.op), ["stage", "verify", "commit", "update"]);
});

test("Firmware Phase 3 contract is non-blocking, transactional, bootstrap-blocked, and credential-redacted", () => {
  const root = path.resolve(__dirname, "..");
  const api = fs.readFileSync(path.join(root, "firmware/src/api/ApiServer.cpp"), "utf8");
  const config = fs.readFileSync(path.join(root, "firmware/src/config/ConfigService.cpp"), "utf8");
  const wifi = fs.readFileSync(path.join(root, "firmware/src/wifi/WifiProvisioningService.cpp"), "utf8");
  const wifiHeader = fs.readFileSync(path.join(root, "firmware/src/wifi/WifiProvisioningService.h"), "utf8");
  const driver = fs.readFileSync(path.join(root, "drivers/relay-controller-driver.js"), "utf8");
  const ui = fs.readFileSync(path.join(root, "public/js/app.js"), "utf8");
  const safeJson = fs.readFileSync(path.join(root, "infrastructure/safe-json-file.js"), "utf8");
  for (const route of ["/api/v1/device/key/candidate", "/api/v1/device/key/commit", "/api/v1/device/key/rollback", "/api/v1/wifi/networks", "/api/v1/wifi/provisioning/status", "/api/v1/wifi/provisioning/candidate", "/api/v1/wifi/provisioning/commit", "/api/v1/wifi/provisioning/rollback"]) assert.ok(api.includes(route), route);
  assert.match(api, /UNIQUE_DEVICE_KEY_REQUIRED/);
  assert.match(api, /RELAY_SAFE_STATE_CONFLICT/);
  assert.match(config, /Interrupted key rotation rolled back/);
  assert.match(config, /Interrupted Wi-Fi transition rolled back/);
  assert.match(wifiHeader, /kCandidateConnectionTimeoutMs\s*=\s*30000/);
  assert.match(wifiHeader, /kCommitTimeoutMs\s*=\s*90000/);
  assert.doesNotMatch(wifi, /delay\s*\(/);
  assert.doesNotMatch(wifi, /turnAllOff|turnOff|turnOn/);
  assert.match(wifiHeader, /scanRequested_\{false\}/);
  assert.match(wifiHeader, /kScanMaxMsPerChannel\s*=\s*120/);
  assert.match(wifi, /scanRequested_\s*=\s*true/);
  assert.match(wifi, /scanNetworks\(true,\s*true,\s*false,\s*kScanMaxMsPerChannel\)/);
  assert.match(driver, /wifiNetworks[\s\S]*timeoutMs:\s*15000/);
  assert.match(ui, /กำลังค้นหาเครือข่าย กรุณารอสักครู่/);
  assert.match(safeJson, /0o600/);
  assert.match(ui, /สร้างรหัสอุปกรณ์เฉพาะกล่อง/);
  assert.match(ui, /เปลี่ยนเครือข่าย Wi-Fi/);
});
