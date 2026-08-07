#include <Arduino.h>
#include <esp_system.h>

#include "api/ApiServer.h"
#include "auth/AuthService.h"
#include "config/ConfigService.h"
#include "discovery/DiscoveryService.h"
#include "health/HealthService.h"
#include "logging/Logger.h"
#include "relay/ArduinoGpioDriver.h"
#include "relay/RelayService.h"
#include "setup/SetupModeService.h"
#include "serial/SerialRecoveryService.h"
#include "storage/StorageService.h"
#include "watchdog/WatchdogService.h"
#include "wifi/WifiService.h"
#include "wifi/WifiProvisioningService.h"

namespace {

lucky::Logger logger(Serial);
lucky::StorageService storage;
lucky::ConfigService config(storage, logger);
lucky::ArduinoGpioDriver gpio;
lucky::RelayService relays(gpio, logger);
lucky::WifiService wifi(config, logger);
lucky::AuthService auth(config, logger);
lucky::HealthService health(config, wifi);
lucky::WifiProvisioningService wifiProvisioning(config, relays, logger);
lucky::SetupModeService setupMode(config, relays, wifiProvisioning, logger);
lucky::DiscoveryService discovery(config, wifi, relays, logger);
lucky::ApiServer api(config, relays, auth, health, wifiProvisioning, setupMode, logger);
lucky::SerialRecoveryService serialRecovery(Serial, config, relays, wifiProvisioning, setupMode, logger);
lucky::WatchdogService watchdog(logger);

}  // namespace

void setup() {
  Serial.begin(115200);

  // Safe boot invariant: every known relay output is HIGH before NVS or Wi-Fi.
  relays.safeInitializeAllPins();
  logger.info("BOOT", "Lucky Relay Controller boot started");
  logger.info("FIRMWARE_VERSION", lucky::defaults::kFirmwareVersion);
  if (esp_reset_reason() != ESP_RST_POWERON) logger.warning("RESTART_DETECTED", "Controller restarted");

  config.initialize();
  relays.initialize(config.getRelayBoardSize());
  relays.turnAllOff();

  char relayMessage[32];
  snprintf(relayMessage, sizeof(relayMessage), "Configured relay count: %u", config.getRelayCount());
  logger.info("RELAY_CONFIGURATION", relayMessage);

  wifi.initialize();
  setupMode.initialize();
  if (config.hasUniqueDeviceKey() && config.hasSetupCode() && config.getConfig().wifiSSID.isEmpty()) {
    if (!setupMode.start("FIRST_ENROLLMENT")) logger.error("FIRST_ENROLLMENT_BLOCKED", "Setup AP could not enter controlled enrollment state");
  } else if (!config.hasUniqueDeviceKey() || !config.hasSetupCode()) {
    logger.warning("ENROLLMENT_REQUIRED", "Protected management remains unavailable until per-device NVS is installed");
  }
  api.initialize();
  watchdog.initialize();
  logger.info("BOOT_COMPLETE", "All relay outputs remain OFF");
}

void loop() {
  wifi.loop();
  wifiProvisioning.loop();
  setupMode.loop();
  serialRecovery.loop();
  api.loop();
  discovery.loop();
  watchdog.feed();
  yield();
}
