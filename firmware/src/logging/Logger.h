#pragma once

#include <Arduino.h>
#include "logging/ILogger.h"

namespace lucky {

class Logger final : public ILogger {
 public:
  explicit Logger(Stream& output);
  void info(const char* event, const char* message) override;
  void warning(const char* event, const char* message) override;
  void error(const char* event, const char* message) override;
  void request(const char* method, const String& path, int statusCode);

 private:
  Stream& output_;
  void write(const char* level, const char* event, const char* message);
  static String sanitize(const char* value);
};

}  // namespace lucky
