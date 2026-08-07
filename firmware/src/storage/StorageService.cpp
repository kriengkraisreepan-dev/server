#include "storage/StorageService.h"

namespace lucky {

bool StorageService::initialize() {
  if (initialized_) return true;
  initialized_ = preferences_.begin(kNamespace, false);
  return initialized_;
}

void StorageService::close() {
  if (!initialized_) return;
  preferences_.end();
  initialized_ = false;
}

String StorageService::getString(const char* key, const String& defaultValue) {
  return initialized_ ? preferences_.getString(key, defaultValue) : defaultValue;
}

std::uint8_t StorageService::getUInt8(const char* key, const std::uint8_t defaultValue) {
  return initialized_ ? preferences_.getUChar(key, defaultValue) : defaultValue;
}

bool StorageService::putString(const char* key, const String& value) {
  return initialized_ && preferences_.putString(key, value) > 0;
}

bool StorageService::putUInt8(const char* key, const std::uint8_t value) {
  return initialized_ && preferences_.putUChar(key, value) == sizeof(value);
}

bool StorageService::hasKey(const char* key) {
  return initialized_ && preferences_.isKey(key);
}

bool StorageService::remove(const char* key) { return initialized_ && preferences_.remove(key); }

bool StorageService::clear() { return initialized_ && preferences_.clear(); }

}  // namespace lucky
