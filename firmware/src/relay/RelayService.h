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
  // Must be set (if not active-low) before safeInitializeAllPins()/initialize() run, since those
  // are what physically drive the GPIO level a relay board interprets as "off". Defaults to
  // false (active-low) so any caller that never touches this keeps today's exact behavior.
  void setActiveHigh(bool activeHigh);
  bool getActiveHigh() const;

 private:
  IGpioDriver& gpio_;
  ILogger& logger_;
  RelayBoardSize boardSize_{kDefaultRelayBoardSize};
  std::array<RelayState, kMaximumRelayCount> states_{};
  bool pinsInitialized_{false};
  bool activeHigh_{false};
  void forceDisabledChannelsOff();
  // activate()/deactivate() are the polarity-aware replacements for calling gpio_.writeHigh/Low
  // directly — "activate" always means "physically turn the relay coil on", regardless of
  // whether that board's control input is active-high or active-low.
  void activate(std::uint8_t gpio);
  void deactivate(std::uint8_t gpio);
};

}  // namespace lucky
