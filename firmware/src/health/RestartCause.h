#pragma once

#include <cstdint>

namespace lucky {

// Why the controller last restarted, kept so /api/v1/health can say it instead of leaving a reboot
// to be guessed at. The chip's own reset reason separates power loss, brownout, watchdog and panic;
// a restart this firmware chose to do itself is invisible in that (it reads as a plain software
// reset), so those leave a marker in RTC memory first, which survives a software reset but not a
// power cycle.
enum class RestartCause : std::uint32_t { None = 0, WifiOffline = 0x57F10FF1 };

// Call once, first thing in setup(): reads the reset reason and the marker, then clears the marker.
void captureBootReset();
// Call immediately before ESP.restart() when this firmware is restarting itself on purpose.
void rememberRestartCause(RestartCause cause);

// "POWERON", "BROWNOUT", "TASK_WDT", "PANIC", "SW", ... as of the last captureBootReset().
const char* bootResetReason();
// "WIFI_OFFLINE" when the previous boot ended in a deliberate restart, otherwise "".
const char* bootRestartCause();

}  // namespace lucky
