#include "config/ConfigService.h"
#include "BuildConfig.h"
#include <ESP.h>
#include <cstring>
#include "lucky/DeviceIdentity.h"

namespace lucky {
namespace {
constexpr const char* kDeviceIdKey = "deviceId";
constexpr const char* kPreviousDeviceIdKey = "previousId";
constexpr const char* kDeviceNameKey = "deviceName";
constexpr const char* kApiKeyKey = "apiKey";
constexpr const char* kWifiSSIDKey = "wifiSSID";
constexpr const char* kWifiPasswordKey = "wifiPassword";
constexpr const char* kFirmwareVersionKey = "firmware";
constexpr const char* kHardwareStandardKey = "hardware";
constexpr const char* kRelayCountKey = "relayCount";
// Persisted as 0/1 via putUInt8/getUInt8 — StorageService has no bool accessor, and NVS keys
// are capped at 15 chars so "relayActiveHigh" (16 chars) doesn't fit.
constexpr const char* kRelayActiveHighKey = "relayActHigh";
constexpr const char* kKeyCandidateKey = "keyCandidate";
constexpr const char* kKeyTransitionKey = "keyTransId";
constexpr const char* kKeyRotationStateKey = "keyRotState";
constexpr const char* kWifiCandidateSSIDKey = "candWifiSsid";
constexpr const char* kWifiCandidatePasswordKey = "candWifiPass";
constexpr const char* kWifiTransitionKey = "wifiTransId";
constexpr const char* kWifiProvisioningStateKey = "wifiProvState";
constexpr const char* kSetupCodeKey = "setupCode";
constexpr const char* kSetupCodeCandidateKey = "setupCandidate";
constexpr const char* kSetupCodeTransitionKey = "setupTransId";
constexpr const char* kSetupCodeStateKey = "setupState";
constexpr const char* kSetupCodeVersionKey = "setupVersion";
constexpr const char* kSetupModeStateKey = "setupModeSt";
constexpr const char* kSetupFailedAttemptsKey = "setupFails";
}  // namespace

ConfigService::ConfigService(StorageService& storage, ILogger& logger)
    : storage_(storage), logger_(logger), config_(defaults()) {}

DeviceConfig ConfigService::defaults() const {
  return {defaults::kDeviceId, "", defaults::kDeviceName, "", "", "",
          defaults::kFirmwareVersion, defaults::kHardwareStandard, kDefaultRelayBoardSize, false};
}

String ConfigService::deviceIdFromHardware(const std::uint64_t hardwareId) {
  const auto value = deviceIdFromHardwareValue(hardwareId);
  return String(value.data());
}

void ConfigService::attachBackup(ProvisioningBackup& backup) { backup_ = &backup; }

bool ConfigService::initialize() {
  if (!storage_.initialize()) {
    // NVS that cannot even be opened leaves the controller unreachable until it is re-installed over
    // USB. When there is a backup to restore from, starting NVS over is the better of the two.
    ProvisioningSnapshot saved;
    if (!readBackup(saved) || !storage_.reformat()) {
      logger_.error("CONFIG_STORAGE_INIT_FAILED", "NVS namespace could not be opened");
      config_ = defaults();
      return false;
    }
    logger_.warning("CONFIG_STORAGE_REFORMATTED", "NVS could not be opened; erased it to restore from backup");
  }
  initialized_ = true;
  freshStorage_ = !storage_.hasKey(kApiKeyKey) && !storage_.hasKey(kDeviceIdKey);
  if (freshStorage_) logger_.warning("STORAGE_EMPTY_AT_BOOT", "NVS holds no device settings");
  // Before load(): a key NVS lost is still missing at this point instead of already replaced by a default.
  restoreFromBackup();
  const bool loaded = load();
  syncBackup();
  return loaded;
}

bool ConfigService::load() {
  if (!initialized_) return false;
  if (!storage_.hasKey(kWifiSSIDKey)) storage_.putString(kWifiSSIDKey, LUCKY_BOOTSTRAP_WIFI_SSID);
  if (!storage_.hasKey(kWifiPasswordKey)) storage_.putString(kWifiPasswordKey, LUCKY_BOOTSTRAP_WIFI_PASSWORD);
  if (!storage_.hasKey(kApiKeyKey)) storage_.putString(kApiKeyKey, LUCKY_BOOTSTRAP_API_KEY);
  if (!storage_.hasKey(kDeviceIdKey)) {
    storage_.putString(kDeviceIdKey, deviceIdFromHardware(ESP.getEfuseMac()));
  }
  if (!storage_.hasKey(kDeviceNameKey)) storage_.putString(kDeviceNameKey, defaults::kDeviceName);
  // Runtime firmware identity always comes from this build. Keep the legacy NVS
  // key synchronized for backward-compatible tooling, but never trust it as input.
  if (!storage_.putString(kFirmwareVersionKey, defaults::kFirmwareVersion)) {
    logger_.warning("FIRMWARE_VERSION_SYNC_FAILED", "Build firmware version could not be synchronized to NVS");
  }
  if (!storage_.hasKey(kHardwareStandardKey)) storage_.putString(kHardwareStandardKey, defaults::kHardwareStandard);
  if (!storage_.hasKey(kRelayCountKey)) storage_.putUInt8(kRelayCountKey, relayCount(kDefaultRelayBoardSize));
  if (!storage_.hasKey(kRelayActiveHighKey)) storage_.putUInt8(kRelayActiveHighKey, 0);
  DeviceConfig loaded = defaults();
  loaded.deviceId = storage_.getString(kDeviceIdKey, "");
  loaded.previousDeviceId = storage_.getString(kPreviousDeviceIdKey, "");
  if (loaded.deviceId.isEmpty() || loaded.deviceId == defaults::kDeviceId) {
    const String replacement = deviceIdFromHardware(ESP.getEfuseMac());
    const String previous = loaded.deviceId.isEmpty() ? String(defaults::kDeviceId) : loaded.deviceId;
    if (storage_.putString(kPreviousDeviceIdKey, previous) &&
        storage_.putString(kDeviceIdKey, replacement)) {
      loaded.previousDeviceId = previous;
      loaded.deviceId = replacement;
      logger_.info("DEVICE_ID_MIGRATED", "Legacy device identity replaced with stable hardware identity");
    } else {
      logger_.error("DEVICE_ID_MIGRATION_FAILED", "Stable device identity could not be persisted");
    }
  }
  loaded.deviceName = storage_.getString(kDeviceNameKey, defaults::kDeviceName);
  loaded.apiKey = storage_.getString(kApiKeyKey, "");
  loaded.wifiSSID = storage_.getString(kWifiSSIDKey, "");
  loaded.wifiPassword = storage_.getString(kWifiPasswordKey, "");
  loaded.firmwareVersion = defaults::kFirmwareVersion;
  loaded.hardwareStandard = storage_.getString(kHardwareStandardKey, defaults::kHardwareStandard);
  const auto resolution = resolveRelayBoardSize(
      storage_.getUInt8(kRelayCountKey, static_cast<std::uint8_t>(kDefaultRelayBoardSize)));
  loaded.relayBoardSize = resolution.boardSize;
  loaded.relayActiveHigh = storage_.getUInt8(kRelayActiveHighKey, 0) != 0;
  usedFallback_ = resolution.usedFallback;
  config_ = loaded;
  if (storage_.getString(kKeyRotationStateKey, "") == "PENDING") {
    storage_.remove(kKeyCandidateKey);
    storage_.remove(kKeyTransitionKey);
    storage_.remove(kKeyRotationStateKey);
    logger_.warning("DEVICE_KEY_ROTATION_ROLLED_BACK", "Interrupted key rotation rolled back");
  }
  if (storage_.getString(kSetupCodeStateKey, "") == "PENDING") {
    storage_.remove(kSetupCodeCandidateKey);
    storage_.remove(kSetupCodeTransitionKey);
    storage_.remove(kSetupCodeStateKey);
    logger_.warning("SETUP_CODE_ROTATION_ROLLED_BACK", "Interrupted Setup Code rotation rolled back");
  }
  if (storage_.getString(kSetupModeStateKey, "NORMAL") != "NORMAL") {
    storage_.putString(kSetupModeStateKey, "NORMAL");
    logger_.warning("SETUP_MODE_POWER_LOSS_RECOVERY", "Interrupted Setup Mode returned to confirmed Wi-Fi");
  }
  const String interruptedWifiState = storage_.getString(kWifiProvisioningStateKey, "IDLE");
  if (interruptedWifiState != "IDLE" && interruptedWifiState != "COMMITTED") {
    clearWifiCandidate();
    logger_.warning("WIFI_PROVISIONING_ROLLED_BACK", "Interrupted Wi-Fi transition rolled back");
  }
  if (usedFallback_) {
    logger_.warning("CONFIG_RELAY_COUNT_FALLBACK", "Invalid relayCount; safe runtime fallback is 8");
    if (!storage_.putUInt8(kRelayCountKey, relayCount(kDefaultRelayBoardSize))) {
      logger_.error("CONFIG_FALLBACK_PERSIST_FAILED", "Safe relayCount fallback could not be persisted");
    }
  }
  return true;
}

const DeviceConfig& ConfigService::getConfig() const { return config_; }
RelayBoardSize ConfigService::getRelayBoardSize() const { return config_.relayBoardSize; }
std::uint8_t ConfigService::getRelayCount() const { return relayCount(config_.relayBoardSize); }
bool ConfigService::usedRelayCountFallback() const { return usedFallback_; }
bool ConfigService::storageWasEmptyAtBoot() const { return freshStorage_; }
bool ConfigService::storageRestoredAtBoot() const { return restoredAtBoot_; }
bool ConfigService::provisioningBackedUp() const { return backupCurrent_; }
bool ConfigService::hasUniqueDeviceKey() const {
  return !config_.apiKey.isEmpty() && config_.apiKey != LUCKY_BOOTSTRAP_API_KEY;
}
String ConfigService::candidateDeviceKey() const { return storage_.getString(kKeyCandidateKey, ""); }
String ConfigService::deviceKeyTransitionId() const { return storage_.getString(kKeyTransitionKey, ""); }
bool ConfigService::stageDeviceKey(const String& newKey, const String& transitionId) {
  if (newKey.length() < 43 || transitionId.length() < 16) return false;
  return storage_.putString(kKeyCandidateKey, newKey) &&
         storage_.putString(kKeyTransitionKey, transitionId) &&
         storage_.putString(kKeyRotationStateKey, "PENDING");
}
bool ConfigService::commitDeviceKey(const String& transitionId) {
  if (transitionId != deviceKeyTransitionId() || candidateDeviceKey().isEmpty()) return false;
  const String candidate = candidateDeviceKey();
  if (!storage_.putString(kApiKeyKey, candidate)) return false;
  config_.apiKey = candidate;
  storage_.remove(kKeyCandidateKey); storage_.remove(kKeyTransitionKey); storage_.remove(kKeyRotationStateKey);
  syncBackup();
  return true;
}
bool ConfigService::rollbackDeviceKey(const String& transitionId) {
  if (!deviceKeyTransitionId().isEmpty() && transitionId != deviceKeyTransitionId()) return false;
  storage_.remove(kKeyCandidateKey); storage_.remove(kKeyTransitionKey); storage_.remove(kKeyRotationStateKey);
  return true;
}
String ConfigService::candidateWifiSSID() const { return storage_.getString(kWifiCandidateSSIDKey, ""); }
String ConfigService::candidateWifiPassword() const { return storage_.getString(kWifiCandidatePasswordKey, ""); }
String ConfigService::wifiTransitionId() const { return storage_.getString(kWifiTransitionKey, ""); }
String ConfigService::wifiProvisioningState() const { return storage_.getString(kWifiProvisioningStateKey, "IDLE"); }
bool ConfigService::setWifiProvisioningState(const String& state) { return storage_.putString(kWifiProvisioningStateKey, state); }
bool ConfigService::stageWifiCandidate(const String& ssid, const String& password, const String& transitionId) {
  if (ssid.isEmpty() || ssid.length() > 32 || password.length() > 63 ||
      (!password.isEmpty() && password.length() < 8) || transitionId.length() < 16) return false;
  return storage_.putString(kWifiCandidateSSIDKey, ssid) &&
         storage_.putString(kWifiCandidatePasswordKey, password) &&
         storage_.putString(kWifiTransitionKey, transitionId) &&
         setWifiProvisioningState("CANDIDATE_STORED");
}
bool ConfigService::commitWifiCandidate(const String& transitionId) {
  if (transitionId != wifiTransitionId() || candidateWifiSSID().isEmpty()) return false;
  if (!storage_.putString(kWifiSSIDKey, candidateWifiSSID()) ||
      !storage_.putString(kWifiPasswordKey, candidateWifiPassword())) return false;
  config_.wifiSSID = candidateWifiSSID(); config_.wifiPassword = candidateWifiPassword();
  storage_.remove(kWifiCandidateSSIDKey); storage_.remove(kWifiCandidatePasswordKey); storage_.remove(kWifiTransitionKey);
  syncBackup();
  return setWifiProvisioningState("COMMITTED");
}
bool ConfigService::clearWifiCandidate() {
  storage_.remove(kWifiCandidateSSIDKey); storage_.remove(kWifiCandidatePasswordKey); storage_.remove(kWifiTransitionKey);
  return setWifiProvisioningState("IDLE");
}

namespace {
bool validSetupCode(const String& code) {
  if (code.length() != 12) return false;
  constexpr const char* alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  for (unsigned int index = 0; index < code.length(); ++index) {
    if (strchr(alphabet, code[index]) == nullptr) return false;
  }
  return true;
}

bool uniqueKey(const String& key) { return !key.isEmpty() && key != LUCKY_BOOTSTRAP_API_KEY; }
}  // namespace

bool ConfigService::hasSetupCode() const { return validSetupCode(setupCode()); }
String ConfigService::setupCode() const { return storage_.getString(kSetupCodeKey, ""); }
String ConfigService::setupCodeCandidate() const { return storage_.getString(kSetupCodeCandidateKey, ""); }
String ConfigService::setupCodeTransitionId() const { return storage_.getString(kSetupCodeTransitionKey, ""); }
std::uint16_t ConfigService::setupCodeVersion() const { return storage_.getUInt8(kSetupCodeVersionKey, 0); }
bool ConfigService::stageSetupCode(const String& code, const String& transitionId) {
  if (!validSetupCode(code) || transitionId.length() < 16) return false;
  return storage_.putString(kSetupCodeCandidateKey, code) &&
         storage_.putString(kSetupCodeTransitionKey, transitionId) &&
         storage_.putString(kSetupCodeStateKey, "PENDING");
}
bool ConfigService::commitSetupCode(const String& transitionId) {
  if (transitionId != setupCodeTransitionId() || !validSetupCode(setupCodeCandidate())) return false;
  const String candidate = setupCodeCandidate();
  if (!storage_.putString(kSetupCodeKey, candidate)) return false;
  const std::uint8_t nextVersion = static_cast<std::uint8_t>(min<unsigned int>(255, setupCodeVersion() + 1));
  storage_.putUInt8(kSetupCodeVersionKey, nextVersion);
  storage_.remove(kSetupCodeCandidateKey); storage_.remove(kSetupCodeTransitionKey); storage_.remove(kSetupCodeStateKey);
  syncBackup();
  return true;
}
bool ConfigService::rollbackSetupCode(const String& transitionId) {
  if (!setupCodeTransitionId().isEmpty() && transitionId != setupCodeTransitionId()) return false;
  storage_.remove(kSetupCodeCandidateKey); storage_.remove(kSetupCodeTransitionKey); storage_.remove(kSetupCodeStateKey);
  return true;
}
String ConfigService::setupModeState() const { return storage_.getString(kSetupModeStateKey, "NORMAL"); }
bool ConfigService::setSetupModeState(const String& state) { return storage_.putString(kSetupModeStateKey, state); }
std::uint8_t ConfigService::setupFailedAttempts() const { return storage_.getUInt8(kSetupFailedAttemptsKey, 0); }
bool ConfigService::setSetupFailedAttempts(const std::uint8_t attempts) { return storage_.putUInt8(kSetupFailedAttemptsKey, attempts); }

bool ConfigService::setRelayCount(const std::uint8_t count) {
  if (!isSupportedRelayCount(count)) return false;
  if (!storage_.putUInt8(kRelayCountKey, count)) {
    logger_.error("CONFIG_RELAY_COUNT_PERSIST_FAILED", "NVS rejected relayCount update");
    return false;
  }
  config_.relayBoardSize = static_cast<RelayBoardSize>(count);
  usedFallback_ = false;
  logger_.info("CONFIG_RELAY_COUNT_CHANGED", "relayCount persisted");
  syncBackup();
  return true;
}

bool ConfigService::getRelayActiveHigh() const { return config_.relayActiveHigh; }
bool ConfigService::setRelayActiveHigh(const bool activeHigh) {
  if (!storage_.putUInt8(kRelayActiveHighKey, activeHigh ? 1 : 0)) {
    logger_.error("CONFIG_RELAY_POLARITY_PERSIST_FAILED", "NVS rejected relayActiveHigh update");
    return false;
  }
  config_.relayActiveHigh = activeHigh;
  logger_.info("CONFIG_RELAY_POLARITY_CHANGED", "relayActiveHigh persisted");
  syncBackup();
  return true;
}

bool ConfigService::resetToDefaults() {
  // A deliberate reset must not be undone by the next boot restoring the backup.
  if (backup_ && !backup_->erase()) return false;
  if (!storage_.clear()) return false;
  config_ = defaults();
  usedFallback_ = false;
  return storage_.putUInt8(kRelayCountKey, relayCount(kDefaultRelayBoardSize)) &&
         storage_.putUInt8(kRelayActiveHighKey, 0);
}

ProvisioningSnapshot ConfigService::storedSnapshot() {
  ProvisioningSnapshot snapshot;
  snapshot.apiKey = storage_.getString(kApiKeyKey, "");
  snapshot.wifiSSID = storage_.getString(kWifiSSIDKey, "");
  snapshot.wifiPassword = storage_.getString(kWifiPasswordKey, "");
  snapshot.setupCode = storage_.getString(kSetupCodeKey, "");
  snapshot.setupVersion = storage_.getUInt8(kSetupCodeVersionKey, 0);
  snapshot.relayCount = storage_.getUInt8(kRelayCountKey, 0);
  snapshot.relayActiveHigh = storage_.getUInt8(kRelayActiveHighKey, 0) != 0;
  return snapshot;
}

// putString reports an empty string as a failure (Preferences returns the length written), so
// success is judged by reading the values back rather than by the individual return codes.
bool ConfigService::writeSnapshot(const ProvisioningSnapshot& snapshot) {
  storage_.putString(kApiKeyKey, snapshot.apiKey);
  storage_.putString(kWifiSSIDKey, snapshot.wifiSSID);
  storage_.putString(kWifiPasswordKey, snapshot.wifiPassword);
  storage_.putString(kSetupCodeKey, snapshot.setupCode);
  storage_.putUInt8(kSetupCodeVersionKey, snapshot.setupVersion);
  storage_.putUInt8(kRelayCountKey, snapshot.relayCount);
  storage_.putUInt8(kRelayActiveHighKey, snapshot.relayActiveHigh ? 1 : 0);
  return storedSnapshot() == snapshot;
}

// Only a copy that carries an identity of its own is worth restoring.
bool ConfigService::readBackup(ProvisioningSnapshot& snapshot) {
  return backup_ && backup_->read(snapshot) && uniqueKey(snapshot.apiKey) && isSupportedRelayCount(snapshot.relayCount);
}

void ConfigService::restoreFromBackup() {
  ProvisioningSnapshot saved;
  if (!readBackup(saved)) return;
  const String storedKey = storage_.getString(kApiKeyKey, "");
  if (!uniqueKey(storedKey)) {
    // No identity of its own left: NVS was wiped. Put everything back.
    restoredAtBoot_ = writeSnapshot(saved);
    if (restoredAtBoot_) logger_.warning("STORAGE_RESTORED_FROM_BACKUP", "All settings restored from backup");
    else logger_.error("STORAGE_RESTORE_FAILED", "Settings backup could not be written back to NVS");
    return;
  }
  // A different Device Key means NVS was provisioned afresh (New Install), or a key rotation committed
  // before the backup caught up. Either way NVS is newer, and syncBackup() replaces the copy.
  if (storedKey != saved.apiKey) return;
  // Same identity: fill in only what NVS has lost. A value it still holds is never overwritten, since
  // it may be a change committed just before the power went, ahead of the backup.
  int restored = 0;
  if (storage_.getString(kWifiSSIDKey, "").isEmpty() && !saved.wifiSSID.isEmpty()) {
    storage_.putString(kWifiSSIDKey, saved.wifiSSID);
    storage_.putString(kWifiPasswordKey, saved.wifiPassword);
    ++restored;
  }
  if (!hasSetupCode() && validSetupCode(saved.setupCode)) {
    storage_.putString(kSetupCodeKey, saved.setupCode);
    storage_.putUInt8(kSetupCodeVersionKey, saved.setupVersion);
    ++restored;
  }
  if (!isSupportedRelayCount(storage_.getUInt8(kRelayCountKey, 0))) {
    storage_.putUInt8(kRelayCountKey, saved.relayCount);
    ++restored;
  }
  if (!storage_.hasKey(kRelayActiveHighKey)) {
    storage_.putUInt8(kRelayActiveHighKey, saved.relayActiveHigh ? 1 : 0);
    ++restored;
  }
  if (restored) {
    restoredAtBoot_ = true;
    logger_.warning("STORAGE_RESTORED_FROM_BACKUP", "Lost settings restored from backup");
  }
}

// Copies the committed settings to the backup when they differ from it. A controller with no Device
// Key of its own is never backed up: that would replace a good copy with a blank one.
void ConfigService::syncBackup() {
  backupCurrent_ = false;
  if (!backup_ || !initialized_) return;
  const ProvisioningSnapshot current = storedSnapshot();
  if (!uniqueKey(current.apiKey) || !isSupportedRelayCount(current.relayCount)) return;
  ProvisioningSnapshot saved;
  backupCurrent_ = (backup_->read(saved) && saved == current) || backup_->write(current);
}

}  // namespace lucky
