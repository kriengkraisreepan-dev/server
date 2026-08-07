#include "health/HealthService.h"

namespace lucky {

HealthService::HealthService(const ConfigService& config, const WifiService& wifi)
    : config_(config), wifi_(wifi) {}

const char* HealthService::status() const {
  if (config_.getConfig().apiKey.isEmpty()) return "WARNING";
  return wifi_.isConnected() ? "HEALTHY" : "WARNING";
}

unsigned long HealthService::uptimeSeconds() const { return millis() / 1000UL; }
bool HealthService::wifiConnected() const { return wifi_.isConnected(); }
int HealthService::rssi() const { return wifi_.rssi(); }
std::uint32_t HealthService::freeHeapBytes() const { return ESP.getFreeHeap(); }

}  // namespace lucky
