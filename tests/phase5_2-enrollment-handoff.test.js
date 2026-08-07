const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { UsbFlasherService } = require("../services/usb-flasher-service");
const { HardwareEnrollmentHandoffService } = require("../services/hardware-enrollment-handoff-service");
const { HardwareSetupWizardService } = require("../services/hardware-setup-wizard-service");
const { HardwareService } = require("../services/hardware-service");
const { HardwareRepository } = require("../repositories/hardware-repository");

const SECRET = "server-only-device-key-abcdefghijklmnopqrstuvwxyz012345";
function result(overrides = {}) { return { deviceId: "LRC-NEW-0001", deviceName: "New Relay", ipAddress: "192.168.1.210", port: 80, firmwareVersion: "1.1.0", apiVersion: "1", hardwareStandard: "LHS-1.0", relayCount: 4, ...overrides }; }
function fixture(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-enroll-")), repository = new HardwareRepository(path.join(dir, "hardware.json"));
  for (const item of options.existing || []) repository.create(item);
  const audits = [], driverCalls = [];
  const driver = {
    verifyDevice: async candidate => { driverCalls.push({ op: "verify", key: candidate.apiKey }); if (options.verifyError) throw Object.assign(Error("verify failed"), { code: options.verifyError }); return { verified: true, deviceId: options.proofDeviceId || "LRC-NEW-0001" }; },
    probe: async () => ({ identity: { deviceId: "LRC-NEW-0001", firmwareVersion: options.firmwareVersion || "1.1.0", apiVersion: "1", hardwareStandard: "LHS-1.0" }, config: { relayCount: options.actualRelayCount || 4 }, relays: { relays: Array.from({ length: options.actualRelayCount || 4 }, (_, i) => ({ channel: i + 1, state: "OFF" })) } })
  };
  const hardwareService = new HardwareService(repository, driver, { tables: () => [], saveTables: () => {}, audit: (event, actor, data) => audits.push({ event, actor, data }) });
  const wizardService = new HardwareSetupWizardService({ driver, hardwareService, enabled: () => true });
  const flasher = new UsbFlasherService({ clock: () => 1000, randomBytes: () => Buffer.alloc(32, 7) });
  flasher.active = { id: "flash-1", actorId: "owner-1", state: "ENROLLMENT_PENDING", mode: "new", port: "COM7", relayCount: 4, firmwareVersion: "1.1.0", releaseChannel: "test", enrollmentExpiresAt: 999999, pendingEnrollment: { deviceKey: SECRET, setupCode: "2345-6789-ABCD" } };
  let discoveryResult = options.discoveryResult === undefined ? [result()] : options.discoveryResult;
  const discovery = { start: () => ({ id: "discovery-1", state: "COMPLETED", results: discoveryResult }), get: () => ({ id: "discovery-1", state: "COMPLETED", results: discoveryResult }) };
  const handoff = new HardwareEnrollmentHandoffService({ flasher, discovery, driver, hardwareService, wizardService, audit: (event, actor, data) => audits.push({ event, actor, data }), wait: async () => {}, clock: () => 1000, randomBytes: () => Buffer.alloc(32, 9) });
  const settle = async () => { for (let i = 0; i < 20 && flasher.active.enrollmentRunning; i += 1) await new Promise(resolve => setImmediate(resolve)); };
  const begin = async (actor = "owner-1") => { const issued = handoff.issueToken("flash-1", actor); handoff.begin("flash-1", actor, issued.enrollmentToken); await settle(); return flasher.active; };
  return { handoff, flasher, repository, audits, driverCalls, begin, settle, setDiscovery: value => { discoveryResult = value; } };
}

test("Device Key and actor binding never leave public Flash responses or logs", () => {
  const x = fixture(), response = x.flasher.public(x.flasher.active);
  assert.equal(response.setupCode, "2345-6789-ABCD");
  assert.equal(x.flasher.public(x.flasher.active).setupCode, undefined, "Setup Code is one-time");
  assert.equal(JSON.stringify(response).includes(SECRET), false); assert.equal(JSON.stringify(response).includes("deviceKey"), false); assert.equal(JSON.stringify(response).includes("owner-1"), false);
});

test("pending discovery performs nonce/HMAC driver verification, atomically creates a new record and resumes Wizard after authentication", async () => {
  const x = fixture(), op = await x.begin();
  assert.equal(op.state, "COMPLETED"); assert.equal(op.enrollmentState, "COMPLETED"); assert.equal(op.pendingEnrollment, undefined);
  assert.equal(x.driverCalls[0].key, SECRET); assert.equal(x.repository.list().length, 1); assert.equal(x.repository.list()[0].deviceId, "LRC-NEW-0001"); assert.equal(x.repository.list()[0].apiKey, SECRET);
  assert.equal(op.enrollmentWizard.authenticationVerified, true); assert.equal(op.enrollmentWizard.step, "RELAY_TEST"); assert.equal(JSON.stringify(x.flasher.public(op)).includes(SECRET), false);
  assert.equal(JSON.stringify(x.audits).includes(SECRET), false);
});

