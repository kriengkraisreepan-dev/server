const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { generateBase31SetupCode, BASE31_ALPHABET, HardwareSetupModeService } = require("../services/hardware-setup-mode-service");

test("Base31 Setup Code uses rejection sampling, exact format, and unambiguous alphabet", () => {
  const bytes = Buffer.from([248, 249, 250, 251, 252, 253, 254, 255, 0, 1, 2, 3, 4, 5, 6, 7, 30, 31, 32, 33, 34, 35, 36, 37]);
  const generated = generateBase31SetupCode(() => bytes);
  assert.match(generated.raw, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{12}$/);
  assert.match(generated.display, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}(?:-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}){2}$/);
  assert.equal(BASE31_ALPHABET.length, 31);
  for (const ambiguous of "0O1IL") assert.equal(generated.raw.includes(ambiguous), false);
});

test("secure random failure fails closed", () => {
  assert.throws(() => generateBase31SetupCode(() => { throw Error("rng failed"); }), { code: "SECURE_RANDOM_UNAVAILABLE" });
});

test("Setup Code enrollment stages, HMAC-verifies, commits, returns once, and logs no secret", async () => {
  const calls = [], audits = [];
  const device = { id: "hw-1", deviceId: "LRC-ABC", ipAddress: "192.168.1.50", port: 80, apiKey: "unique", hasUniqueDeviceKey: true };
  const repository = { update: (_id, changes) => Object.assign(device, changes) };
  const driver = {
    relays: async () => ({ relays: [{ channel: 1, state: "OFF" }] }),
    stageSetupCode: async (_device, transitionId, code) => calls.push({ op: "stage", transitionId, code }),
    verifySetupCode: async (_device, transitionId, code) => (calls.push({ op: "verify", transitionId, code }), { deviceId: device.deviceId }),
    commitSetupCode: async (_device, transitionId) => calls.push({ op: "commit", transitionId }),
    rollbackSetupCode: async () => calls.push({ op: "rollback" })
  };
  const service = new HardwareSetupModeService({ hardwareService: { getRequired: () => device, repository }, driver, audit: (event, actor, data) => audits.push({ event, actor, data }), randomBytes: () => Buffer.alloc(24, 7) });
  const result = await service.enroll(device.id, "owner");
  assert.deepEqual(calls.map(call => call.op), ["stage", "verify", "commit"]);
  assert.equal(result.displayOnce, true); assert.match(result.setupCode, /^9{4}-9{4}-9{4}$/);
  assert.equal(device.hasSetupCode, true); assert.equal(device.setupCodeMasked, "****-****-****");
  assert.equal(JSON.stringify(audits).includes(calls[0].code), false);
});

test("active Relay blocks enrollment and Setup Mode without automatic all-off", async () => {
  const calls = [], device = { id: "hw-1", apiKey: "unique", hasUniqueDeviceKey: true };
  const driver = { relays: async () => ({ relays: [{ channel: 2, state: "ON" }] }), stageSetupCode: async () => calls.push("stage"), allOff: async () => calls.push("allOff") };
  const service = new HardwareSetupModeService({ hardwareService: { getRequired: () => device }, driver });
  await assert.rejects(() => service.enroll(device.id, "owner"), { code: "RELAY_SAFE_STATE_CONFLICT" });
  assert.deepEqual(calls, []);
});

test("Phase 4 firmware contract locks GPIO34, timeouts, portal isolation, and additive NVS", () => {
  const root = path.resolve(__dirname, "..");
  const read = file => fs.readFileSync(path.join(root, file), "utf8");
  const setup = read("firmware/src/setup/SetupModeService.cpp"), header = read("firmware/src/setup/SetupModeService.h");
  const api = read("firmware/src/api/ApiServer.cpp"), config = read("firmware/src/config/ConfigService.cpp"), build = read("firmware/include/BuildConfig.h");
  assert.match(header, /kSetupButtonGpio\s*=\s*34/); assert.match(setup, /pinMode\(kSetupButtonGpio, INPUT\)/);
  assert.doesNotMatch(setup, /INPUT_PULLUP|delay\s*\(|turnAllOff|turnOn|turnOff/);
  assert.match(build, /LUCKY_SETUP_BUTTON_ENABLED\s+0/);
  for (const timeout of ["kButtonDebounceMs = 50", "kButtonHoldMs = 5000", "kWifiUnavailableMs = 60000", "kApLifetimeMs = 900000", "kSessionLifetimeMs = 600000", "kSessionIdleMs = 300000", "kLockoutMs = 600000"]) assert.ok(header.includes(timeout), timeout);
  for (const route of ["/api/v1/setup/code/candidate", "/api/v1/setup/code/verify", "/api/v1/setup/code/commit", "/api/v1/setup/mode/start", "/setup/api/auth", "/setup/api/candidate", "/setup/api/commit"]) assert.ok(api.includes(route), route);
  assert.doesNotMatch(api, /setup\/api\/.*relay|factory.reset|ESP\.restart/);
  for (const key of ["setupCode", "setupCandidate", "setupTransId", "setupState", "setupVersion"]) assert.ok(config.includes(`"${key}"`), key);
  assert.match(config, /Interrupted Setup Code rotation rolled back/);
});
