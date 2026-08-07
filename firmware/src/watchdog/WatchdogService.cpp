#include "watchdog/WatchdogService.h"
#include <esp_task_wdt.h>

namespace lucky {

WatchdogService::WatchdogService(ILogger& logger) : logger_(logger) {}

bool WatchdogService::initialize() {
  const esp_err_t initialized = esp_task_wdt_init(kTimeoutSeconds, true);
  if (initialized != ESP_OK && initialized != ESP_ERR_INVALID_STATE) {
    logger_.error("WATCHDOG_INIT_FAILED", "Task watchdog initialization failed");
    return false;
  }
  const esp_err_t added = esp_task_wdt_add(nullptr);
  initialized_ = added == ESP_OK || added == ESP_ERR_INVALID_STATE;
  if (initialized_) logger_.info("WATCHDOG_STARTED", "Main loop watchdog active");
  return initialized_;
}

void WatchdogService::feed() {
  if (initialized_) esp_task_wdt_reset();
}

}  // namespace lucky
