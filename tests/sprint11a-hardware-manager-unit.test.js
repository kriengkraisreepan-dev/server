const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { HardwareRepository } = require("../repositories/hardware-repository");
const { HardwareService } = require("../services/hardware-service");
const { RelayControllerDriver } = require("../drivers/relay-controller-driver");

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-hardware-unit-"));
  const repository = new HardwareRepository(path.join(directory, "hardware-devices.json"));
  const calls = [];
  const driver = {
    endpoint: device => `http://${device.ipAddress}:${device.port}`,
    probe: async device => {
      if (device.ipAddress === "192.168.1.99") { const error = Error("offline"); error.code = "DEVICE_OFFLINE"; error.status = 503; throw error; }
      return { health: { uptimeSeconds: 42, rssi: -50, freeHeapBytes: 1000 }, identity: { deviceId: "LRC-1", firmwareVersion: "1.0.0", apiVersion: "1", hardwareStandard: "LHS-1.0" }, config: { relayCount: 4 } };
    },
    health: async () => ({ uptimeSeconds: 43 }),
    relays: async () => ({ relays: [] }),
    relayConfig: async () => ({ relayCount: 4 }),
    setRelayCount: async (_device, count) => ({ relayCount: count }),
    setRelayState: async (_device, channel, state) => (calls.push({ channel, state }), { success: true }),
    allOff: async () => (calls.push({ allOff: true }), { success: true })
  };
  const tables = [{ id: 1, name: "โต๊ะ 1" }, { id: 2, name: "โต๊ะ 2" }];
  const service = new HardwareService(repository, driver, { tables: () => tables, saveTables: () => {}, audit: () => {} });
  return { directory, repository, service, tables, calls };
}

test("create/update/delete device and never expose API key", async t => {
  const x = fixture(); t.after(() => fs.rmSync(x.directory, { recursive: true, force: true }));
  const created = await x.service.create({ deviceName: "Main", ipAddress: "192.168.1.20", port: 80, apiKey: "secret", deviceType: "RELAY_CONTROLLER" }, "owner");
  assert.equal(created.status, "ONLINE");
  assert.equal(created.apiKey, undefined);
  assert.equal(created.apiKeyMasked, "••••••••");
  const updated = await x.service.update(created.id, { deviceName: "Main 2" }, "owner");
  assert.equal(updated.deviceName, "Main 2");
  assert.equal(x.repository.findById(created.id).apiKey, "secret");
  x.service.delete(created.id, "owner");
  assert.equal(x.service.list().length, 0);
});

test("connection failure does not persist a device", async t => {
  const x = fixture(); t.after(() => fs.rmSync(x.directory, { recursive: true, force: true }));
  await assert.rejects(() => x.service.create({ deviceName: "Bad", ipAddress: "192.168.1.99", port: 80, apiKey: "x" }), { code: "DEVICE_OFFLINE" });
  assert.equal(x.service.list().length, 0);
});

test("table mapping rejects duplicate channels and controls mapped relay", async t => {
  const x = fixture(); t.after(() => fs.rmSync(x.directory, { recursive: true, force: true }));
  const device = await x.service.create({ deviceName: "Main", ipAddress: "192.168.1.20", port: 80, apiKey: "secret" }, "owner");
  x.service.mapTable(1, device.id, 1, "owner");
  assert.throws(() => x.service.mapTable(2, device.id, 1, "owner"), { code: "DUPLICATE_RELAY_MAPPING" });
  assert.throws(() => x.service.mapTable(2, device.id, 5, "owner"), { code: "INVALID_RELAY_CHANNEL" });
  await x.service.setTableRelay(x.tables[0], "on");
  assert.deepEqual(x.calls[0], { channel: 1, state: true });
});

test("driver translates boolean state to firmware ON/OFF and sends API key", async () => {
  const requests = [];
  const driver = new RelayControllerDriver({ fetcher: async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ success: true }) };
  } });
  const device = { ipAddress: "192.168.1.20", port: 80, apiKey: "device-secret", relayCount: 2 };
  await driver.setRelayState(device, 1, true);
  await driver.setRelayState(device, 2, false);
  assert.equal(JSON.parse(requests[0].options.body).state, "ON");
  assert.equal(JSON.parse(requests[1].options.body).state, "OFF");
  assert.equal(requests[0].options.headers["X-Lucky-Device-Key"], "device-secret");
  assert.throws(() => driver.setRelayState(device, 3, true), { code: "INVALID_RELAY_CHANNEL" });
});

