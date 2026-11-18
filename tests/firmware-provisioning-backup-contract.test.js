const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// The firmware cannot be unit-tested on this machine (no host compiler), so the rules that keep the
// settings backup from doing harm are pinned in its source, the same way the other firmware
// contracts are.
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const body = (source, signature) => {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} not found`);
  return source.slice(start, source.indexOf("\n}\n", start));
};

test("the backup is attached and restored before anything reads the settings", () => {
  const main = read("firmware/src/main.cpp");
  assert.match(main, /config\.attachBackup\(provisioningBackup\);\s*config\.initialize\(\);\s*relays\.setActiveHigh\(config\.getRelayActiveHigh\(\)\)/);
  const initialize = body(read("firmware/src/config/ConfigService.cpp"), "bool ConfigService::initialize()");
  assert.match(initialize, /restoreFromBackup\(\);[\s\S]*load\(\);[\s\S]*syncBackup\(\);/);
});

test("a blank controller never overwrites a good backup, and a freshly provisioned one is never overwritten by it", () => {
  const source = read("firmware/src/config/ConfigService.cpp");
  assert.match(body(source, "void ConfigService::syncBackup()"), /if \(!uniqueKey\(current\.apiKey\)/);
  const restore = body(source, "void ConfigService::restoreFromBackup()");
  assert.match(restore, /if \(!uniqueKey\(storedKey\)\)[\s\S]*writeSnapshot\(saved\)/);
  assert.match(restore, /if \(storedKey != saved\.apiKey\) return;/);
});

test("every committed provisioning change reaches the backup, and a deliberate reset clears it", () => {
  const source = read("firmware/src/config/ConfigService.cpp");
  for (const signature of ["bool ConfigService::commitDeviceKey(", "bool ConfigService::commitWifiCandidate(", "bool ConfigService::commitSetupCode(", "bool ConfigService::setRelayCount(", "bool ConfigService::setRelayActiveHigh("]) {
    assert.match(body(source, signature), /syncBackup\(\);/, signature);
  }
  assert.match(body(source, "bool ConfigService::resetToDefaults()"), /backup_->erase\(\)[\s\S]*storage_\.clear\(\)/);
});

test("a write never touches the newest copy and a copy from another chip is ignored", () => {
  const source = read("firmware/src/storage/ProvisioningBackup.cpp");
  assert.match(source, /const std::size_t slot = newest == 0 \? 1 : 0;/);
  assert.match(source, /record\.chipId == chipId\(\)/);
  assert.match(source, /esp_partition_find_first\(ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_DATA_SPIFFS, "spiffs"\)/);
});

test("health reports whether the controller restored its settings and can do so again", () => {
  const api = read("firmware/src/api/ApiServer.cpp");
  assert.match(api, /document\["storageRestoredAtBoot"\] = config_\.storageRestoredAtBoot\(\);/);
  assert.match(api, /document\["provisioningBackup"\] = config_\.provisioningBackedUp\(\);/);
});
