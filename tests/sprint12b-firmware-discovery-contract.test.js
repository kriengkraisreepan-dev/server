const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("firmware discovery contract locks UDP port, packet limit, mDNS service and public response", () => {
  const header = read("firmware/src/discovery/DiscoveryService.h");
  const source = read("firmware/src/discovery/DiscoveryService.cpp");
  assert.match(header, /kDiscoveryPort\s*=\s*42101/);
  assert.match(header, /kMaximumPacketSize\s*=\s*512/);
  assert.match(source, /MDNS\.addService\("lucky-relay",\s*"tcp",\s*80\)/);
  assert.match(source, /"lucky-relay-discovery"/);
  assert.match(source, /request\["type"\]\s*!=\s*"discover"/);
  assert.match(source, /response\["type"\]\s*=\s*"announce"/);
  assert.doesNotMatch(source, /wifiPassword|apiKey|X-Lucky-Device-Key/);
});

test("stable identity migrates only missing/default identity and is persisted through ConfigService", () => {
  const identity = read("firmware/include/lucky/DeviceIdentity.h");
  const config = read("firmware/src/config/ConfigService.cpp");
  assert.match(identity, /L','R','C','-'/);
  assert.match(config, /ESP\.getEfuseMac\(\)/);
  assert.match(config, /loaded\.deviceId\.isEmpty\(\)\s*\|\|\s*loaded\.deviceId\s*==\s*defaults::kDeviceId/);
  assert.match(config, /putString\(kPreviousDeviceIdKey,\s*previous\)/);
  assert.match(config, /putString\(kDeviceIdKey,\s*replacement\)/);
});

test("discovery lifecycle follows Wi-Fi and cannot mutate relay state", () => {
  const source = read("firmware/src/discovery/DiscoveryService.cpp");
  const main = read("firmware/src/main.cpp");
  assert.match(source, /wifi_\.isConnected\(\)\s*&&\s*!active_/);
  assert.match(source, /!wifi_\.isConnected\(\)\s*&&\s*active_/);
  // Order changed 2026-08-14 for per-device relay polarity support: config.initialize() (a local
  // NVS read, no network) now has to run before the pins get driven, so safeInitializeAllPins()
  // knows this board's polarity and doesn't briefly energize an active-high board while assuming
  // active-low. See the boot-order comment in main.cpp for the full reasoning.
  assert.match(main, /config\.initialize\(\)[\s\S]*relays\.setActiveHigh\(config\.getRelayActiveHigh\(\)\)[\s\S]*relays\.safeInitializeAllPins\(\)[\s\S]*wifi\.initialize\(\)/);
  assert.match(main, /api\.loop\(\);\s*discovery\.loop\(\);\s*watchdog\.feed\(\)/);
  assert.doesNotMatch(source, /turnOn|turnOff|turnAllOff|writeHigh|writeLow/);
});

test("Hardware Manager and Wizard retain automatic and Manual IP paths", () => {
  const source = read("public/js/app.js");
  assert.match(source, /ค้นหากล่องอัตโนมัติ/);
  assert.match(source, /กรอก IP ด้วยตนเอง/);
  assert.match(source, /\/api\/hardware\/discovery\/start/);
  assert.match(source, /wizardHost/);
  assert.match(source, /data-discovery-select/);
});

test("backend discovery routes retain Hardware Admin permission boundary and avoid protected POST", () => {
  const index = read("index.js");
  const service = read("services/hardware-discovery-service.js");
  assert.match(index, /app\.post\("\/api\/hardware\/discovery\/start",\s*requireHardwareAdmin/);
  assert.match(index, /app\.get\("\/api\/hardware\/discovery\/:sessionId",\s*requireHardwareAdmin/);
  assert.match(index, /app\.delete\("\/api\/hardware\/discovery\/:sessionId",\s*requireHardwareAdmin/);
  assert.doesNotMatch(service, /setRelayState|allOff|X-Lucky-Device-Key/);
});

test("device verify endpoint authenticates without mutating Relay", () => {
  const firmware = read("firmware/src/api/ApiServer.cpp");
  const driver = read("drivers/relay-controller-driver.js");
  const wizard = read("services/hardware-setup-wizard-service.js");
  const start = firmware.indexOf("void ApiServer::handleVerifyDevice()");
  const end = firmware.indexOf("void ApiServer::handleRelays()", start);
  const handler = firmware.slice(start, end);
  assert.match(handler, /requireAuthentication\(\)/);
  assert.match(handler, /request\["nonce"\]/);
  assert.match(handler, /verificationProof/);
  assert.match(handler, /document\["verified"\]\s*=\s*true/);
  assert.match(handler, /document\["previousDeviceId"\]/);
  assert.match(handler, /document\["identityMigrationVersion"\]/);
  assert.doesNotMatch(handler, /turnOn|turnOff|turnAllOff|setRelay/);
  assert.match(driver, /verifyDevice\(device,[^)]*\).*\/api\/v1\/device\/verify.*method:\s*"POST"/s);
  assert.match(driver, /createHmac\("sha256"/);
  assert.match(driver, /timingSafeEqual/);
  assert.match(wizard, /driver\.verifyDevice\(device\)/);
});
