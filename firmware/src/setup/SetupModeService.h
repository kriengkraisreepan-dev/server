#pragma once

#include <Arduino.h>
#include <DNSServer.h>
#include <WiFi.h>
#include "BuildConfig.h"
#include "config/ConfigService.h"
#include "logging/ILogger.h"
#include "relay/RelayService.h"
#include "wifi/WifiProvisioningService.h"

namespace lucky {

class SetupModeService {
 public:
  SetupModeService(ConfigService& config, RelayService& relays,
                   WifiProvisioningService& provisioning, ILogger& logger);
  void initialize();
  void loop();
  bool start(const char* source);
  bool authenticateSetupCodeForRecovery(const String& supplied, String& errorCode);
  void stop(const char* reason);
  bool authenticate(const String& code, String& token, String& errorCode);
  bool validSession(const String& token, bool touch = true);
  bool submitCandidate(const String& token, const String& ssid, const String& password,
                       const String& transitionId, String& errorCode);
  bool issueTransition(const String& clientNonce, String& transitionId, String& errorCode);
  bool commitCandidate(const String& token, const String& transitionId, String& errorCode);
  bool rollbackCandidate(const String& token, const String& transitionId);
  bool active() const;
  bool lockedOut() const;
  const String& state() const;
  String apSsid() const;
  unsigned long remainingMs() const;
  unsigned long lockoutRemainingMs() const;
  void invalidateSession();

 private:
  static constexpr std::uint8_t kSetupButtonGpio = 34;
  static constexpr unsigned long kButtonDebounceMs = 50;
  static constexpr unsigned long kButtonHoldMs = 5000;
  static constexpr unsigned long kButtonArmMs = 2000;
  static constexpr unsigned long kWifiUnavailableMs = 60000;
  static constexpr unsigned long kApLifetimeMs = 900000;
  static constexpr unsigned long kSessionLifetimeMs = 600000;
  static constexpr unsigned long kSessionIdleMs = 300000;
  static constexpr unsigned long kLockoutMs = 600000;
  static constexpr unsigned long kRecoveryCooldownMs = 60000;
  static constexpr std::uint8_t kMaximumAttempts = 5;
  ConfigService& config_;
  RelayService& relays_;
  WifiProvisioningService& provisioning_;
  ILogger& logger_;
  DNSServer dns_;
  String state_{"NORMAL"};
  String sessionToken_;
  String portalTransitionId_;
  unsigned long apStartedMs_{0};
  unsigned long sessionStartedMs_{0};
  unsigned long sessionLastSeenMs_{0};
  unsigned long lockoutStartedMs_{0};
  unsigned long wifiLostMs_{0};
  unsigned long recoveryCooldownStartedMs_{0};
  unsigned long buttonChangedMs_{0};
  unsigned long buttonPressedMs_{0};
  unsigned long buttonReleasedMs_{0};
  std::uint8_t failedAttempts_{0};
  bool buttonStableLow_{false};
  bool buttonArmed_{false};
  bool buttonConsumed_{false};
  bool automaticRecovery_{false};
  bool relaySafe() const;
  bool constantTimeEqual(const String& left, const String& right) const;
  String randomToken() const;
  void processButton();
  void processAutomaticRecovery();
  void setState(const String& state);
};

}  // namespace lucky
