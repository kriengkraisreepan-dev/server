#pragma once

#include <Arduino.h>
#include <cstdint>
#include <esp_partition.h>
#include "logging/ILogger.h"

namespace lucky {

// The settings a controller cannot work without and cannot get back by itself: the Wi-Fi it joins,
// the Device Key the server authenticates it with, the Setup Code, and the relay board's shape.
struct ProvisioningSnapshot {
  String apiKey;
  String wifiSSID;
  String wifiPassword;
  String setupCode;
  std::uint8_t setupVersion{0};
  std::uint8_t relayCount{0};
  bool relayActiveHigh{false};

  bool operator==(const ProvisioningSnapshot& other) const;
  bool operator!=(const ProvisioningSnapshot& other) const { return !(*this == other); }
};

// A second copy of ProvisioningSnapshot, kept outside NVS.
//
// Why: the Arduino core erases the whole NVS partition, silently, whenever nvs_flash_init() reports
// NO_FREE_PAGES or NEW_VERSION_FOUND (initArduino() in esp32-hal-misc.c), and a boot on an unstable
// supply can read the partition badly enough to get there. The controller then boots with no Wi-Fi,
// no Device Key and no Setup Code: nothing on the network can reach it and only a USB re-install
// brings it back. With this copy it puts its settings back on the next boot instead.
//
// Where: the first two 4 KB sectors of the default partition table's "spiffs" data partition
// (0x290000), which this firmware never mounts. Existing Update writes the application only and New
// Install writes bootloader, partition table, NVS and application, so neither touches it; after a
// New Install the stale copy is simply replaced, because NVS then carries a different Device Key.
//
// How: two copies, each with a sequence number, a CRC and the chip's eFuse MAC. A write always
// replaces the older copy, so power lost mid-write still leaves the previous one intact, and a copy
// made on another chip (a cloned flash image) is ignored. The data is no more exposed than NVS,
// which is not encrypted on this board either.
class ProvisioningBackup {
 public:
  explicit ProvisioningBackup(ILogger& logger);
  // Newest intact copy written by this chip; false when there is none.
  bool read(ProvisioningSnapshot& snapshot);
  bool write(const ProvisioningSnapshot& snapshot);
  bool erase();

 private:
  ILogger& logger_;
  const esp_partition_t* partition_{nullptr};
  bool looked_{false};
  const esp_partition_t* partition();
};

}  // namespace lucky
