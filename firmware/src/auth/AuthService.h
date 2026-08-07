#pragma once

#include <Arduino.h>
#include <WebServer.h>
#include "config/ConfigService.h"
#include "logging/ILogger.h"

namespace lucky {

class AuthService {
 public:
  AuthService(const ConfigService& config, ILogger& logger);
  bool authorize(WebServer& server) const;
  const String& authorizedKey() const;

 private:
  static constexpr const char* kHeaderName = "X-Lucky-Device-Key";
  const ConfigService& config_;
  ILogger& logger_;
  mutable String authorizedKey_;
  static bool constantTimeEquals(const String& left, const String& right);
};

}  // namespace lucky
