#include "api/ApiServer.h"

#include <ArduinoJson.h>
#include <cstring>
#include <cstdlib>
#include <mbedtls/md.h>
#include "config/DeviceConfig.h"
#include "lucky/RelayConfig.h"
#include "utils/ApiJson.h"

namespace lucky {
namespace {
constexpr const char* kHealthPath = "/api/v1/health";
constexpr const char* kDevicePath = "/api/v1/device";
constexpr const char* kDeviceVerifyPath = "/api/v1/device/verify";
constexpr const char* kDeviceKeyCandidatePath = "/api/v1/device/key/candidate";
constexpr const char* kDeviceKeyCommitPath = "/api/v1/device/key/commit";
constexpr const char* kDeviceKeyRollbackPath = "/api/v1/device/key/rollback";
constexpr const char* kWifiNetworksPath = "/api/v1/wifi/networks";
constexpr const char* kWifiStatusPath = "/api/v1/wifi/provisioning/status";
constexpr const char* kWifiCandidatePath = "/api/v1/wifi/provisioning/candidate";
constexpr const char* kWifiCommitPath = "/api/v1/wifi/provisioning/commit";
constexpr const char* kWifiRollbackPath = "/api/v1/wifi/provisioning/rollback";
constexpr const char* kSetupCodeCandidatePath = "/api/v1/setup/code/candidate";
constexpr const char* kSetupCodeVerifyPath = "/api/v1/setup/code/verify";
constexpr const char* kSetupCodeCommitPath = "/api/v1/setup/code/commit";
constexpr const char* kSetupCodeRollbackPath = "/api/v1/setup/code/rollback";
constexpr const char* kSetupModeStartPath = "/api/v1/setup/mode/start";
constexpr const char* kSetupModeStatusPath = "/api/v1/setup/mode/status";
constexpr const char* kSetupModeStopPath = "/api/v1/setup/mode/stop";
constexpr const char* kPortalAuthPath = "/setup/api/auth";
constexpr const char* kPortalNetworksPath = "/setup/api/networks";
constexpr const char* kPortalStatusPath = "/setup/api/status";
constexpr const char* kPortalTransitionPath = "/setup/api/transition";
constexpr const char* kPortalCandidatePath = "/setup/api/candidate";
constexpr const char* kPortalCommitPath = "/setup/api/commit";
constexpr const char* kPortalRollbackPath = "/setup/api/rollback";
constexpr const char* kRelaysPath = "/api/v1/relays";
constexpr const char* kAllOffPath = "/api/v1/relays/all/off";
constexpr const char* kRelayConfigPath = "/api/v1/config/relay";
constexpr const char* kRelayStatePrefix = "/api/v1/relays/";
constexpr const char* kRelayStateSuffix = "/state";
constexpr const char* kAuthenticationHeader = "X-Lucky-Device-Key";
constexpr const char* kPortalSessionHeader = "X-Lucky-Setup-Session";

String verificationProof(const String& key, const String& nonce, const String& deviceId,
                         const std::uint8_t migrationVersion) {
  const String message = nonce + ":" + deviceId + ":" + String(migrationVersion);
  unsigned char digest[32]{};
  const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  mbedtls_md_hmac(info, reinterpret_cast<const unsigned char*>(key.c_str()), key.length(),
                  reinterpret_cast<const unsigned char*>(message.c_str()), message.length(), digest);
  char encoded[65]{};
  for (std::size_t index = 0; index < sizeof(digest); ++index) {
    snprintf(encoded + index * 2, 3, "%02x", digest[index]);
  }
  return String(encoded);
}

bool validNonce(const String& nonce) {
  if (nonce.length() < 32 || nonce.length() > 64) return false;
  for (unsigned int index = 0; index < nonce.length(); ++index) {
    if (!isHexadecimalDigit(nonce[index])) return false;
  }
  return true;
}
}  // namespace

ApiServer::ApiServer(ConfigService& config, RelayService& relays, AuthService& auth,
                     HealthService& health, WifiProvisioningService& wifiProvisioning,
                     SetupModeService& setupMode, Logger& logger)
    : config_(config), relays_(relays), auth_(auth), health_(health),
      wifiProvisioning_(wifiProvisioning), setupMode_(setupMode), logger_(logger) {}

void ApiServer::initialize() {
  const char* headers[] = {kAuthenticationHeader, kPortalSessionHeader, "Host", "Origin"};
  server_.collectHeaders(headers, 4);
  registerRoutes();
  server_.begin();
  logger_.info("API_STARTED", "REST API v1 listening on port 80");
}

void ApiServer::loop() { server_.handleClient(); }

void ApiServer::registerRoutes() {
  server_.on(kHealthPath, HTTP_GET, [this]() { handleHealth(); });
  server_.on(kDevicePath, HTTP_GET, [this]() { handleDevice(); });
  server_.on(kDeviceVerifyPath, HTTP_POST, [this]() { handleVerifyDevice(); });
  server_.on(kDeviceKeyCandidatePath, HTTP_POST, [this]() { handleStageDeviceKey(); });
  server_.on(kDeviceKeyCommitPath, HTTP_POST, [this]() { handleCommitDeviceKey(); });
  server_.on(kDeviceKeyRollbackPath, HTTP_POST, [this]() { handleRollbackDeviceKey(); });
  server_.on(kWifiNetworksPath, HTTP_GET, [this]() { handleWifiNetworks(); });
  server_.on(kWifiStatusPath, HTTP_GET, [this]() { handleWifiStatus(); });
  server_.on(kWifiCandidatePath, HTTP_POST, [this]() { handleWifiCandidate(); });
  server_.on(kWifiCommitPath, HTTP_POST, [this]() { handleWifiCommit(); });
  server_.on(kWifiRollbackPath, HTTP_POST, [this]() { handleWifiRollback(); });
  server_.on(kSetupCodeCandidatePath, HTTP_POST, [this]() { handleStageSetupCode(); });
  server_.on(kSetupCodeVerifyPath, HTTP_POST, [this]() { handleVerifySetupCode(); });
  server_.on(kSetupCodeCommitPath, HTTP_POST, [this]() { handleCommitSetupCode(); });
  server_.on(kSetupCodeRollbackPath, HTTP_POST, [this]() { handleRollbackSetupCode(); });
  server_.on(kSetupModeStartPath, HTTP_POST, [this]() { handleSetupModeStart(); });
  server_.on(kSetupModeStatusPath, HTTP_GET, [this]() { handleSetupModeStatus(); });
  server_.on(kSetupModeStopPath, HTTP_POST, [this]() { handleSetupModeStop(); });
  server_.on("/", HTTP_GET, [this]() { handlePortalPage(); });
  server_.on("/generate_204", HTTP_GET, [this]() { handlePortalPage(); });
  server_.on("/hotspot-detect.html", HTTP_GET, [this]() { handlePortalPage(); });
  server_.on("/ncsi.txt", HTTP_GET, [this]() { handlePortalPage(); });
  server_.on(kPortalAuthPath, HTTP_POST, [this]() { handlePortalAuthenticate(); });
  server_.on(kPortalNetworksPath, HTTP_GET, [this]() { handlePortalNetworks(); });
  server_.on(kPortalStatusPath, HTTP_GET, [this]() { handlePortalStatus(); });
  server_.on(kPortalTransitionPath, HTTP_POST, [this]() { handlePortalTransition(); });
  server_.on(kPortalCandidatePath, HTTP_POST, [this]() { handlePortalCandidate(); });
  server_.on(kPortalCommitPath, HTTP_POST, [this]() { handlePortalCommit(); });
  server_.on(kPortalRollbackPath, HTTP_POST, [this]() { handlePortalRollback(); });
  server_.on(kRelaysPath, HTTP_GET, [this]() { handleRelays(); });
  server_.on(kAllOffPath, HTTP_POST, [this]() { handleAllOff(); });
  server_.on(kRelayConfigPath, HTTP_GET, [this]() { handleGetRelayConfig(); });
  server_.on(kRelayConfigPath, HTTP_POST, [this]() { handleSetRelayConfig(); });
  server_.onNotFound([this]() { handleNotFound(); });
}

void ApiServer::handleHealth() {
  JsonDocument document;
  const auto& config = config_.getConfig();
  document["success"] = true;
  document["status"] = health_.status();
  document["deviceId"] = config.deviceId;
  if (!config.previousDeviceId.isEmpty()) document["previousDeviceId"] = config.previousDeviceId;
  document["identityMigrationVersion"] = config.previousDeviceId.isEmpty() ? 0 : 1;
  document["deviceName"] = config.deviceName;
  document["firmwareVersion"] = config.firmwareVersion;
  document["hardwareStandard"] = config.hardwareStandard;
  document["uptimeSeconds"] = health_.uptimeSeconds();
  document["wifiConnected"] = health_.wifiConnected();
  document["rssi"] = health_.rssi();
  document["relayCount"] = relays_.getRelayCount();
  document["activeRelayCount"] = relays_.getRelayCount();
  document["freeHeapBytes"] = health_.freeHeapBytes();
  sendSuccess(200, document);
}

void ApiServer::handleDevice() {
  JsonDocument document;
  const auto& config = config_.getConfig();
  document["success"] = true;
  document["deviceId"] = config.deviceId;
  if (!config.previousDeviceId.isEmpty()) document["previousDeviceId"] = config.previousDeviceId;
  document["identityMigrationVersion"] = config.previousDeviceId.isEmpty() ? 0 : 1;
  document["deviceName"] = config.deviceName;
  document["firmwareVersion"] = config.firmwareVersion;
  document["hardwareStandard"] = config.hardwareStandard;
  document["apiVersion"] = defaults::kApiVersion;
  document["relayCount"] = relays_.getRelayCount();
  JsonArray supported = document["supportedRelayCounts"].to<JsonArray>();
  for (const auto count : kSupportedRelayCounts) supported.add(count);
  document["boardModel"] = defaults::kBoardModel;
  sendSuccess(200, document);
}

void ApiServer::handleVerifyDevice() {
  if (!requireAuthentication()) return;
  JsonDocument request;
  const auto parseError = deserializeJson(request, server_.arg("plain"));
  if (parseError || !request["nonce"].is<const char*>()) {
    sendError(400, "MALFORMED_JSON", "A JSON body containing nonce is required.");
    return;
  }
  const String nonce = request["nonce"].as<String>();
  if (!validNonce(nonce)) {
    sendError(400, "INVALID_NONCE", "nonce must contain 32 to 64 hexadecimal characters.");
    return;
  }
  const auto& config = config_.getConfig();
  const std::uint8_t migrationVersion = config.previousDeviceId.isEmpty() ? 0 : 1;
  JsonDocument document;
  document["success"] = true;
  document["verified"] = true;
  document["deviceId"] = config.deviceId;
  if (!config.previousDeviceId.isEmpty()) document["previousDeviceId"] = config.previousDeviceId;
  document["identityMigrationVersion"] = migrationVersion;
  document["nonce"] = nonce;
  document["proof"] = verificationProof(auth_.authorizedKey(), nonce, config.deviceId, migrationVersion);
  document["deviceName"] = config.deviceName;
  document["firmwareVersion"] = config.firmwareVersion;
  document["apiVersion"] = defaults::kApiVersion;
  document["hardwareStandard"] = config.hardwareStandard;
  document["relayCount"] = relays_.getRelayCount();
  sendSuccess(200, document);
}

void ApiServer::handleStageDeviceKey() {
  if (!requireAuthentication()) return;
  if (auth_.authorizedKey() != config_.getConfig().apiKey) {
    sendError(409, "CURRENT_DEVICE_KEY_REQUIRED", "The committed Device Key is required.");
    return;
  }
  JsonDocument request;
  if (deserializeJson(request, server_.arg("plain")) ||
      !request["newKey"].is<const char*>() || !request["transitionId"].is<const char*>()) {
    sendError(400, "MALFORMED_JSON", "newKey and transitionId are required.");
    return;
  }
  const String newKey = request["newKey"].as<String>(), transitionId = request["transitionId"].as<String>();
  if (!config_.stageDeviceKey(newKey, transitionId)) {
    sendError(400, "DEVICE_KEY_CANDIDATE_REJECTED", "Device Key candidate is invalid or could not be persisted.");
    return;
  }
  JsonDocument response; response["success"] = true; response["transitionId"] = transitionId; response["state"] = "PENDING";
  sendSuccess(200, response);
}

void ApiServer::handleCommitDeviceKey() {
  if (!requireAuthentication()) return;
  if (auth_.authorizedKey() != config_.candidateDeviceKey()) {
    sendError(409, "CANDIDATE_DEVICE_KEY_REQUIRED", "The candidate Device Key is required.");
    return;
  }
  JsonDocument request;
  if (deserializeJson(request, server_.arg("plain")) || !request["transitionId"].is<const char*>()) {
    sendError(400, "MALFORMED_JSON", "transitionId is required."); return;
  }
  const String transitionId = request["transitionId"].as<String>();
  if (!config_.commitDeviceKey(transitionId)) {
    sendError(409, "DEVICE_KEY_COMMIT_FAILED", "Device Key transition does not match."); return;
  }
  JsonDocument response; response["success"] = true; response["transitionId"] = transitionId; response["state"] = "COMMITTED";
  sendSuccess(200, response);
}

void ApiServer::handleRollbackDeviceKey() {
  if (!requireAuthentication()) return;
  JsonDocument request;
  if (deserializeJson(request, server_.arg("plain")) || !request["transitionId"].is<const char*>()) {
    sendError(400, "MALFORMED_JSON", "transitionId is required."); return;
  }
  const String transitionId = request["transitionId"].as<String>();
  if (!config_.rollbackDeviceKey(transitionId)) {
    sendError(409, "DEVICE_KEY_ROLLBACK_FAILED", "Device Key transition does not match."); return;
  }
  JsonDocument response; response["success"] = true; response["transitionId"] = transitionId; response["state"] = "ROLLED_BACK";
  sendSuccess(200, response);
}

void ApiServer::handleWifiNetworks() {
  if (!requireAuthentication()) return;
  if (!config_.hasUniqueDeviceKey()) { sendError(409, "UNIQUE_DEVICE_KEY_REQUIRED", "Create a unique Device Key before Wi-Fi provisioning."); return; }
  wifiProvisioning_.startScan();
  JsonDocument response; response["success"] = true; response["scanning"] = wifiProvisioning_.scanRunning();
  JsonArray networks = response["networks"].to<JsonArray>();
  for (std::uint8_t index = 0; index < wifiProvisioning_.networkCount(); ++index) {
    const auto& item = wifiProvisioning_.network(index);
    JsonObject network = networks.add<JsonObject>();
    network["ssid"] = item.ssid; network["rssi"] = item.rssi; network["secured"] = item.secured; network["hidden"] = item.hidden;
  }
  sendSuccess(200, response);
}

void ApiServer::handleWifiStatus() {
  if (!requireAuthentication()) return;
  JsonDocument response; response["success"] = true; response["state"] = wifiProvisioning_.state();
  response["transitionId"] = wifiProvisioning_.transitionId();
  if (!wifiProvisioning_.errorCode().isEmpty()) response["errorCode"] = wifiProvisioning_.errorCode();
  response["connected"] = WiFi.status() == WL_CONNECTED;
  if (WiFi.status() == WL_CONNECTED) response["ip"] = WiFi.localIP().toString();
  sendSuccess(200, response);
}

void ApiServer::handleWifiCandidate() {
  if (!requireAuthentication()) return;
  if (!config_.hasUniqueDeviceKey()) { sendError(409, "UNIQUE_DEVICE_KEY_REQUIRED", "Create a unique Device Key before Wi-Fi provisioning."); return; }
  if (!wifiProvisioning_.relaySafe()) { sendError(409, "RELAY_SAFE_STATE_CONFLICT", "All Relay channels must be OFF."); return; }
  JsonDocument request;
  if (deserializeJson(request, server_.arg("plain")) || !request["ssid"].is<const char*>() ||
      !request["password"].is<const char*>() || !request["transitionId"].is<const char*>()) {
    sendError(400, "MALFORMED_JSON", "ssid, password, and transitionId are required."); return;
  }
  if (!wifiProvisioning_.stage(request["ssid"].as<String>(), request["password"].as<String>(), request["transitionId"].as<String>())) {
    sendError(409, "WIFI_CANDIDATE_REJECTED", "Wi-Fi candidate could not be staged."); return;
  }
  JsonDocument response; response["success"] = true; response["state"] = wifiProvisioning_.state(); response["transitionId"] = wifiProvisioning_.transitionId();
  sendSuccess(202, response);
}

void ApiServer::handleWifiCommit() {
  if (!requireAuthentication()) return;
  JsonDocument request;
  if (deserializeJson(request, server_.arg("plain")) || !request["transitionId"].is<const char*>()) { sendError(400, "MALFORMED_JSON", "transitionId is required."); return; }
  if (!wifiProvisioning_.commit(request["transitionId"].as<String>())) { sendError(409, "WIFI_COMMIT_REJECTED", "Transition is not ready or Relay state is unsafe."); return; }
  JsonDocument response; response["success"] = true; response["state"] = wifiProvisioning_.state(); sendSuccess(200, response);
}

void ApiServer::handleWifiRollback() {
  if (!requireAuthentication()) return;
  JsonDocument request;
  if (deserializeJson(request, server_.arg("plain")) || !request["transitionId"].is<const char*>()) { sendError(400, "MALFORMED_JSON", "transitionId is required."); return; }
  if (!wifiProvisioning_.rollback(request["transitionId"].as<String>(), "BACKEND_REQUESTED_ROLLBACK")) { sendError(409, "WIFI_ROLLBACK_REJECTED", "Transition does not match."); return; }
  JsonDocument response; response["success"] = true; response["state"] = wifiProvisioning_.state(); sendSuccess(200, response);
}

void ApiServer::handleStageSetupCode() {
  if (!requireAuthentication()) return;
  if (!config_.hasUniqueDeviceKey()) { sendError(409, "UNIQUE_DEVICE_KEY_REQUIRED", "Create a unique Device Key first."); return; }
  if (!wifiProvisioning_.relaySafe()) { sendError(409, "RELAY_SAFE_STATE_CONFLICT", "All Relay channels must be OFF."); return; }
  if (server_.arg("plain").length() > 256) { sendError(413, "REQUEST_TOO_LARGE", "Request body is too large."); return; }
  JsonDocument request;
  if (deserializeJson(request, server_.arg("plain")) || !request["setupCode"].is<const char*>() || !request["transitionId"].is<const char*>()) {
    sendError(400, "MALFORMED_JSON", "setupCode and transitionId are required."); return;
  }
  if (!config_.stageSetupCode(request["setupCode"].as<String>(), request["transitionId"].as<String>())) {
    sendError(400, "SETUP_CODE_CANDIDATE_REJECTED", "Setup Code candidate is invalid."); return;
  }
  JsonDocument response; response["success"] = true; response["state"] = "PENDING"; response["transitionId"] = config_.setupCodeTransitionId();
  logger_.info("SETUP_CODE_ENROLLMENT_STARTED", "Setup Code candidate stored"); sendSuccess(202, response);
}

void ApiServer::handleVerifySetupCode() {
  if (!requireAuthentication()) return;
  JsonDocument request;
  if (deserializeJson(request, server_.arg("plain")) || !request["nonce"].is<const char*>() || !request["transitionId"].is<const char*>()) {
    sendError(400, "MALFORMED_JSON", "nonce and transitionId are required."); return;
  }
  const String nonce = request["nonce"].as<String>(), transitionId = request["transitionId"].as<String>();
  if (!validNonce(nonce) || transitionId != config_.setupCodeTransitionId() || config_.setupCodeCandidate().isEmpty()) {
    sendError(409, "SETUP_CODE_VERIFICATION_REJECTED", "Setup Code transition is invalid."); return;
  }
  JsonDocument response; response["success"] = true; response["nonce"] = nonce; response["transitionId"] = transitionId;
  response["deviceId"] = config_.getConfig().deviceId;
  response["proof"] = verificationProof(config_.setupCodeCandidate(), nonce, config_.getConfig().deviceId, 0);
  sendSuccess(200, response);
}

void ApiServer::handleCommitSetupCode() {
  if (!requireAuthentication()) return;
  JsonDocument request;
  if (deserializeJson(request, server_.arg("plain")) || !request["transitionId"].is<const char*>()) { sendError(400, "MALFORMED_JSON", "transitionId is required."); return; }
  if (!wifiProvisioning_.relaySafe()) { sendError(409, "RELAY_SAFE_STATE_CONFLICT", "All Relay channels must be OFF."); return; }
  if (!config_.commitSetupCode(request["transitionId"].as<String>())) { sendError(409, "SETUP_CODE_COMMIT_REJECTED", "Setup Code transition does not match."); return; }
  if (setupMode_.active()) setupMode_.stop("SETUP_CODE_ROTATED");
  JsonDocument response; response["success"] = true; response["state"] = "COMMITTED"; response["setupCodeVersion"] = config_.setupCodeVersion();
  logger_.info("SETUP_CODE_ENROLLMENT_COMMITTED", "Setup Code committed"); sendSuccess(200, response);
}

void ApiServer::handleRollbackSetupCode() {
  if (!requireAuthentication()) return;
  JsonDocument request;
  if (deserializeJson(request, server_.arg("plain")) || !request["transitionId"].is<const char*>()) { sendError(400, "MALFORMED_JSON", "transitionId is required."); return; }
  if (!config_.rollbackSetupCode(request["transitionId"].as<String>())) { sendError(409, "SETUP_CODE_ROLLBACK_REJECTED", "Setup Code transition does not match."); return; }
  JsonDocument response; response["success"] = true; response["state"] = "ROLLED_BACK"; sendSuccess(200, response);
}

void ApiServer::handleSetupModeStart() {
  if (!requireAuthentication()) return;
  if (!config_.hasUniqueDeviceKey()) { sendError(409, "UNIQUE_DEVICE_KEY_REQUIRED", "A unique Device Key is required."); return; }
  if (!config_.hasSetupCode()) { sendError(409, "SETUP_CODE_REQUIRED", "Enroll a Setup Code first."); return; }
  if (!wifiProvisioning_.relaySafe()) { logger_.warning("SETUP_MODE_REJECTED_RELAY_ACTIVE", "Setup Mode rejected while Relay active"); sendError(409, "RELAY_SAFE_STATE_CONFLICT", "All Relay channels must be OFF."); return; }
  JsonDocument request;
  if (deserializeJson(request, server_.arg("plain")) || request["confirmed"].as<bool>() != true) { sendError(400, "EXPLICIT_CONFIRMATION_REQUIRED", "confirmed must be true."); return; }
  if (setupMode_.active() || !config_.wifiTransitionId().isEmpty()) { sendError(409, "SETUP_MODE_BUSY", "A setup or Wi-Fi transition is already active."); return; }
  JsonDocument response; response["success"] = true; response["state"] = "STARTING_AP"; response["ssid"] = setupMode_.apSsid();
  sendSuccess(202, response); setupMode_.start("AUTHENTICATED_API");
}

void ApiServer::handleSetupModeStatus() {
  if (!requireAuthentication()) return;
  JsonDocument response; response["success"] = true; response["active"] = setupMode_.active(); response["state"] = setupMode_.state();
  response["setupCodeEnrolled"] = config_.hasSetupCode(); response["setupCodeMasked"] = config_.hasSetupCode() ? "****-****-****" : "";
  if (setupMode_.active()) { response["ssid"] = setupMode_.apSsid(); response["remainingSeconds"] = setupMode_.remainingMs() / 1000; }
  sendSuccess(200, response);
}

void ApiServer::handleSetupModeStop() {
  if (!requireAuthentication()) return;
  if (!config_.wifiTransitionId().isEmpty()) wifiProvisioning_.rollback(config_.wifiTransitionId(), "SETUP_MODE_STOPPED");
  setupMode_.stop("AUTHENTICATED_API"); JsonDocument response; response["success"] = true; response["state"] = "NORMAL"; sendSuccess(200, response);
}

bool ApiServer::portalRequestAllowed() {
  if (!setupMode_.active()) return false;
  const String host = server_.header("Host"), origin = server_.header("Origin");
  const bool hostOk = host.isEmpty() || host.startsWith("192.168.4.1");
  const bool originOk = origin.isEmpty() || origin == "http://192.168.4.1";
  return hostOk && originOk;
}

bool ApiServer::requirePortalSession(String& token) {
  if (!portalRequestAllowed()) { sendError(403, "PORTAL_REQUEST_REJECTED", "Portal request is not allowed."); return false; }
  token = server_.header(kPortalSessionHeader);
  if (!setupMode_.validSession(token)) { sendError(401, "PORTAL_SESSION_INVALID", "Portal session is invalid or expired."); return false; }
  return true;
}

void ApiServer::handlePortalPage() {
  if (!setupMode_.active()) { sendError(404, "SETUP_MODE_INACTIVE", "Setup Mode is not active."); return; }
  const String host = server_.header("Host");
  if (!host.isEmpty() && !host.startsWith("192.168.4.1")) {
    server_.sendHeader("Location", "http://192.168.4.1/");
    server_.send(302, "text/plain", "");
    return;
  }
  server_.sendHeader("Cache-Control", "no-store, max-age=0");
  server_.send(200, "text/html; charset=utf-8", R"HTML(<!doctype html><html lang="th"><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>ตั้งค่า Lucky Relay</title><style>body{font:16px system-ui;background:#f4f7f5;margin:0;color:#17352b}.box{max-width:520px;margin:5vh auto;background:white;padding:24px;border-radius:16px;box-shadow:0 8px 30px #0002}input,select,button{box-sizing:border-box;width:100%;padding:12px;margin:7px 0;border:1px solid #aaa;border-radius:8px}button{background:#176b52;color:white;font-weight:700}.warn{background:#fff3cd;padding:12px;border-radius:8px}small{display:block;color:#566}</style><div class="box"><h2>ตั้งค่า Wi‑Fi กล่องควบคุม</h2><p class="warn">Relay ทุกช่องต้องปิด ระบบจะไม่สั่งปิดให้อัตโนมัติ</p><div id="login"><input id="code" autocomplete="off" placeholder="Setup Code: XXXX-XXXX-XXXX"><button onclick="login()">เข้าสู่ระบบ</button></div><div id="setup" hidden><button onclick="scan()">ค้นหา Wi‑Fi</button><select id="net"></select><input id="ssid" maxlength="32" placeholder="หรือกรอกชื่อ Wi‑Fi / Hidden SSID"><input id="pass" type="password" maxlength="63" placeholder="รหัสผ่าน Wi‑Fi"><button onclick="save()">ทดลองเชื่อมต่อ</button></div><p id="msg"></p></div><script>let token='',transition='';const msg=t=>document.getElementById('msg').textContent=t;function friendly(e){const t=e&&e.message||'';if(/randomUUID|crypto|getRandomValues|not a function/i.test(t))return 'Browser นี้ไม่รองรับการสร้างรหัสแบบปลอดภัย กรุณาเปิดด้วย Safari, Chrome หรือ Edge รุ่นล่าสุด';return t&&/[ก-๙]/.test(t)?t:'ดำเนินการไม่สำเร็จ กรุณาลองใหม่'}function secureTransitionNonce(){if(!globalThis.crypto||typeof globalThis.crypto.getRandomValues!=='function')throw Error('Browser นี้ไม่รองรับการสร้างรหัสแบบปลอดภัย กรุณาเปิดด้วย Safari, Chrome หรือ Edge รุ่นล่าสุด');const b=new Uint8Array(16);globalThis.crypto.getRandomValues(b);return Array.from(b,x=>x.toString(16).padStart(2,'0')).join('')}async function call(url,opt={}){opt.headers={'Content-Type':'application/json','X-Lucky-Setup-Session':token,...opt.headers};const r=await fetch(url,opt),d=await r.json();if(!r.ok)throw Error(d.error?.message||d.error||'ดำเนินการไม่สำเร็จ');return d}async function login(){try{const d=await call('/setup/api/auth',{method:'POST',body:JSON.stringify({setupCode:code.value})});token=d.sessionToken;code.value='';login.hidden=true;setup.hidden=false;scan()}catch(e){msg(friendly(e))}}async function scan(){try{const d=await call('/setup/api/networks');net.innerHTML=(d.networks||[]).map(x=>`<option value="${x.ssid.replace(/[&<>\"]/g,'')}">${x.ssid||'(เครือข่ายซ่อน)'} (${x.rssi} dBm)</option>`).join('');if(d.scanning)setTimeout(scan,700)}catch(e){msg(friendly(e))}}async function save(){try{const name=(ssid.value||net.value||'').trim();const nonce=secureTransitionNonce();const issued=await call('/setup/api/transition',{method:'POST',body:JSON.stringify({clientNonce:nonce})});transition=issued.transitionId;if(typeof transition!=='string'||transition.length<16)throw Error('ไม่สามารถสร้างรหัสการเปลี่ยนเครือข่ายได้อย่างปลอดภัย');await call('/setup/api/candidate',{method:'POST',body:JSON.stringify({ssid:name,password:pass.value,transitionId:transition})});pass.value='';msg('กำลังเชื่อมต่อ กรุณารอสักครู่');poll()}catch(e){msg(friendly(e))}}async function poll(){try{const d=await call('/setup/api/status');msg('สถานะ: '+d.provisioningState);if(d.provisioningState==='WAITING_FOR_COMMIT'){await call('/setup/api/commit',{method:'POST',body:JSON.stringify({transitionId:transition})});msg('สำเร็จ กรุณากลับไปเชื่อมต่อ Wi‑Fi ปกติ');return}if(d.provisioningState==='ORIGINAL_NETWORK_RESTORED'){msg('เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่');return}setTimeout(poll,1000)}catch(e){msg(friendly(e))}}</script></html>)HTML");
}

void ApiServer::handlePortalAuthenticate() {
  if (!portalRequestAllowed()) { sendError(403, "PORTAL_REQUEST_REJECTED", "Portal request is not allowed."); return; }
  if (server_.arg("plain").length() > 128) { sendError(413, "REQUEST_TOO_LARGE", "Request body is too large."); return; }
  JsonDocument request;
  if (deserializeJson(request, server_.arg("plain")) || !request["setupCode"].is<const char*>()) { sendError(400, "MALFORMED_JSON", "setupCode is required."); return; }
  String token, errorCode;
  if (!setupMode_.authenticate(request["setupCode"].as<String>(), token, errorCode)) { sendError(errorCode == "PORTAL_LOCKED_OUT" ? 429 : 401, errorCode.c_str(), "Setup Code authentication failed."); return; }
  JsonDocument response; response["success"] = true; response["sessionToken"] = token; response["expiresInSeconds"] = 600; sendSuccess(200, response);
}

void ApiServer::handlePortalNetworks() {
  String token; if (!requirePortalSession(token)) return; wifiProvisioning_.startScan();
  JsonDocument response; response["success"] = true; response["scanning"] = wifiProvisioning_.scanRunning(); JsonArray networks = response["networks"].to<JsonArray>();
  for (std::uint8_t index = 0; index < wifiProvisioning_.networkCount(); ++index) { const auto& item = wifiProvisioning_.network(index); JsonObject network = networks.add<JsonObject>(); network["ssid"] = item.ssid; network["rssi"] = item.rssi; network["secured"] = item.secured; network["hidden"] = item.hidden; }
  sendSuccess(200, response);
}

void ApiServer::handlePortalStatus() {
  String token; if (!requirePortalSession(token)) return; JsonDocument response; response["success"] = true; response["state"] = setupMode_.state(); response["provisioningState"] = wifiProvisioning_.state();
  if (!wifiProvisioning_.errorCode().isEmpty()) response["errorCode"] = wifiProvisioning_.errorCode(); sendSuccess(200, response);
}

void ApiServer::handlePortalTransition() {
  String token; if (!requirePortalSession(token)) return;
  if (server_.arg("plain").length() > 192) { sendError(413, "REQUEST_TOO_LARGE", "Request body is too large."); return; }
  JsonDocument request;
  if (deserializeJson(request, server_.arg("plain")) || !request["clientNonce"].is<const char*>()) {
    sendError(400, "MALFORMED_JSON", "clientNonce is required."); return;
  }
  String transitionId, errorCode;
  if (!setupMode_.issueTransition(request["clientNonce"].as<String>(), transitionId, errorCode)) {
    sendError(409, errorCode.c_str(), "Secure transition could not be created."); return;
  }
  JsonDocument response; response["success"] = true; response["transitionId"] = transitionId; sendSuccess(201, response);
}

void ApiServer::handlePortalCandidate() {
  String token; if (!requirePortalSession(token)) return;
  if (server_.arg("plain").length() > 512) { sendError(413, "REQUEST_TOO_LARGE", "Request body is too large."); return; }
  JsonDocument request;
  if (deserializeJson(request, server_.arg("plain")) || !request["ssid"].is<const char*>() || !request["password"].is<const char*>() || !request["transitionId"].is<const char*>()) { sendError(400, "MALFORMED_JSON", "ssid, password and transitionId are required."); return; }
  String errorCode;
  if (!setupMode_.submitCandidate(token, request["ssid"].as<String>(), request["password"].as<String>(), request["transitionId"].as<String>(), errorCode)) { sendError(409, errorCode.c_str(), "Wi-Fi candidate was rejected."); return; }
  JsonDocument response; response["success"] = true; response["state"] = "CONNECTING_CANDIDATE"; sendSuccess(202, response);
}

void ApiServer::handlePortalCommit() {
  String token; if (!requirePortalSession(token)) return; JsonDocument request;
  if (deserializeJson(request, server_.arg("plain")) || !request["transitionId"].is<const char*>()) { sendError(400, "MALFORMED_JSON", "transitionId is required."); return; }
  String errorCode; if (!setupMode_.commitCandidate(token, request["transitionId"].as<String>(), errorCode)) { sendError(409, errorCode.c_str(), "Wi-Fi commit was rejected."); return; }
  JsonDocument response; response["success"] = true; response["state"] = "COMMITTED"; sendSuccess(200, response); setupMode_.stop("PROVISIONING_COMMITTED");
}

void ApiServer::handlePortalRollback() {
  String token; if (!requirePortalSession(token)) return; JsonDocument request;
  if (deserializeJson(request, server_.arg("plain")) || !request["transitionId"].is<const char*>()) { sendError(400, "MALFORMED_JSON", "transitionId is required."); return; }
  if (!setupMode_.rollbackCandidate(token, request["transitionId"].as<String>())) { sendError(409, "WIFI_ROLLBACK_REJECTED", "Rollback was rejected."); return; }
  JsonDocument response; response["success"] = true; response["state"] = "AP_ACTIVE"; sendSuccess(200, response);
}

void ApiServer::handleRelays() {
  JsonDocument document;
  document["success"] = true;
  document["relayCount"] = relays_.getRelayCount();
  JsonArray relays = document["relays"].to<JsonArray>();
  const auto snapshots = relays_.getAllStates();
  for (std::uint8_t index = 0; index < relays_.getRelayCount(); ++index) {
    JsonObject relay = relays.add<JsonObject>();
    relay["channel"] = snapshots[index].channel;
    relay["state"] = snapshots[index].state == RelayState::On ? "ON" : "OFF";
    relay["gpio"] = snapshots[index].gpio;
  }
  sendSuccess(200, document);
}

void ApiServer::handleAllOff() {
  if (!requireAuthentication()) return;
  relays_.turnAllOff();
  JsonDocument document;
  document["success"] = true;
  document["relayCount"] = relays_.getRelayCount();
  document["state"] = "OFF";
  sendSuccess(200, document);
}

void ApiServer::appendRelayConfiguration(ArduinoJson::JsonDocument& document) const {
  document["relayCount"] = relays_.getRelayCount();
  JsonArray supported = document["supportedRelayCounts"].to<JsonArray>();
  for (const auto count : kSupportedRelayCounts) supported.add(count);
  JsonArray active = document["activeChannels"].to<JsonArray>();
  for (std::uint8_t channel = 1; channel <= relays_.getRelayCount(); ++channel) active.add(channel);
}

void ApiServer::handleGetRelayConfig() {
  JsonDocument document;
  document["success"] = true;
  appendRelayConfiguration(document);
  sendSuccess(200, document);
}

void ApiServer::handleSetRelayConfig() {
  if (!requireAuthentication()) return;
  JsonDocument request;
  const auto parseError = deserializeJson(request, server_.arg("plain"));
  if (parseError || !request["relayCount"].is<std::uint8_t>()) {
    sendError(400, "MALFORMED_JSON", "A JSON body containing integer relayCount is required.");
    return;
  }
  const auto count = request["relayCount"].as<std::uint8_t>();
  if (!ConfigService::isSupportedRelayCount(count)) {
    sendError(400, "UNSUPPORTED_RELAY_COUNT", "relayCount must be 2, 4, or 8.");
    return;
  }
  relays_.turnAllOff();
  if (!config_.setRelayCount(count)) {
    sendError(500, "CONFIG_PERSISTENCE_FAILED", "relayCount could not be persisted to NVS.");
    return;
  }
  relays_.initialize(config_.getRelayBoardSize());
  JsonDocument document;
  document["success"] = true;
  document["restartRequired"] = false;
  appendRelayConfiguration(document);
  sendSuccess(200, document);
}

void ApiServer::handleRelayState(const long channel) {
  if (!requireAuthentication()) return;
  if (channel < 1 || channel > relays_.getRelayCount() || channel > static_cast<long>(kMaximumRelayCount)) {
    sendError(404, "RELAY_CHANNEL_NOT_AVAILABLE",
              "Relay channel " + String(channel) + " is not available for the configured " +
                  String(relays_.getRelayCount()) + "-channel controller.");
    return;
  }
  JsonDocument request;
  const auto parseError = deserializeJson(request, server_.arg("plain"));
  if (parseError || !request["state"].is<const char*>()) {
    sendError(400, "MALFORMED_JSON", "A JSON body containing state is required.");
    return;
  }
  const String state = request["state"].as<String>();
  bool changed = false;
  const auto relayChannel = static_cast<std::uint8_t>(channel);
  if (state == "ON") changed = relays_.turnOn(relayChannel);
  else if (state == "OFF") changed = relays_.turnOff(relayChannel);
  else {
    sendError(400, "INVALID_RELAY_STATE", "state must be ON or OFF.");
    return;
  }
  if (!changed) {
    sendError(500, "RELAY_CHANGE_FAILED", "Relay state could not be changed.");
    return;
  }
  JsonDocument document;
  document["success"] = true;
  document["channel"] = channel;
  document["state"] = state;
  document["gpio"] = relays_.getGpio(relayChannel);
  sendSuccess(200, document);
}

bool ApiServer::parseRelayStatePath(const String& path, long& channel) const {
  if (!path.startsWith(kRelayStatePrefix) || !path.endsWith(kRelayStateSuffix)) return false;
  const int start = strlen(kRelayStatePrefix);
  const int length = path.length() - start - strlen(kRelayStateSuffix);
  if (length <= 0) return false;
  const String token = path.substring(start, start + length);
  for (unsigned int index = 0; index < token.length(); ++index) if (!isDigit(token[index])) return false;
  const long parsed = strtol(token.c_str(), nullptr, 10);
  channel = parsed;
  return true;
}

void ApiServer::handleNotFound() {
  long channel = 0;
  if (server_.method() == HTTP_POST && parseRelayStatePath(server_.uri(), channel)) {
    handleRelayState(channel);
    return;
  }
  sendError(404, "ROUTE_NOT_FOUND", "The requested API route does not exist.");
}

bool ApiServer::requireAuthentication() {
  if (auth_.authorize(server_)) return true;
  sendError(401, "AUTHENTICATION_REQUIRED", "A valid X-Lucky-Device-Key header is required.");
  return false;
}

const char* ApiServer::requestMethodName() {
  switch (server_.method()) {
    case HTTP_GET: return "GET";
    case HTTP_POST: return "POST";
    default: return "OTHER";
  }
}

void ApiServer::sendSuccess(const int statusCode, ArduinoJson::JsonDocument& document) {
  server_.send(statusCode, kJsonContentType, serializeDocument(document));
  logger_.request(requestMethodName(), server_.uri(), statusCode);
}

void ApiServer::sendError(const int statusCode, const char* code, const String& message) {
  JsonDocument document;
  document["success"] = false;
  JsonObject error = document["error"].to<JsonObject>();
  error["code"] = code;
  error["message"] = message;
  server_.send(statusCode, kJsonContentType, serializeDocument(document));
  logger_.request(requestMethodName(), server_.uri(), statusCode);
}

}  // namespace lucky
