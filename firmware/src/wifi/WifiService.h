#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include "config/ConfigService.h"
#include "logging/ILogger.h"

namespace lucky {

class WifiService {
 public:
  WifiService(const ConfigService& config, ILogger& logger);
  void initialize();
  void loop();
  bool isConnected() const;
  int rssi() const;
  String localIp() const;
  // How long the link has been down without a break, 0 while connected. Lets the caller decide
  // when waiting is no longer worth it.
  unsigned long offlineMs() const;

 private:
  static constexpr unsigned long kReconnectIntervalMs = 15000;
  const ConfigService& config_;
  ILogger& logger_;
  bool previouslyConnected_{false};
  unsigned long lastAttemptMs_{0};
  unsigned long offlineSinceMs_{0};
  void connect();
};

}  // namespace lucky
