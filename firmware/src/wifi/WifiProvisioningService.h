#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include "config/ConfigService.h"
#include "logging/ILogger.h"
#include "relay/RelayService.h"

namespace lucky {

struct WifiNetworkInfo {
  String ssid;
  int rssi;
  bool secured;
  bool hidden;
};

class WifiProvisioningService {
 public:
  WifiProvisioningService(ConfigService& config, RelayService& relays, ILogger& logger);
  void loop();
  bool startScan();
  bool stage(const String& ssid, const String& password, const String& transitionId);
  bool commit(const String& transitionId);
  bool rollback(const String& transitionId, const char* reason);
  const String& state() const;
  const String& errorCode() const;
  String transitionId() const;
  std::uint8_t networkCount() const;
  const WifiNetworkInfo& network(std::uint8_t index) const;
  bool scanRunning() const;
  bool relaySafe() const;

 private:
  static constexpr unsigned long kSwitchDelayMs = 750;
  static constexpr unsigned long kCandidateConnectionTimeoutMs = 30000;
  static constexpr unsigned long kCommitTimeoutMs = 90000;
  static constexpr std::uint32_t kScanMaxMsPerChannel = 120;
  static constexpr std::uint8_t kMaximumNetworks = 32;
  ConfigService& config_;
  RelayService& relays_;
  ILogger& logger_;
  String state_{"IDLE"};
  String errorCode_;
  unsigned long stateStartedMs_{0};
  bool scanRequested_{false};
  bool scanRunning_{false};
  WifiNetworkInfo networks_[kMaximumNetworks]{};
  std::uint8_t networkCount_{0};
  void setState(const String& state);
  void connectCandidate();
  void connectCommitted();
  void collectScan();
};

}  // namespace lucky
