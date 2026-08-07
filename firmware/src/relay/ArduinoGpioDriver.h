#pragma once

#include <Arduino.h>
#include "relay/IGpioDriver.h"

namespace lucky {

class ArduinoGpioDriver final : public IGpioDriver {
 public:
  void configureOutput(std::uint8_t gpio) override { pinMode(gpio, OUTPUT); }
  void writeHigh(std::uint8_t gpio) override { digitalWrite(gpio, HIGH); }
  void writeLow(std::uint8_t gpio) override { digitalWrite(gpio, LOW); }
  bool isHigh(std::uint8_t gpio) const override { return digitalRead(gpio) == HIGH; }
};

}  // namespace lucky
