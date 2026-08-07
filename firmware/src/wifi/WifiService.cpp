#include "wifi/WifiService.h"

namespace lucky {

WifiService::WifiService(const ConfigService& config, ILogger& logger)
    : config_(config), logger_(logger) {}

void WifiService::initialize() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);
  connect();
}

void WifiService::connect() {
  const auto& config = config_.getConfig();
  lastAttemptMs_ = millis();
  if (config.wifiSSID.isEmpty()) {
    logger_.warning("WIFI_NOT_CONFIGURED", "Wi-Fi SSID is empty");
    return;
  }
  WiFi.begin(config.wifiSSID.c_str(), config.wifiPassword.c_str());
}

void WifiService::loop() {
  const bool connected = isConnected();
  if (connected && !previouslyConnected_) logger_.info("WIFI_CONNECTED", WiFi.localIP().toString().c_str());
  if (!connected && previouslyConnected_) logger_.warning("WIFI_LOST", "Wi-Fi connection lost");
  previouslyConnected_ = connected;
  if (!connected && millis() - lastAttemptMs_ >= kReconnectIntervalMs) connect();
}

bool WifiService::isConnected() const { return WiFi.status() == WL_CONNECTED; }
int WifiService::rssi() const { return isConnected() ? WiFi.RSSI() : 0; }
String WifiService::localIp() const { return isConnected() ? WiFi.localIP().toString() : String(); }

}  // namespace lucky
