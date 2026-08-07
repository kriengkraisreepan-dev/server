#pragma once

#include <cstdint>

namespace lucky {

class IGpioDriver {
 public:
  virtual ~IGpioDriver() = default;
  virtual void configureOutput(std::uint8_t gpio) = 0;
  virtual void writeHigh(std::uint8_t gpio) = 0;
  virtual void writeLow(std::uint8_t gpio) = 0;
  virtual bool isHigh(std::uint8_t gpio) const = 0;
};

}  // namespace lucky
