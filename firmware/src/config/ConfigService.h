#pragma once

#include <cstdint>
#include "config/DeviceConfig.h"
#include "logging/ILogger.h"
#include "storage/StorageService.h"

namespace lucky {

class ConfigService {
 public:
  ConfigService(StorageService& storage, ILogger& logger);
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
  DeviceConfig defaults() const;
};

}  // namespace lucky
