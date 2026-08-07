#pragma once

#include <Arduino.h>
#include "lucky/RelayConfig.h"

namespace lucky {

struct DeviceConfig {
  String deviceId;
  String previousDeviceId;
  String deviceName;
  String apiKey;
  String wifiSSID;
  String wifiPassword;
  String firmwareVersion;
  String hardwareStandard;
  RelayBoardSize relayBoardSize;
};

namespace defaults {
inline constexpr const char* kDeviceId = "LRC-0001";
inline constexpr const char* kDeviceName = "lucky-relay-01";
inline constexpr const char* kFirmwareVersion = "1.2.0";
inline constexpr const char* kHardwareStandard = "LHS-1.0";
inline constexpr const char* kBoardModel = "ESP32-DevKitC-V4";
inline constexpr const char* kApiVersion = "1";
}  // namespace defaults

}  // namespace lucky
