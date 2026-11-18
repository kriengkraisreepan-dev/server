#pragma once

#include <cstdint>
#include "config/DeviceConfig.h"
#include "logging/ILogger.h"
#include "storage/ProvisioningBackup.h"
#include "storage/StorageService.h"

namespace lucky {

class ConfigService {
 public:
  ConfigService(StorageService& storage, ILogger& logger);
  // Call before initialize(). With a backup attached, a boot that finds NVS wiped puts the Wi-Fi,
  // Device Key, Setup Code and relay settings back instead of coming up blank, and every change to
  // them is copied to the backup as it is committed.
  void attachBackup(ProvisioningBackup& backup);
  bool initialize();
  bool load();
  const DeviceConfig& getConfig() const;
  RelayBoardSize getRelayBoardSize() const;
  std::uint8_t getRelayCount() const;
  bool setRelayCount(std::uint8_t relayCount);
  bool getRelayActiveHigh() const;
  bool setRelayActiveHigh(bool activeHigh);
  static constexpr bool isSupportedRelayCount(std::uint8_t count) {
    return lucky::isSupportedRelayCount(count);
  }
  bool resetToDefaults();
  bool usedRelayCountFallback() const;
  // True when this boot found the NVS namespace empty (no device id, no API key) and had to write
  // defaults. A controller that was provisioned earlier and reports this lost its stored settings.
  bool storageWasEmptyAtBoot() const;
  // True when this boot put lost settings back from the backup.
  bool storageRestoredAtBoot() const;
  // True when the backup holds exactly the settings in use: the controller can recover by itself.
  bool provisioningBackedUp() const;
  bool hasUniqueDeviceKey() const;
  bool stageDeviceKey(const String& newKey, const String& transitionId);
  bool commitDeviceKey(const String& transitionId);
  bool rollbackDeviceKey(const String& transitionId);
  String candidateDeviceKey() const;
  String deviceKeyTransitionId() const;
  bool stageWifiCandidate(const String& ssid, const String& password, const String& transitionId);
  bool commitWifiCandidate(const String& transitionId);
  bool clearWifiCandidate();
  String candidateWifiSSID() const;
  String candidateWifiPassword() const;
  String wifiTransitionId() const;
  bool setWifiProvisioningState(const String& state);
  String wifiProvisioningState() const;
  bool hasSetupCode() const;
  String setupCode() const;
  String setupCodeCandidate() const;
  String setupCodeTransitionId() const;
  bool stageSetupCode(const String& code, const String& transitionId);
  bool commitSetupCode(const String& transitionId);
  bool rollbackSetupCode(const String& transitionId);
  std::uint16_t setupCodeVersion() const;
  String setupModeState() const;
  bool setSetupModeState(const String& state);
  std::uint8_t setupFailedAttempts() const;
  bool setSetupFailedAttempts(std::uint8_t attempts);
  static String deviceIdFromHardware(std::uint64_t hardwareId);

 private:
  StorageService& storage_;
  ILogger& logger_;
  DeviceConfig config_{};
  bool initialized_{false};
  bool usedFallback_{false};
  bool freshStorage_{false};
  ProvisioningBackup* backup_{nullptr};
  bool restoredAtBoot_{false};
  bool backupCurrent_{false};
  DeviceConfig defaults() const;
  ProvisioningSnapshot storedSnapshot();
  bool writeSnapshot(const ProvisioningSnapshot& snapshot);
  bool readBackup(ProvisioningSnapshot& snapshot);
  void restoreFromBackup();
  void syncBackup();
};

}  // namespace lucky
