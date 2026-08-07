const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { UsbFlasherService } = require("../services/usb-flasher-service");
const { WindowsSerialRecoveryTransport } = require("../drivers/windows-serial-recovery-transport");

function fixture() {
  const application = { role: "application", offset: "0x10000", path: path.join(os.tmpdir(), "lucky-r4-firmware.bin") };
  fs.writeFileSync(application.path, "firmware-1.2.0");
  const calls = [];
  const service = new UsbFlasherService({
    packageService: { verify: () => ({ manifest: { firmwareVersion: "1.2.0", releaseChannel: "internal-test" }, files: { application }, esptool: "esptool.exe" }) },
    relaySafe: async () => true,
    recoveryTransport: { request: (_port, payload) => payload.command === "IDENTIFY" ? { ok: true, deviceId: "LRC-RECOVER", relayCount: 4, firmwareVersion: "1.2.0", apiVersion: "1" } : { ok: true, safe: true, activeChannels: [] } },
    wait: async () => {}
  });
  let reads = 0;
  service.run = async (_tool, args) => {
    calls.push(args);
    if (args.includes("chip_id")) return "Chip is ESP32";
    if (args.includes("flash_id")) return "Detected flash size: 4MB";
    if (args.includes("read_flash")) fs.writeFileSync(args.at(-1), Buffer.alloc(0x5000, ++reads));
    return "verified";
  };
  return { service, calls };
}

test("NVS raw hash change fails closed into semantic USB acceptance after safe runtime verification", async () => {
  const { service } = fixture();
  const op = { id: "changed", mode: "update", port: "COM3", progress: 0 };
  await service.execute(op, "owner");
  assert.equal(op.state, "FAILED");
  assert.equal(op.error, "NVS_SEMANTIC_REAUTHENTICATION_REQUIRED");
  assert.equal(op.postFlashVerification, "PASSED");
  assert.equal(op.nvsPreservation, "SEMANTIC_REAUTHENTICATION_REQUIRED");
  assert.equal(op.credentialVerification, "PENDING_USB_ACCEPTANCE");
  assert.equal(op.deviceId, "LRC-RECOVER");
});

test("recovery mode verifies the exact application and runtime without write_flash", async () => {
  const { service, calls } = fixture();
  const op = { id: "recover", mode: "recover", port: "COM3", progress: 0 };
  await service.execute(op, "owner");
  assert.equal(op.state, "COMPLETED");
  assert.equal(op.postFlashVerification, "PASSED");
  assert.equal(op.credentialVerification, "PENDING_USB_ACCEPTANCE");
  assert.ok(calls.some(args => args.includes("verify_flash") && args.includes("0x10000")));
  assert.equal(calls.some(args => args.includes("write_flash")), false);
  assert.equal(calls.some(args => args.includes("0x9000")), false);
});

test("recovery mode remains fail closed for wrong firmware identity or active Relay", async () => {
  const first = fixture();
  first.service.recoveryTransport.request = (_port, payload) => payload.command === "IDENTIFY" ? { ok: true, deviceId: "LRC-X", relayCount: 4, firmwareVersion: "1.1.0" } : { ok: true, safe: true, activeChannels: [] };
  await assert.rejects(() => first.service.execute({ id: "wrong", mode: "recover", port: "COM3" }, "owner"), error => error.code === "POST_FLASH_VERIFICATION_FAILED");
  const second = fixture();
  second.service.recoveryTransport.request = (_port, payload) => payload.command === "IDENTIFY" ? { ok: true, deviceId: "LRC-X", relayCount: 4, firmwareVersion: "1.2.0" } : { ok: true, safe: false, activeChannels: [2] };
  await assert.rejects(() => second.service.execute({ id: "relay", mode: "recover", port: "COM3" }, "owner"), error => error.code === "POST_FLASH_RELAY_NOT_OFF");
});

test("UI exposes no-write recovery mode and keeps new-install confirmation isolated", () => {
  const ui = fs.readFileSync(path.join(__dirname, "..", "public", "js", "app.js"), "utf8");
  assert.match(ui, /recoveryOption\.value="recover"/);
  assert.match(ui, /ไม่ Flash ซ้ำ/);
  assert.match(ui, /mode\.value!=="new"/);
});

test("Windows Serial recovery accepts a valid response despite noisy firmware logs", () => {
  const response = { command: "IDENTIFY", ok: true, deviceId: "LRC-NOISY", relayCount: 4, firmwareVersion: "1.2.0", apiVersion: "1" };
  const transport = new WindowsSerialRecoveryTransport({ platform: "win32", run: () => ({ status: 0, stdout: JSON.stringify(response), stderr: "many redacted log lines" }) });
  assert.deepEqual(transport.request("COM3", { command: "IDENTIFY" }), response);
  const driver = fs.readFileSync(path.join(__dirname, "..", "drivers", "windows-serial-recovery-transport.js"), "utf8");
  assert.match(driver, /ReadExisting\(\)/);
  assert.match(driver, /131072/);
  assert.match(driver, /LUCKY_RECOVERY_RESPONSE:/);
  assert.doesNotMatch(driver, /ReadLine\(\)/);
});
