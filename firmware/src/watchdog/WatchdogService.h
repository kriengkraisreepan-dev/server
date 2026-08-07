#pragma once

#include "logging/ILogger.h"

namespace lucky {

class WatchdogService {
 public:
  explicit WatchdogService(ILogger& logger);
  bool initialize();
  void feed();

 private:
  static constexpr unsigned int kTimeoutSeconds = 10;
  ILogger& logger_;
  bool initialized_{false};
};

}  // namespace lucky
