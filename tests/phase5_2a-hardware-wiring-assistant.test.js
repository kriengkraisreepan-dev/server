const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { HardwareWiringAssistantService, GPIO_MAPPING } = require("../services/hardware-wiring-assistant-service");
const { HardwareRepository } = require("../repositories/hardware-repository");

function fixture(options = {}) {
  const device = { id: "hw-1", deviceName: "กล่องหลัก", deviceId: "LRC-ONE", ipAddress: "192.168.1.50", port: 80, apiKey: "not-public", hasUniqueDeviceKey: true, status: "ONLINE", relayCount: options.relayCount || 4, firmwareVersion: "1.1.0", hardwareStandard: "LHS-1.0" };
  const devices = options.duplicates ? [device, { ...device, id: "hw-2" }] : [device];
  const repository = { list: () => devices, findById: id => devices.find(item => item.id === id), update: (_id, changes) => (Object.assign(device, changes), device) };
  const calls = [], states = Array.from({ length: device.relayCount }, (_, index) => ({ channel: index + 1, state: options.activeChannel === index + 1 ? "ON" : "OFF" }));
  const driver = {
    relays: async () => ({ relays: states.map(item => ({ ...item })) }),
    setRelayState: async (_device, channel, on) => {
      calls.push({ channel, on });
      if (on && options.onFails) throw Object.assign(Error("on failed"), { code: "ON_FAILED" });
      if (!on && options.offFails) throw Object.assign(Error("off failed"), { code: "OFF_FAILED" });
      states[channel - 1].state = on ? "ON" : "OFF";
    },
    allOff: async () => calls.push({ allOff: true })
  };
  const tables = [{ id: 1, name: "โต๊ะ 1", hardwareDeviceId: "hw-1", relayChannel: 1 }];
  const audits = [];
  const service = new HardwareWiringAssistantService({
    hardwareService: { repository, getRequired: id => { const found = repository.findById(id); if (!found) throw Error("missing"); return found; }, publicDevice: item => { const { apiKey, ...safe } = item; return safe; } },
    driver, tables: () => tables,
    hasActiveTableSession: () => Boolean(options.activeSession),
    conflict: async () => options.conflict || null,
    audit: (event, actor, data) => audits.push({ event, actor, data }),
    wait: options.wait || (async () => {}),
    clock: () => new Date("2026-08-02T12:00:00.000Z")
  });
  const confirmations = { tablesClosed: true, noActiveSessions: true, mainsDisconnected: true, relaysOff: true, readyForSingleChannelTest: true };
  return { service, device, calls, states, audits, confirmations, repository };
}

test("immutable wiring profile exposes exact 2, 4 and 8 channel mappings", () => {
  assert.deepEqual(GPIO_MAPPING.map(item => [item.relayChannel, item.gpio, item.inputLabel]), [[1,13,"IN1"],[2,14,"IN2"],[3,16,"IN3"],[4,17,"IN4"],[5,18,"IN5"],[6,19,"IN6"],[7,25,"IN7"],[8,26,"IN8"]]);
  for (const count of [2, 4, 8]) assert.equal(fixture({ relayCount: count }).service.view("hw-1").mapping.length, count);
});

test("start fails closed for incomplete confirmation, offline, bootstrap key, active table, relay ON, conflicts and duplicate identity", async () => {
  const cases = [
    { mutate: x => delete x.confirmations.mainsDisconnected, code: "SAFETY_CONFIRMATION_REQUIRED" },
    { mutate: x => { x.device.status = "OFFLINE"; }, code: "DEVICE_OFFLINE" },
    { mutate: x => { x.device.hasUniqueDeviceKey = false; }, code: "UNIQUE_DEVICE_KEY_REQUIRED" },
    { options: { activeSession: true }, code: "ACTIVE_TABLE_SESSION" },
    { options: { activeChannel: 2 }, code: "RELAY_SAFE_STATE_CONFLICT" },
    { options: { conflict: "Setup Mode" }, code: "HARDWARE_OPERATION_CONFLICT" },
    { options: { duplicates: true }, code: "DEVICE_ID_AMBIGUOUS" }
  ];
  for (const item of cases) { const x = fixture(item.options); item.mutate?.(x); await assert.rejects(() => x.service.start("hw-1", x.confirmations, "owner"), error => error.code === item.code, item.code); }
});

test("server-side pulse opens only target, waits 1000 ms, closes in cleanup and never all-off", async () => {
  let waited = 0; const x = fixture({ wait: async ms => { waited = ms; } });
  const session = await x.service.start("hw-1", x.confirmations, "owner");
  const pulsed = await x.service.test("hw-1", session.id, { channel: 2 }, "owner");
  assert.equal(waited, 1000); assert.deepEqual(x.calls, [{ channel: 2, on: true }, { channel: 2, on: false }]);
  assert.equal(x.states[0].state, "OFF"); assert.equal(pulsed.state, "AWAITING_RESULT"); assert.equal(x.calls.some(call => call.allOff), false);
});

