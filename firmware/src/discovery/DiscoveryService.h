#pragma once

#include <Arduino.h>
#include <WiFiUdp.h>
#include "config/ConfigService.h"
#include "logging/ILogger.h"
#include "relay/RelayService.h"
#include "wifi/WifiService.h"

namespace lucky {

class DiscoveryService {
 public:
  static constexpr std::uint16_t kDiscoveryPort = 42101;
  static constexpr std::size_t kMaximumPacketSize = 512;

  DiscoveryService(const ConfigService& config, const WifiService& wifi,
                   const RelayService& relays, ILogger& logger);
  void loop();

 private:
  static constexpr unsigned long kMinimumResponseIntervalMs = 250;
  const ConfigService& config_;
  const WifiService& wifi_;
  const RelayService& relays_;
  ILogger& logger_;
  WiFiUDP udp_;
  bool active_{false};
  unsigned long lastResponseMs_{0};

  void start();
  void stop();
  void handlePacket();
  String hostname() const;
};

}  // namespace lucky
