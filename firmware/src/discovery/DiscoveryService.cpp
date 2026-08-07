#include "discovery/DiscoveryService.h"

#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include "config/DeviceConfig.h"
#include "utils/ApiJson.h"

namespace lucky {
namespace {
constexpr const char* kProtocol = "lucky-relay-discovery";
constexpr std::uint8_t kProtocolVersion = 1;
}

DiscoveryService::DiscoveryService(const ConfigService& config, const WifiService& wifi,
                                   const RelayService& relays, ILogger& logger)
    : config_(config), wifi_(wifi), relays_(relays), logger_(logger) {}

String DiscoveryService::hostname() const {
  String compact;
  const String id = config_.getConfig().deviceId;
  for (unsigned int index = 0; index < id.length(); ++index) {
    const char value = id[index];
    if (isAlphaNumeric(value)) compact += static_cast<char>(tolower(value));
  }
  const String suffix = compact.length() > 4 ? compact.substring(compact.length() - 4) : compact;
  return "lucky-relay-" + suffix;
}

void DiscoveryService::start() {
  if (!MDNS.begin(hostname().c_str())) {
    logger_.warning("MDNS_START_FAILED", "mDNS responder could not start");
  } else {
    const auto& config = config_.getConfig();
    MDNS.addService("lucky-relay", "tcp", 80);
    MDNS.addServiceTxt("lucky-relay", "tcp", "protocolVersion", "1");
    MDNS.addServiceTxt("lucky-relay", "tcp", "deviceId", config.deviceId);
    if (!config.previousDeviceId.isEmpty()) MDNS.addServiceTxt("lucky-relay", "tcp", "previousDeviceId", config.previousDeviceId);
    MDNS.addServiceTxt("lucky-relay", "tcp", "identityMigrationVersion", config.previousDeviceId.isEmpty() ? "0" : "1");
    MDNS.addServiceTxt("lucky-relay", "tcp", "deviceName", config.deviceName);
    MDNS.addServiceTxt("lucky-relay", "tcp", "firmwareVersion", config.firmwareVersion);
    MDNS.addServiceTxt("lucky-relay", "tcp", "apiVersion", defaults::kApiVersion);
    MDNS.addServiceTxt("lucky-relay", "tcp", "hardwareStandard", config.hardwareStandard);
    MDNS.addServiceTxt("lucky-relay", "tcp", "relayCount", String(relays_.getRelayCount()));
    logger_.info("MDNS_STARTED", "Lucky Relay mDNS service announced");
  }
  if (!udp_.begin(kDiscoveryPort)) {
    logger_.warning("UDP_DISCOVERY_START_FAILED", "UDP discovery socket could not start");
  } else {
    logger_.info("UDP_DISCOVERY_STARTED", "UDP discovery listening");
  }
  active_ = true;
}

void DiscoveryService::stop() {
  udp_.stop();
  MDNS.end();
  active_ = false;
  logger_.info("DISCOVERY_STOPPED", "Network discovery stopped");
}

void DiscoveryService::loop() {
  if (wifi_.isConnected() && !active_) start();
  if (!wifi_.isConnected() && active_) stop();
  if (active_) handlePacket();
}

void DiscoveryService::handlePacket() {
  const int packetSize = udp_.parsePacket();
  if (packetSize <= 0) return;
  if (packetSize > static_cast<int>(kMaximumPacketSize)) {
    while (udp_.available()) udp_.read();
    logger_.warning("UDP_DISCOVERY_PACKET_REJECTED", "Oversized discovery packet rejected");
    return;
  }

  char buffer[kMaximumPacketSize + 1]{};
  const int length = udp_.read(buffer, kMaximumPacketSize);
  if (length <= 0) return;
  buffer[length] = '\0';

  JsonDocument request;
  const auto error = deserializeJson(request, buffer, static_cast<std::size_t>(length));
  if (error || request["protocol"] != kProtocol ||
      request["protocolVersion"].as<int>() != kProtocolVersion ||
      request["type"] != "discover") {
    logger_.warning("UDP_DISCOVERY_PACKET_REJECTED", "Malformed discovery packet rejected");
    return;
  }
  if (lastResponseMs_ && millis() - lastResponseMs_ < kMinimumResponseIntervalMs) return;

  const auto& config = config_.getConfig();
  JsonDocument response;
  response["protocol"] = kProtocol;
  response["protocolVersion"] = kProtocolVersion;
  response["type"] = "announce";
  response["deviceId"] = config.deviceId;
  if (!config.previousDeviceId.isEmpty()) response["previousDeviceId"] = config.previousDeviceId;
  response["identityMigrationVersion"] = config.previousDeviceId.isEmpty() ? 0 : 1;
  response["deviceName"] = config.deviceName;
  response["ip"] = wifi_.localIp();
  response["apiPort"] = 80;
  response["firmwareVersion"] = config.firmwareVersion;
  response["apiVersion"] = defaults::kApiVersion;
  response["hardwareStandard"] = config.hardwareStandard;
  response["relayCount"] = relays_.getRelayCount();
  const String payload = serializeDocument(response);

  udp_.beginPacket(udp_.remoteIP(), udp_.remotePort());
  udp_.write(reinterpret_cast<const std::uint8_t*>(payload.c_str()), payload.length());
  udp_.endPacket();
  lastResponseMs_ = millis();
  logger_.info("UDP_DISCOVERY_RESPONSE_SENT", "Discovery response sent");
}

}  // namespace lucky