test("Browser GPIO, pulse duration and out-of-range/non-integer channels are rejected", async () => {
  for (const input of [{ channel: 1, gpio: 99 }, { channel: 1, durationMs: 2001 }, { channel: 5 }, { channel: 1.5 }]) {
    const x = fixture(), session = await x.service.start("hw-1", x.confirmations, "admin");
    await assert.rejects(() => x.service.test("hw-1", session.id, input, "admin"));
    assert.deepEqual(x.calls, []);
  }
});

test("ON failure does not claim ownership or send OFF", async () => {
  const x = fixture({ onFails: true }), session = await x.service.start("hw-1", x.confirmations, "owner");
  await assert.rejects(() => x.service.test("hw-1", session.id, { channel: 1 }, "owner"), /on failed/);
  assert.deepEqual(x.calls, [{ channel: 1, on: true }]);
});

test("OFF failure creates persistent emergency lock and blocks the next channel", async () => {
  const x = fixture({ offFails: true }), session = await x.service.start("hw-1", x.confirmations, "owner");
  await assert.rejects(() => x.service.test("hw-1", session.id, { channel: 1 }, "owner"), error => error.code === "RELAY_TEST_OFF_FAILED" && Boolean(error.emergency));
  await assert.rejects(() => x.service.test("hw-1", session.id, { channel: 2 }, "owner"), error => error.code === "RELAY_TEST_OFF_FAILED");
  assert.ok(x.audits.some(item => item.event === "RELAY_TEST_OFF_FAILED")); assert.equal(x.calls.some(call => call.allOff), false);
});

test("cancel during bounded wait aborts and still closes only the owned target", async () => {
  const x = fixture({ wait: (_ms, signal) => new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(Error("cancelled"), { code: "WIRING_TEST_CANCELLED" })), { once: true })) });
  const session = await x.service.start("hw-1", x.confirmations, "owner"), pulse = x.service.test("hw-1", session.id, { channel: 3 }, "owner");
  await new Promise(resolve => setImmediate(resolve)); await x.service.cancel("hw-1", session.id, "owner");
  await assert.rejects(() => pulse, error => error.code === "WIRING_TEST_CANCELLED");
  assert.deepEqual(x.calls, [{ channel: 3, on: true }, { channel: 3, on: false }]);
});

test("VERIFIED and MISMATCH persist additively without changing table mapping", async () => {
  const x = fixture({ relayCount: 2 }), before = JSON.stringify(x.service.tables());
  const session = await x.service.start("hw-1", x.confirmations, "owner");
  await x.service.test("hw-1", session.id, { channel: 1 }, "owner"); x.service.result("hw-1", session.id, { channel: 1, status: "VERIFIED" }, "owner");
  await x.service.test("hw-1", session.id, { channel: 2 }, "owner"); x.service.result("hw-1", session.id, { channel: 2, status: "MISMATCH", actualChannel: 1 }, "owner");
  const completed = x.service.complete("hw-1", session.id, "owner");
  assert.equal(completed.wiringProfile.verificationStatus, "MISMATCH"); assert.equal(x.device.id, "hw-1"); assert.equal(x.device.deviceId, "LRC-ONE"); assert.equal(JSON.stringify(x.service.tables()), before);
});

test("repository preserves profile on IP change and requires reverify for identity, count or standard", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-wiring-")), file = path.join(dir, "hardware.json"), repository = new HardwareRepository(file);
  const device = repository.create({ deviceId: "LRC-A", ipAddress: "1.1.1.1", relayCount: 2, hardwareStandard: "LHS-1.0", wiringProfile: { verificationStatus: "VERIFIED", mapping: [{ relayChannel: 1, verificationStatus: "VERIFIED" }] } });
  repository.update(device.id, { ipAddress: "1.1.1.2" }); assert.equal(device.wiringProfile.verificationStatus, "VERIFIED");
  repository.update(device.id, { relayCount: 4 }); assert.equal(device.wiringProfile.verificationStatus, "REVERIFY_REQUIRED");
  assert.equal(device.wiringProfile.mapping[0].verificationStatus, "REVERIFY_REQUIRED");
});

test("UI filters relay buttons by relayCount, print sheet excludes secrets, and routes retain OWNER/ADMIN guard", () => {
  const root = path.resolve(__dirname, ".."), ui = fs.readFileSync(path.join(root, "public/js/app.js"), "utf8"), index = fs.readFileSync(path.join(root, "index.js"), "utf8");
  assert.match(ui, /Array\.from\(\{length:Number\(device\.relayCount\)\|\|0}/); assert.match(ui, /data-hw-wiring/); assert.match(ui, /popup\.print\(\)/);
  const sheet = ui.match(/function renderWiringSheet[\s\S]*?\nfunction bindHardware/)?.[0] || "";
  assert.doesNotMatch(sheet, /apiKey|setupCode|password|sessionToken|portal/i);
  for (const route of ["wiring/session", "wiring/test", "wiring/result", "wiring/complete", "wiring/cancel"]) assert.match(index, new RegExp(`${route.replace("/", "\\/")}[^\n]*requireHardwareAdmin`));
  assert.match(index, /\["OWNER", "ADMIN"\]/);
});
