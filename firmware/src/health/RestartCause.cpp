#include "health/RestartCause.h"

#include <Arduino.h>
#include <esp_system.h>

namespace lucky {
namespace {

// Uninitialised RTC memory: holds its value across a software reset, is garbage after power-on.
// The marker is only believed when the chip also reports a software reset, so garbage can't pass.
RTC_NOINIT_ATTR std::uint32_t restartMarker;

const char* reasonName = "UNKNOWN";
RestartCause bootCause = RestartCause::None;

const char* describe(esp_reset_reason_t reason) {
  switch (reason) {
    case ESP_RST_POWERON: return "POWERON";
    case ESP_RST_EXT: return "EXT";
    case ESP_RST_SW: return "SW";
    case ESP_RST_PANIC: return "PANIC";
    case ESP_RST_INT_WDT: return "INT_WDT";
    case ESP_RST_TASK_WDT: return "TASK_WDT";
    case ESP_RST_WDT: return "WDT";
    case ESP_RST_DEEPSLEEP: return "DEEPSLEEP";
    case ESP_RST_BROWNOUT: return "BROWNOUT";
    case ESP_RST_SDIO: return "SDIO";
    default: return "UNKNOWN";
  }
}

}  // namespace

void captureBootReset() {
  const esp_reset_reason_t reason = esp_reset_reason();
  reasonName = describe(reason);
  bootCause = (reason == ESP_RST_SW && restartMarker == static_cast<std::uint32_t>(RestartCause::WifiOffline))
                  ? RestartCause::WifiOffline
                  : RestartCause::None;
  restartMarker = 0;
}

void rememberRestartCause(const RestartCause cause) { restartMarker = static_cast<std::uint32_t>(cause); }

const char* bootResetReason() { return reasonName; }

const char* bootRestartCause() { return bootCause == RestartCause::WifiOffline ? "WIFI_OFFLINE" : ""; }

}  // namespace lucky
