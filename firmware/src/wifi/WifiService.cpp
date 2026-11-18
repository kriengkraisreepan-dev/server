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
  // After a router restart the station can sit half-associated, and begin() on top of that attempt
  // does not always restart it. Dropping the old attempt first makes every retry a clean one.
  WiFi.disconnect(false, false);
  WiFi.begin(config.wifiSSID.c_str(), config.wifiPassword.c_str());
}

void WifiService::loop() {
  const bool connected = isConnected();
  if (connected && !previouslyConnected_) logger_.info("WIFI_CONNECTED", WiFi.localIP().toString().c_str());
  if (!connected && previouslyConnected_) logger_.warning("WIFI_LOST", "Wi-Fi connection lost");
  if (connected) offlineSinceMs_ = 0;
  else if (!offlineSinceMs_) offlineSinceMs_ = millis();
  previouslyConnected_ = connected;
  if (!connected && millis() - lastAttemptMs_ >= kReconnectIntervalMs) connect();
}

bool WifiService::isConnected() const { return WiFi.status() == WL_CONNECTED; }
unsigned long WifiService::offlineMs() const { return offlineSinceMs_ ? millis() - offlineSinceMs_ : 0; }
int WifiService::rssi() const { return isConnected() ? WiFi.RSSI() : 0; }
String WifiService::localIp() const { return isConnected() ? WiFi.localIP().toString() : String(); }

}  // namespace lucky
