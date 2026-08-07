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

 private:
  static constexpr unsigned long kReconnectIntervalMs = 10000;
  const ConfigService& config_;
  ILogger& logger_;
  bool previouslyConnected_{false};
  unsigned long lastAttemptMs_{0};
  void connect();
};

}  // namespace lucky
