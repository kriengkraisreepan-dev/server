#pragma once

#include <Arduino.h>
#include "config/ConfigService.h"
#include "wifi/WifiService.h"

namespace lucky {

class HealthService {
 public:
  HealthService(const ConfigService& config, const WifiService& wifi);
  const char* status() const;
  unsigned long uptimeSeconds() const;
  bool wifiConnected() const;
  int rssi() const;
  std::uint32_t freeHeapBytes() const;

 private:
  const ConfigService& config_;
  const WifiService& wifi_;
};

}  // namespace lucky