test("wrong HMAC, Device ID mismatch, relay mismatch and firmware mismatch fail closed while retaining pending key", async () => {
  for (const options of [{ verifyError: "DEVICE_VERIFY_PROOF_INVALID", expected: "ENROLLMENT_VERIFICATION_FAILED" }, { proofDeviceId: "LRC-OTHER", expected: "DEVICE_ID_MISMATCH" }, { actualRelayCount: 2, expected: "RELAY_COUNT_MISMATCH" }, { firmwareVersion: "9.9.9", expected: "FIRMWARE_VERSION_MISMATCH" }]) {
    const x = fixture(options), op = await x.begin();
    assert.equal(op.state, "ENROLLMENT_PENDING"); assert.equal(op.enrollmentError, options.expected); assert.equal(op.pendingEnrollment.deviceKey, SECRET); assert.equal(x.repository.list().length, 0);
  }
});

test("duplicate Device ID never overwrites the old controller or its table-era metadata", async () => {
  const old = { deviceName: "กล่องเดิม", deviceId: "LRC-NEW-0001", ipAddress: "192.168.1.193", port: 80, apiKey: "old-private-key", relayCount: 4, tableMappingMarker: "KEEP" };
  const x = fixture({ existing: [old] }), original = JSON.stringify(x.repository.list()[0]), op = await x.begin();
  assert.equal(op.enrollmentError, "DEVICE_ID_DUPLICATE"); assert.equal(x.repository.list().length, 1); assert.equal(JSON.stringify(x.repository.list()[0]), original); assert.equal(op.pendingEnrollment.deviceKey, SECRET);
});

test("new controller creates its own record and leaves LRC-40F226CA4B70 unchanged", async () => {
  const legacy = { deviceName: "กล่องเดิม", deviceId: "LRC-40F226CA4B70", ipAddress: "192.168.1.193", port: 80, apiKey: "old-private-key", relayCount: 4, tableMappingMarker: "KEEP" };
  const x = fixture({ existing: [legacy] }), before = JSON.stringify(x.repository.list()[0]), op = await x.begin();
  assert.equal(op.state, "COMPLETED"); assert.equal(x.repository.list().length, 2);
  assert.equal(JSON.stringify(x.repository.list().find(item => item.deviceId === legacy.deviceId)), before);
  assert.equal(x.repository.list().find(item => item.deviceId === "LRC-NEW-0001").apiKey, SECRET);
});

test("discovery and verification timeouts are retryable without generating a new Device Key or reflashing", async () => {
  const x = fixture({ discoveryResult: [] }), first = await x.begin();
  assert.equal(first.enrollmentError, "ENROLLMENT_DEVICE_NOT_FOUND"); assert.equal(first.pendingEnrollment.deviceKey, SECRET);
  x.setDiscovery([result()]); delete x.handoff.driver.verifyDevice; x.handoff.driver.verifyDevice = async () => ({ verified: true, deviceId: "LRC-NEW-0001" });
  const retried = await x.begin(); assert.equal(retried.state, "COMPLETED"); assert.equal(x.repository.list().length, 1);

  const timeout = fixture({ verifyError: "DEVICE_TIMEOUT" }), failed = await timeout.begin(); assert.equal(failed.enrollmentError, "ENROLLMENT_VERIFICATION_FAILED"); assert.equal(failed.pendingEnrollment.deviceKey, SECRET);
});

test("enrollment token is actor-bound, expiring and single-use", () => {
  const x = fixture(), issued = x.handoff.issueToken("flash-1", "owner-1");
  assert.throws(() => x.handoff.begin("flash-1", "other-admin", issued.enrollmentToken), error => error.code === "ENROLLMENT_ACTOR_MISMATCH");
  x.handoff.begin("flash-1", "owner-1", issued.enrollmentToken);
  assert.throws(() => x.handoff.begin("flash-1", "owner-1", issued.enrollmentToken), error => ["ENROLLMENT_BUSY", "ENROLLMENT_TOKEN_INVALID"].includes(error.code));
});

test("HardwareRepository rolls back its in-memory record when atomic persistence fails", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-enroll-atomic-")), repository = new HardwareRepository(path.join(dir, "hardware.json"));
  repository.save = () => { throw Error("disk failed"); };
  assert.throws(() => repository.create({ deviceId: "LRC-NO-COMMIT" }), /disk failed/); assert.equal(repository.list().length, 0);
});

test("server restart loses pending memory and fails closed with explicit recovery status", () => {
  const restarted = new UsbFlasherService();
  assert.throws(() => restarted.status("flash-1"), error => error.code === "FLASH_OPERATION_NOT_FOUND");
});

test("Browser cannot submit credentials, Device ID, record ID, NVS path or COM port to enrollment start", () => {
  const root = path.resolve(__dirname, ".."), index = fs.readFileSync(path.join(root, "index.js"), "utf8"), ui = fs.readFileSync(path.join(root, "public/js/app.js"), "utf8");
  const route = index.match(/usb-flasher\/:operationId\/enrollment\/start[^\n]+/)?.[0] || "";
  assert.match(route, /requireHardwareAdmin, requireLoopback/); assert.match(route, /x-lucky-enrollment-token/); assert.doesNotMatch(route, /req\.body/);
  assert.doesNotMatch(ui, /lucky-relay-1234/); assert.doesNotMatch(ui.match(/beginEnrollmentHandoff[\s\S]*?\nlet wiringAssistant/)?.[0] || "", /deviceKey|deviceId|recordId|nvs|COM\d/i);
});
