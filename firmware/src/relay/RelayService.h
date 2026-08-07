#pragma once

#include <array>
#include <cstdint>
#include "lucky/RelayConfig.h"
#include "logging/ILogger.h"
#include "relay/IGpioDriver.h"

namespace lucky {

enum class RelayState : std::uint8_t { Off, On };

struct RelaySnapshot {
  std::uint8_t channel;
  std::uint8_t gpio;
  RelayState state;
};

class RelayService {
 public:
  RelayService(IGpioDriver& gpio, ILogger& logger);
  void safeInitializeAllPins();
  void initialize(RelayBoardSize boardSize);
  bool turnOn(std::uint8_t channel);
  bool turnOff(std::uint8_t channel);
  void turnAllOff();
  RelayState getState(std::uint8_t channel) const;
  std::array<RelaySnapshot, kMaximumRelayCount> getAllStates() const;
  bool isValidChannel(std::uint8_t channel) const;
  std::uint8_t getRelayCount() const;
  std::uint8_t getGpio(std::uint8_t channel) const;

 private:
  IGpioDriver& gpio_;
  ILogger& logger_;
  RelayBoardSize boardSize_{kDefaultRelayBoardSize};
  std::array<RelayState, kMaximumRelayCount> states_{};
  bool pinsInitialized_{false};
  void forceDisabledChannelsOff();
};

}  // namespace lucky
