#include "storage/ProvisioningBackup.h"

#include <cstddef>
#include <cstring>

namespace lucky {
namespace {

constexpr std::uint32_t kMagic = 0x4B42524CUL;  // "LRBK"
constexpr std::uint16_t kFormat = 1;
constexpr std::size_t kSlotSize = 4096;  // one flash sector per copy, so each erases on its own
constexpr std::size_t kSlotCount = 2;

struct Record {
  std::uint32_t magic;
  std::uint16_t format;
  std::uint16_t length;
  std::uint32_t sequence;
  std::uint32_t reserved;
  std::uint64_t chipId;
  std::uint8_t setupVersion;
  std::uint8_t relayCount;
  std::uint8_t relayActiveHigh;
  std::uint8_t padding;
  char apiKey[129];
  char wifiSSID[33];
  char wifiPassword[65];
  char setupCode[17];
  std::uint32_t crc;  // over every byte before this field
};
static_assert(sizeof(Record) <= kSlotSize, "a backup copy must fit in one flash sector");

std::uint32_t crc32(const std::uint8_t* data, std::size_t length) {
  std::uint32_t crc = 0xFFFFFFFFUL;
  for (std::size_t index = 0; index < length; ++index) {
    crc ^= data[index];
    for (int bit = 0; bit < 8; ++bit) crc = (crc >> 1) ^ (0xEDB88320UL & (0UL - (crc & 1UL)));
  }
  return ~crc;
}

std::uint32_t recordCrc(const Record& record) {
  return crc32(reinterpret_cast<const std::uint8_t*>(&record), offsetof(Record, crc));
}

std::uint64_t chipId() { return ESP.getEfuseMac() & 0xFFFFFFFFFFFFULL; }

// Refuses rather than truncates: a shortened Wi-Fi password or Device Key restored later would be
// worse than no copy at all.
bool copyField(char* target, std::size_t capacity, const String& value) {
  if (value.length() >= capacity) return false;
  memcpy(target, value.c_str(), value.length());
  return true;
}

bool terminated(const char* field, std::size_t capacity) { return memchr(field, '\0', capacity) != nullptr; }

bool readSlot(const esp_partition_t* partition, std::size_t slot, Record& record) {
  if (esp_partition_read(partition, slot * kSlotSize, &record, sizeof(record)) != ESP_OK) return false;
  return record.magic == kMagic && record.format == kFormat && record.length == sizeof(Record) &&
         record.crc == recordCrc(record) && record.chipId == chipId() &&
         terminated(record.apiKey, sizeof(record.apiKey)) && terminated(record.wifiSSID, sizeof(record.wifiSSID)) &&
         terminated(record.wifiPassword, sizeof(record.wifiPassword)) && terminated(record.setupCode, sizeof(record.setupCode));
}

// Index of the newest intact copy, or -1.
int newestSlot(const esp_partition_t* partition, Record& newest) {
  int found = -1;
  for (std::size_t slot = 0; slot < kSlotCount; ++slot) {
    Record candidate{};
    if (!readSlot(partition, slot, candidate)) continue;
    if (found < 0 || candidate.sequence > newest.sequence) { newest = candidate; found = static_cast<int>(slot); }
  }
  return found;
}

}  // namespace

bool ProvisioningSnapshot::operator==(const ProvisioningSnapshot& other) const {
  return apiKey == other.apiKey && wifiSSID == other.wifiSSID && wifiPassword == other.wifiPassword &&
         setupCode == other.setupCode && setupVersion == other.setupVersion && relayCount == other.relayCount &&
         relayActiveHigh == other.relayActiveHigh;
}

ProvisioningBackup::ProvisioningBackup(ILogger& logger) : logger_(logger) {}

// Looked up on first use rather than in the constructor, which runs before the IDF is up.
const esp_partition_t* ProvisioningBackup::partition() {
  if (!looked_) {
    looked_ = true;
    partition_ = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_DATA_SPIFFS, "spiffs");
    if (partition_ && partition_->size < kSlotSize * kSlotCount) partition_ = nullptr;
    if (!partition_) logger_.warning("PROVISIONING_BACKUP_UNAVAILABLE", "No spare flash partition for the settings backup");
  }
  return partition_;
}

bool ProvisioningBackup::read(ProvisioningSnapshot& snapshot) {
  const esp_partition_t* target = partition();
  Record record{};
  if (!target || newestSlot(target, record) < 0) return false;
  snapshot.apiKey = record.apiKey;
  snapshot.wifiSSID = record.wifiSSID;
  snapshot.wifiPassword = record.wifiPassword;
  snapshot.setupCode = record.setupCode;
  snapshot.setupVersion = record.setupVersion;
  snapshot.relayCount = record.relayCount;
  snapshot.relayActiveHigh = record.relayActiveHigh != 0;
  return true;
}

bool ProvisioningBackup::write(const ProvisioningSnapshot& snapshot) {
  const esp_partition_t* target = partition();
  if (!target) return false;
  Record current{};
  const int newest = newestSlot(target, current);

  Record record;
  memset(&record, 0, sizeof(record));
  record.magic = kMagic;
  record.format = kFormat;
  record.length = sizeof(Record);
  record.sequence = newest < 0 ? 1 : current.sequence + 1;
  record.chipId = chipId();
  record.setupVersion = snapshot.setupVersion;
  record.relayCount = snapshot.relayCount;
  record.relayActiveHigh = snapshot.relayActiveHigh ? 1 : 0;
  if (!copyField(record.apiKey, sizeof(record.apiKey), snapshot.apiKey) ||
      !copyField(record.wifiSSID, sizeof(record.wifiSSID), snapshot.wifiSSID) ||
      !copyField(record.wifiPassword, sizeof(record.wifiPassword), snapshot.wifiPassword) ||
      !copyField(record.setupCode, sizeof(record.setupCode), snapshot.setupCode)) {
    logger_.error("PROVISIONING_BACKUP_REJECTED", "A setting is too long to back up");
    return false;
  }
  record.crc = recordCrc(record);

  // Replace the older copy (or slot 0 when there is none) so the newest one survives a failed write.
  const std::size_t slot = newest == 0 ? 1 : 0;
  Record check{};
  if (esp_partition_erase_range(target, slot * kSlotSize, kSlotSize) != ESP_OK ||
      esp_partition_write(target, slot * kSlotSize, &record, sizeof(record)) != ESP_OK ||
      !readSlot(target, slot, check) || check.sequence != record.sequence) {
    logger_.error("PROVISIONING_BACKUP_WRITE_FAILED", "Settings backup could not be written");
    return false;
  }
  logger_.info("PROVISIONING_BACKUP_SAVED", "Settings backup updated");
  return true;
}

bool ProvisioningBackup::erase() {
  const esp_partition_t* target = partition();
  return !target || esp_partition_erase_range(target, 0, kSlotSize * kSlotCount) == ESP_OK;
}

}  // namespace lucky