test("relayState flags credentialStatus for reauthentication when the physical device rejects the API key", async t => {
  const x = fixture(); t.after(() => fs.rmSync(x.directory, { recursive: true, force: true }));
  const device = await x.service.create({ deviceName: "Main", ipAddress: "192.168.1.20", port: 80, apiKey: "stale-secret" }, "owner");
  x.service.driver.setRelayState = async () => { const error = Error("API Key ของอุปกรณ์ไม่ถูกต้อง"); error.code = "DEVICE_AUTH_FAILED"; error.status = 401; throw error; };
  await assert.rejects(() => x.service.relayState(device.id, 1, true), { code: "DEVICE_AUTH_FAILED" });
  const updated = x.repository.findById(device.id);
  assert.equal(updated.credentialStatus, "REAUTHENTICATION_REQUIRED");
  assert.equal(updated.status, "OFFLINE");
});

test("setTableRelay flags credentialStatus on auth failure but keeps the existing OFFLINE-only behaviour for other errors", async t => {
  const x = fixture(); t.after(() => fs.rmSync(x.directory, { recursive: true, force: true }));
  const device = await x.service.create({ deviceName: "Main", ipAddress: "192.168.1.20", port: 80, apiKey: "stale-secret" }, "owner");
  x.service.mapTable(1, device.id, 1, "owner");
  x.service.driver.setRelayState = async () => { const error = Error("API Key ของอุปกรณ์ไม่ถูกต้อง"); error.code = "DEVICE_AUTH_FAILED"; error.status = 401; throw error; };
  await assert.rejects(() => x.service.setTableRelay(x.tables[0], "on"), { code: "DEVICE_AUTH_FAILED" });
  assert.equal(x.repository.findById(device.id).credentialStatus, "REAUTHENTICATION_REQUIRED");

  const second = await x.service.create({ deviceName: "Second", ipAddress: "192.168.1.21", port: 80, apiKey: "secret" }, "owner");
  x.service.mapTable(2, second.id, 1, "owner");
  x.service.driver.setRelayState = async () => { const error = Error("หมดเวลาติดต่อกล่องควบคุม"); error.code = "DEVICE_TIMEOUT"; error.status = 503; throw error; };
  await assert.rejects(() => x.service.setTableRelay(x.tables[1], "on"), { code: "DEVICE_TIMEOUT" });
  const updatedSecond = x.repository.findById(second.id);
  assert.equal(updatedSecond.status, "OFFLINE");
  assert.notEqual(updatedSecond.credentialStatus, "REAUTHENTICATION_REQUIRED");
});

test("driver verifies fresh nonce and HMAC proof from device without Relay mutation", async () => {
  const requests = [], key = "unique-device-secret";
  const driver = new RelayControllerDriver({ fetcher: async (url, options) => {
    requests.push({ url, options });
    const { nonce } = JSON.parse(options.body);
    const deviceId = "LRC-AABBCCDDEEFF", identityMigrationVersion = 1;
    const proof = crypto.createHmac("sha256", key).update(`${nonce}:${deviceId}:${identityMigrationVersion}`).digest("hex");
    return { ok: true, json: async () => ({ success: true, verified: true, nonce, proof, deviceId, previousDeviceId: "LRC-0001", identityMigrationVersion, relayCount: 4 }) };
  } });
  const result = await driver.verifyDevice({ ipAddress: "192.168.1.20", port: 80, apiKey: key, relayCount: 4 }, "a".repeat(48));
  assert.equal(result.relayCount, 4);
  assert.match(requests[0].url, /\/api\/v1\/device\/verify$/);
  assert.equal(requests[0].options.headers["X-Lucky-Device-Key"], key);
  assert.equal(requests.length, 1);
  const invalid = new RelayControllerDriver({ fetcher: async () => ({ ok: true, json: async () => ({ success: true, verified: true, nonce: "b".repeat(48), proof: "0".repeat(64), deviceId: "LRC-AABBCCDDEEFF", identityMigrationVersion: 1 }) }) });
  await assert.rejects(() => invalid.verifyDevice({ ipAddress: "192.168.1.20", port: 80, apiKey: key }, "b".repeat(48)), { code: "DEVICE_VERIFY_PROOF_INVALID" });
});
