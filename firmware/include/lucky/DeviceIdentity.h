#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

namespace lucky {

inline std::array<char, 17> deviceIdFromHardwareValue(const std::uint64_t hardwareId) {
  constexpr char hex[] = "0123456789ABCDEF";
  std::array<char, 17> value{'L','R','C','-',0,0,0,0,0,0,0,0,0,0,0,0,'\0'};
  const std::uint64_t compact = hardwareId & 0xFFFFFFFFFFFFULL;
  for (std::size_t index = 0; index < 12; ++index) {
    const std::size_t shift = (11 - index) * 4;
    value[4 + index] = hex[(compact >> shift) & 0x0F];
  }
  return value;
}

}  // namespace lucky
