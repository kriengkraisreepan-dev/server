#pragma once
#include <Arduino.h>
#include "config/ConfigService.h"
#include "logging/ILogger.h"
#include "relay/RelayService.h"
#include "setup/SetupModeService.h"
#include "wifi/WifiProvisioningService.h"

namespace lucky {
class SerialRecoveryService {
 public:
  SerialRecoveryService(Stream& serial, ConfigService& config, RelayService& relays, WifiProvisioningService& wifi, SetupModeService& setup, ILogger& logger);
  void loop();
 private:
  static constexpr std::size_t kMaximumPayload = 768;
  static constexpr unsigned long kTransactionTimeoutMs = 120000;
  Stream& serial_; ConfigService& config_; RelayService& relays_; WifiProvisioningService& wifi_; SetupModeService& setup_; ILogger& logger_;
  String input_; String keyTransitionId_; unsigned long keyTransitionStartedMs_{0};
  void handle(const String& payload); void response(const char* command, bool ok, const char* errorCode = nullptr);
  bool relaySafe() const; bool validText(const String& value, std::size_t minimum, std::size_t maximum) const;
  static String hmac(const String& key, const String& message); static bool constantTimeEqual(const String& left, const String& right);
};
}
