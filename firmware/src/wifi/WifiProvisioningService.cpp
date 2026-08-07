#include "wifi/WifiProvisioningService.h"

namespace lucky {

WifiProvisioningService::WifiProvisioningService(ConfigService& config, RelayService& relays, ILogger& logger)
    : config_(config), relays_(relays), logger_(logger) {}

bool WifiProvisioningService::relaySafe() const {
  const auto states = relays_.getAllStates();
  for (std::uint8_t index = 0; index < relays_.getRelayCount(); ++index) {
    if (states[index].state == RelayState::On) return false;
  }
  return true;
}

void WifiProvisioningService::setState(const String& state) {
  state_ = state; stateStartedMs_ = millis(); config_.setWifiProvisioningState(state);
}

bool WifiProvisioningService::startScan() {
  if (scanRequested_ || scanRunning_) return true;
  if (networkCount_ > 0) return true;
  // Defer the potentially slow ESP32 scan until after the HTTP handler has
  // returned its acknowledgement to the manager.
  scanRequested_ = true;
  return true;
}

void WifiProvisioningService::collectScan() {
  const int count = WiFi.scanComplete();
  if (count == WIFI_SCAN_RUNNING) return;
  scanRunning_ = false; networkCount_ = 0;
  if (count < 0) return;
  for (int index = 0; index < count && networkCount_ < kMaximumNetworks; ++index) {
    const String ssid = WiFi.SSID(index);
    bool duplicate = false;
    for (std::uint8_t existing = 0; existing < networkCount_; ++existing) {
      if (networks_[existing].ssid == ssid) { duplicate = true; break; }
    }
    if (duplicate) continue;
    networks_[networkCount_++] = {ssid, WiFi.RSSI(index), WiFi.encryptionType(index) != WIFI_AUTH_OPEN, ssid.isEmpty()};
  }
  WiFi.scanDelete();
}

bool WifiProvisioningService::stage(const String& ssid, const String& password, const String& transitionId) {
  const bool idle = state_ == "IDLE" || state_ == "COMMITTED" || state_ == "ORIGINAL_NETWORK_RESTORED";
  if (!config_.hasUniqueDeviceKey() || !idle || !relaySafe()) return false;
  errorCode_ = "";
  if (!config_.stageWifiCandidate(ssid, password, transitionId)) return false;
  setState("CANDIDATE_STORED");
  logger_.info("WIFI_CANDIDATE_STORED", "Wi-Fi candidate stored without logging credentials");
  return true;
}

void WifiProvisioningService::connectCandidate() {
  setState("CONNECTING_CANDIDATE");
  WiFi.disconnect(false, false);
  WiFi.begin(config_.candidateWifiSSID().c_str(), config_.candidateWifiPassword().c_str());
}

void WifiProvisioningService::connectCommitted() {
  const auto& committed = config_.getConfig();
  WiFi.disconnect(false, false);
  WiFi.begin(committed.wifiSSID.c_str(), committed.wifiPassword.c_str());
}

bool WifiProvisioningService::rollback(const String& transitionId, const char* reason) {
  if (!config_.wifiTransitionId().isEmpty() && transitionId != config_.wifiTransitionId()) return false;
  setState("ROLLING_BACK");
  errorCode_ = reason;
  config_.clearWifiCandidate();
  connectCommitted();
  state_ = "ORIGINAL_NETWORK_RESTORED";
  logger_.warning("WIFI_PROVISIONING_ROLLED_BACK", reason);
  return true;
}

bool WifiProvisioningService::commit(const String& transitionId) {
  if (state_ != "WAITING_FOR_COMMIT" || transitionId != config_.wifiTransitionId() || !relaySafe()) return false;
  if (!config_.commitWifiCandidate(transitionId)) return false;
  state_ = "COMMITTED"; errorCode_ = "";
  logger_.info("WIFI_PROVISIONING_COMMITTED", "Wi-Fi candidate committed");
  return true;
}

void WifiProvisioningService::loop() {
  if (scanRequested_ && !scanRunning_) {
    scanRequested_ = false;
    networkCount_ = 0;
    if (WiFi.scanNetworks(true, true, false, kScanMaxMsPerChannel) != WIFI_SCAN_FAILED) scanRunning_ = true;
    else logger_.warning("WIFI_SCAN_START_FAILED", "Unable to start asynchronous Wi-Fi scan");
  }
  if (scanRunning_) collectScan();
  if (state_ == "IDLE" || state_ == "COMMITTED" || state_ == "ORIGINAL_NETWORK_RESTORED") return;
  if (!relaySafe()) { rollback(config_.wifiTransitionId(), "RELAY_SAFE_STATE_CONFLICT"); return; }
  if (state_ == "CANDIDATE_STORED" && millis() - stateStartedMs_ >= kSwitchDelayMs) connectCandidate();
  else if (state_ == "CONNECTING_CANDIDATE") {
    if (WiFi.status() == WL_CONNECTED) setState("WAITING_FOR_COMMIT");
    else if (millis() - stateStartedMs_ >= kCandidateConnectionTimeoutMs) rollback(config_.wifiTransitionId(), "CANDIDATE_CONNECTION_FAILED");
  } else if (state_ == "WAITING_FOR_COMMIT" && millis() - stateStartedMs_ >= kCommitTimeoutMs) {
    rollback(config_.wifiTransitionId(), "COMMIT_TIMEOUT");
  }
}

const String& WifiProvisioningService::state() const { return state_; }
const String& WifiProvisioningService::errorCode() const { return errorCode_; }
String WifiProvisioningService::transitionId() const { return config_.wifiTransitionId(); }
std::uint8_t WifiProvisioningService::networkCount() const { return networkCount_; }
const WifiNetworkInfo& WifiProvisioningService::network(const std::uint8_t index) const { return networks_[index]; }
bool WifiProvisioningService::scanRunning() const { return scanRequested_ || scanRunning_; }

}  // namespace lucky
