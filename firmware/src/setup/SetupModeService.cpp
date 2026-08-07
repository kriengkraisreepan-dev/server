#include "setup/SetupModeService.h"

#include <esp_system.h>

namespace lucky {

SetupModeService::SetupModeService(ConfigService& config, RelayService& relays,
                                   WifiProvisioningService& provisioning, ILogger& logger)
    : config_(config), relays_(relays), provisioning_(provisioning), logger_(logger) {}

void SetupModeService::initialize() {
  failedAttempts_ = config_.setupFailedAttempts();
  if (failedAttempts_ >= kMaximumAttempts) { lockoutStartedMs_ = millis(); state_ = "NORMAL"; }
#if LUCKY_SETUP_BUTTON_ENABLED
  pinMode(kSetupButtonGpio, INPUT);  // GPIO34 requires the approved external 10k pull-up.
  buttonStableLow_ = digitalRead(kSetupButtonGpio) == LOW;
  buttonReleasedMs_ = buttonStableLow_ ? 0 : millis();
#endif
}

void SetupModeService::setState(const String& state) {
  if (state_ == state) return;
  state_ = state;
  config_.setSetupModeState(state);
}

bool SetupModeService::relaySafe() const { return provisioning_.relaySafe(); }

bool SetupModeService::constantTimeEqual(const String& left, const String& right) const {
  if (left.length() != right.length()) return false;
  std::uint8_t difference = 0;
  for (unsigned int index = 0; index < left.length(); ++index) difference |= left[index] ^ right[index];
  return difference == 0;
}

String SetupModeService::randomToken() const {
  std::uint8_t bytes[24]{};
  esp_fill_random(bytes, sizeof(bytes));
  char encoded[49]{};
  for (std::size_t index = 0; index < sizeof(bytes); ++index) snprintf(encoded + index * 2, 3, "%02x", bytes[index]);
  return String(encoded);
}

String SetupModeService::apSsid() const {
  const String id = config_.getConfig().deviceId;
  return "Lucky-Relay-" + id.substring(id.length() > 5 ? id.length() - 5 : 0);
}

bool SetupModeService::start(const char* source) {
#if !LUCKY_SETUP_AP_ENABLED
  return false;
#else
  if (active() || !config_.hasUniqueDeviceKey() || !config_.hasSetupCode() || !relaySafe() ||
      !config_.wifiTransitionId().isEmpty()) return false;
  setState("STARTING_AP");
  WiFi.mode(WIFI_AP_STA);
  const IPAddress ip(192, 168, 4, 1), gateway(192, 168, 4, 1), subnet(255, 255, 255, 0);
  WiFi.softAPConfig(ip, gateway, subnet);
  if (!WiFi.softAP(apSsid().c_str(), config_.setupCode().c_str(), 1, false, 1)) {
    setState("NORMAL");
    logger_.error("SETUP_AP_START_FAILED", "Setup AP could not start");
    return false;
  }
  dns_.start(53, "*", ip);
  apStartedMs_ = millis(); automaticRecovery_ = String(source) == "AUTOMATIC";
  failedAttempts_ = 0; config_.setSetupFailedAttempts(0); lockoutStartedMs_ = 0; invalidateSession(); setState("AP_ACTIVE");
  logger_.info("SETUP_AP_STARTED", source);
  return true;
#endif
}

void SetupModeService::stop(const char* reason) {
  dns_.stop(); WiFi.softAPdisconnect(true); invalidateSession();
  setState("NORMAL"); recoveryCooldownStartedMs_ = millis(); automaticRecovery_ = false;
  logger_.info("SETUP_AP_STOPPED", reason);
}

bool SetupModeService::lockedOut() const {
  return lockoutStartedMs_ && millis() - lockoutStartedMs_ < kLockoutMs;
}

unsigned long SetupModeService::lockoutRemainingMs() const {
  if (!lockedOut()) return 0;
  return kLockoutMs - (millis() - lockoutStartedMs_);
}

bool SetupModeService::authenticate(const String& supplied, String& token, String& errorCode) {
  if (!active()) { errorCode = "SETUP_MODE_INACTIVE"; return false; }
  if (lockedOut()) { errorCode = "PORTAL_LOCKED_OUT"; return false; }
  String normalized;
  for (unsigned int index = 0; index < supplied.length(); ++index) if (supplied[index] != '-') normalized += static_cast<char>(toupper(supplied[index]));
  if (!constantTimeEqual(normalized, config_.setupCode())) {
    failedAttempts_++; config_.setSetupFailedAttempts(failedAttempts_);
    logger_.warning("PORTAL_AUTHENTICATION_FAILED", "Setup Code authentication failed");
    if (failedAttempts_ >= kMaximumAttempts) {
      lockoutStartedMs_ = millis(); setState("LOCKED_OUT");
      logger_.warning("PORTAL_LOCKOUT_STARTED", "Maximum Setup Code attempts reached");
    }
    errorCode = "PORTAL_AUTHENTICATION_FAILED"; return false;
  }
  failedAttempts_ = 0; config_.setSetupFailedAttempts(0); lockoutStartedMs_ = 0; sessionToken_ = randomToken();
  sessionStartedMs_ = sessionLastSeenMs_ = millis(); setState("PORTAL_AUTHENTICATED");
  token = sessionToken_; return true;
}

bool SetupModeService::authenticateSetupCodeForRecovery(const String& supplied, String& errorCode) {
  if (lockedOut()) { errorCode = "PORTAL_LOCKED_OUT"; return false; }
  String normalized;
  for (unsigned int index = 0; index < supplied.length(); ++index) if (supplied[index] != '-') normalized += static_cast<char>(toupper(supplied[index]));
  if (!constantTimeEqual(normalized, config_.setupCode())) {
    failedAttempts_++; config_.setSetupFailedAttempts(failedAttempts_);
    logger_.warning("USB_SETUP_CODE_FAILED", "Setup Code authentication failed");
    if (failedAttempts_ >= kMaximumAttempts) { lockoutStartedMs_ = millis(); logger_.warning("USB_SETUP_CODE_LOCKOUT", "Maximum Setup Code attempts reached"); }
    errorCode = "SETUP_CODE_INVALID"; return false;
  }
  failedAttempts_ = 0; config_.setSetupFailedAttempts(0); lockoutStartedMs_ = 0; return true;
}

bool SetupModeService::validSession(const String& token, const bool touch) {
  if (sessionToken_.isEmpty() || !constantTimeEqual(token, sessionToken_)) return false;
  if (millis() - sessionStartedMs_ >= kSessionLifetimeMs || millis() - sessionLastSeenMs_ >= kSessionIdleMs) {
    invalidateSession(); return false;
  }
  if (touch) sessionLastSeenMs_ = millis();
  return true;
}

void SetupModeService::invalidateSession() { sessionToken_ = ""; portalTransitionId_ = ""; sessionStartedMs_ = sessionLastSeenMs_ = 0; }

bool SetupModeService::submitCandidate(const String& token, const String& ssid, const String& password,
                                       const String& transitionId, String& errorCode) {
  if (!validSession(token)) { errorCode = "PORTAL_SESSION_INVALID"; return false; }
  if (portalTransitionId_.isEmpty() || transitionId != portalTransitionId_) {
    errorCode = "PORTAL_TRANSITION_INVALID"; return false;
  }
  if (!relaySafe()) { errorCode = "RELAY_SAFE_STATE_CONFLICT"; return false; }
  if (!provisioning_.stage(ssid, password, transitionId)) { portalTransitionId_ = ""; errorCode = "WIFI_CANDIDATE_REJECTED"; return false; }
  setState("CONNECTING_CANDIDATE"); return true;
}

bool SetupModeService::issueTransition(const String& clientNonce, String& transitionId, String& errorCode) {
  if (clientNonce.length() < 32 || clientNonce.length() > 128) { errorCode = "CLIENT_SECURE_RANDOM_REQUIRED"; return false; }
  for (unsigned int index = 0; index < clientNonce.length(); ++index) {
    if (!isHexadecimalDigit(clientNonce[index])) { errorCode = "CLIENT_SECURE_RANDOM_REQUIRED"; return false; }
  }
  portalTransitionId_ = randomToken();
  if (portalTransitionId_.length() < 16) { portalTransitionId_ = ""; errorCode = "SECURE_RANDOM_UNAVAILABLE"; return false; }
  transitionId = portalTransitionId_; return true;
}

bool SetupModeService::commitCandidate(const String& token, const String& transitionId, String& errorCode) {
  if (!validSession(token)) { errorCode = "PORTAL_SESSION_INVALID"; return false; }
  if (portalTransitionId_.isEmpty() || transitionId != portalTransitionId_) { errorCode = "PORTAL_TRANSITION_INVALID"; return false; }
  if (!provisioning_.commit(transitionId)) { errorCode = "WIFI_COMMIT_REJECTED"; return false; }
  setState("COMMITTED"); return true;
}

bool SetupModeService::rollbackCandidate(const String& token, const String& transitionId) {
  if (!validSession(token)) return false;
  if (portalTransitionId_.isEmpty() || transitionId != portalTransitionId_) return false;
  const bool result = provisioning_.rollback(transitionId, "PORTAL_REQUESTED_ROLLBACK");
  if (result) { portalTransitionId_ = ""; setState("AP_ACTIVE"); }
  return result;
}

bool SetupModeService::active() const { return state_ != "NORMAL"; }
const String& SetupModeService::state() const { return state_; }
unsigned long SetupModeService::remainingMs() const {
  if (!active()) return 0;
  const unsigned long elapsed = millis() - apStartedMs_;
  return elapsed >= kApLifetimeMs ? 0 : kApLifetimeMs - elapsed;
}

void SetupModeService::processButton() {
#if LUCKY_SETUP_BUTTON_ENABLED
  const bool low = digitalRead(kSetupButtonGpio) == LOW;
  if (low != buttonStableLow_ && millis() - buttonChangedMs_ >= kButtonDebounceMs) {
    buttonStableLow_ = low; buttonChangedMs_ = millis();
    if (low) { buttonPressedMs_ = millis(); buttonReleasedMs_ = 0; }
    else { buttonConsumed_ = false; buttonReleasedMs_ = millis(); }
  }
  if (!buttonStableLow_ && !buttonArmed_ && buttonReleasedMs_ && millis() - buttonReleasedMs_ >= kButtonArmMs) buttonArmed_ = true;
  if (buttonArmed_ && buttonStableLow_ && !buttonConsumed_ && millis() - buttonPressedMs_ >= kButtonHoldMs) {
    buttonConsumed_ = true;
    if (!start("PHYSICAL_BUTTON")) logger_.warning("SETUP_MODE_REJECTED", "Physical Setup request was not eligible");
  }
#endif
}

void SetupModeService::processAutomaticRecovery() {
#if LUCKY_AUTOMATIC_WIFI_RECOVERY_ENABLED
  if (WiFi.status() == WL_CONNECTED) { wifiLostMs_ = 0; return; }
  if (!wifiLostMs_) wifiLostMs_ = millis();
  if (!active() && millis() - wifiLostMs_ >= kWifiUnavailableMs && relaySafe() &&
      config_.wifiTransitionId().isEmpty() && (!recoveryCooldownStartedMs_ || millis() - recoveryCooldownStartedMs_ >= kRecoveryCooldownMs)) {
    start("AUTOMATIC");
  }
#endif
}

void SetupModeService::loop() {
  processButton(); processAutomaticRecovery();
  if (!active()) return;
  dns_.processNextRequest();
  if (lockedOut()) setState("LOCKED_OUT");
  else if (state_ == "LOCKED_OUT") { setState("AP_ACTIVE"); failedAttempts_ = 0; config_.setSetupFailedAttempts(0); lockoutStartedMs_ = 0; }
  if (provisioning_.state() == "WAITING_FOR_COMMIT") setState("WAITING_FOR_CONFIRMATION");
  if (provisioning_.state() == "ORIGINAL_NETWORK_RESTORED") setState("AP_ACTIVE");
  if (!relaySafe() && !config_.wifiTransitionId().isEmpty()) provisioning_.rollback(config_.wifiTransitionId(), "RELAY_SAFE_STATE_CONFLICT");
  if (millis() - apStartedMs_ >= kApLifetimeMs) {
    if (!config_.wifiTransitionId().isEmpty()) provisioning_.rollback(config_.wifiTransitionId(), "AP_TIMEOUT");
    stop("AP_TIMEOUT");
  }
}

}  // namespace lucky
