#pragma once

namespace lucky {

class ILogger {
 public:
  virtual ~ILogger() = default;
  virtual void info(const char* event, const char* message) = 0;
  virtual void warning(const char* event, const char* message) = 0;
  virtual void error(const char* event, const char* message) = 0;
};

}  // namespace lucky
