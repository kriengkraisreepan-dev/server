#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <WebServer.h>
#include "auth/AuthService.h"
#include "config/ConfigService.h"
#include "health/HealthService.h"
#include "logging/Logger.h"
#include "relay/RelayService.h"
#include "setup/SetupModeService.h"
#include "wifi/WifiProvisioningService.h"

namespace lucky {

class ApiServer {
 public:
  ApiServer(ConfigService& config, RelayService& relays, AuthService& auth,
            HealthService& health, WifiProvisioningService& wifiProvisioning,
            SetupModeService& setupMode, Logger& logger);
  void initialize();
  void loop();

 private:
  static constexpr std::uint16_t kPort = 80;
  static constexpr const char* kJsonContentType = "application/json";
  WebServer server_{kPort};
  ConfigService& config_;
  RelayService& relays_;
  AuthService& auth_;
  HealthService& health_;
  WifiProvisioningService& wifiProvisioning_;
  SetupModeService& setupMode_;
  Logger& logger_;

  void registerRoutes();
  void handleHealth();
  void handleDevice();
  void handleVerifyDevice();
  void handleStageDeviceKey();
  void handleCommitDeviceKey();
  void handleRollbackDeviceKey();
  void handleWifiNetworks();
  void handleWifiStatus();
  void handleWifiCandidate();
  void handleWifiCommit();
  void handleWifiRollback();
  void handleStageSetupCode();
  void handleVerifySetupCode();
  void handleCommitSetupCode();
  void handleRollbackSetupCode();
  void handleSetupModeStart();
  void handleSetupModeStatus();
  void handleSetupModeStop();
  void handlePortalPage();
  void handlePortalAuthenticate();
  void handlePortalNetworks();
  void handlePortalStatus();
  void handlePortalTransition();
  void handlePortalCandidate();
  void handlePortalCommit();
  void handlePortalRollback();
  void handleRelays();
  void handleAllOff();
  void handleGetRelayConfig();
  void handleSetRelayConfig();
  void handleNotFound();
  void handleRelayState(long channel);
  bool requireAuthentication();
  bool requirePortalSession(String& token);
  bool portalRequestAllowed();
  bool parseRelayStatePath(const String& path, long& channel) const;
  void sendSuccess(int statusCode, ArduinoJson::JsonDocument& document);
  void sendError(int statusCode, const char* code, const String& message);
  void appendRelayConfiguration(ArduinoJson::JsonDocument& document) const;
  const char* requestMethodName();
};

}  // namespace lucky
