#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

namespace lucky {

enum class RelayBoardSize : std::uint8_t {
  Channels2 = 2,
  Channels4 = 4,
  Channels8 = 8
};

struct RelayBoardResolution {
  RelayBoardSize boardSize;
  bool usedFallback;
};

inline constexpr RelayBoardSize kDefaultRelayBoardSize = RelayBoardSize::Channels8;
inline constexpr std::array<std::uint8_t, 3> kSupportedRelayCounts{2, 4, 8};
inline constexpr std::array<std::uint8_t, 8> kRelayGpioPins{13, 14, 16, 17, 18, 19, 25, 26};
inline constexpr std::size_t kMaximumRelayCount = kRelayGpioPins.size();

inline constexpr bool isSupportedRelayCount(const std::uint8_t count) {
  return count == static_cast<std::uint8_t>(RelayBoardSize::Channels2) ||
         count == static_cast<std::uint8_t>(RelayBoardSize::Channels4) ||
         count == static_cast<std::uint8_t>(RelayBoardSize::Channels8);
}

inline constexpr RelayBoardResolution resolveRelayBoardSize(const std::uint8_t storedValue) {
  return isSupportedRelayCount(storedValue)
      ? RelayBoardResolution{static_cast<RelayBoardSize>(storedValue), false}
      : RelayBoardResolution{kDefaultRelayBoardSize, true};
}

inline constexpr std::uint8_t relayCount(const RelayBoardSize boardSize) {
  return static_cast<std::uint8_t>(boardSize);
}

}  // namespace lucky
