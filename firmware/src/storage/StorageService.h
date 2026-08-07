#pragma once

#include <Arduino.h>
#include <Preferences.h>
#include <cstdint>

namespace lucky {

class StorageService {
 public:
  bool initialize();
  void close();
  String getString(const char* key, const String& defaultValue);
  std::uint8_t getUInt8(const char* key, std::uint8_t defaultValue);
  bool putString(const char* key, const String& value);
  bool putUInt8(const char* key, std::uint8_t value);
  bool hasKey(const char* key);
  bool remove(const char* key);
  bool clear();

 private:
  static constexpr const char* kNamespace = "lucky-relay";
  Preferences preferences_;
  bool initialized_{false};
};

}  // namespace lucky
