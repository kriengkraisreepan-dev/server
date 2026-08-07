const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("Hardware Manager hides unsupported Restart while compatibility route remains fail-closed", () => {
  const ui = read("public/js/app.js");
  assert.doesNotMatch(ui, /data-hw-restart|hwRestart/);
  assert.match(read("services/hardware-service.js"), /DEVICE_RESTART_UNSUPPORTED/);
  assert.match(read("index.js"), /devices\/:id\/restart/);
});

test("runtime firmware version is the build constant and stale NVS cannot override it", () => {
  const config = read("firmware/src/config/ConfigService.cpp");
  assert.match(config, /putString\(kFirmwareVersionKey, defaults::kFirmwareVersion\)/);
  assert.match(config, /loaded\.firmwareVersion\s*=\s*defaults::kFirmwareVersion/);
  assert.doesNotMatch(config, /loaded\.firmwareVersion\s*=\s*storage_\.getString/);
});

test("all identity channels report ConfigService build version and no restart firmware API exists", () => {
  const api = read("firmware/src/api/ApiServer.cpp");
  const discovery = read("firmware/src/discovery/DiscoveryService.cpp");
  assert.equal((api.match(/document\["firmwareVersion"\] = config\.firmwareVersion/g) || []).length, 3);
  assert.equal((discovery.match(/firmwareVersion".*config\.firmwareVersion/g) || []).length, 2);
  assert.match(read("firmware/src/main.cpp"), /FIRMWARE_VERSION.*defaults::kFirmwareVersion/);
  assert.doesNotMatch(api, /ESP\.restart\s*\(|\/api\/v1\/.*restart/);
});

test("version synchronization cannot clear or rewrite operational configuration", () => {
  const config = read("firmware/src/config/ConfigService.cpp");
  const sync = config.match(/if \(!storage_\.putString\(kFirmwareVersionKey, defaults::kFirmwareVersion\)\)[\s\S]*?\n  }/)[0];
  for (const key of ["kDeviceIdKey", "kPreviousDeviceIdKey", "kApiKeyKey", "kWifiSSIDKey", "kWifiPasswordKey", "kRelayCountKey", "kKeyCandidateKey", "kWifiCandidateSSIDKey", "kWifiProvisioningStateKey"]) assert.equal(sync.includes(key), false, key);
  assert.doesNotMatch(sync, /clear\s*\(|remove\s*\(/);
});
