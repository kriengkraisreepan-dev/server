#include "relay/RelayService.h"

namespace lucky {

RelayService::RelayService(IGpioDriver& gpio, ILogger& logger)
    : gpio_(gpio), logger_(logger) {
  states_.fill(RelayState::Off);
}

void RelayService::setActiveHigh(const bool activeHigh) { activeHigh_ = activeHigh; }
bool RelayService::getActiveHigh() const { return activeHigh_; }
void RelayService::activate(const std::uint8_t gpio) { activeHigh_ ? gpio_.writeHigh(gpio) : gpio_.writeLow(gpio); }
void RelayService::deactivate(const std::uint8_t gpio) { activeHigh_ ? gpio_.writeLow(gpio) : gpio_.writeHigh(gpio); }

void RelayService::safeInitializeAllPins() {
  for (const auto pin : kRelayGpioPins) {
    gpio_.configureOutput(pin);
    deactivate(pin);
  }
  states_.fill(RelayState::Off);
  pinsInitialized_ = true;
}

void RelayService::initialize(const RelayBoardSize boardSize) {
  if (!pinsInitialized_) safeInitializeAllPins();
  turnAllOff();
  boardSize_ = boardSize;
  forceDisabledChannelsOff();
}

bool RelayService::isValidChannel(const std::uint8_t channel) const {
  return channel >= 1 && channel <= getRelayCount() && channel <= kMaximumRelayCount;
}

bool RelayService::turnOn(const std::uint8_t channel) {
  if (!isValidChannel(channel)) {
    logger_.warning("RELAY_INVALID_CHANNEL", "Rejected relay ON for unavailable channel");
    return false;
  }
  const auto index = static_cast<std::size_t>(channel - 1);
  activate(kRelayGpioPins[index]);
  states_[index] = RelayState::On;
  logger_.info("RELAY_CHANGED", "Relay state changed to ON");
  forceDisabledChannelsOff();
  return true;
}

bool RelayService::turnOff(const std::uint8_t channel) {
  if (!isValidChannel(channel)) {
    logger_.warning("RELAY_INVALID_CHANNEL", "Rejected relay OFF for unavailable channel");
    return false;
  }
  const auto index = static_cast<std::size_t>(channel - 1);
  deactivate(kRelayGpioPins[index]);
  states_[index] = RelayState::Off;
  logger_.info("RELAY_CHANGED", "Relay state changed to OFF");
  forceDisabledChannelsOff();
  return true;
}

void RelayService::turnAllOff() {
  for (std::size_t index = 0; index < kMaximumRelayCount; ++index) {
    deactivate(kRelayGpioPins[index]);
    states_[index] = RelayState::Off;
  }
}

RelayState RelayService::getState(const std::uint8_t channel) const {
  return isValidChannel(channel) ? states_[channel - 1] : RelayState::Off;
}

std::array<RelaySnapshot, kMaximumRelayCount> RelayService::getAllStates() const {
  std::array<RelaySnapshot, kMaximumRelayCount> snapshots{};
  for (std::size_t index = 0; index < kMaximumRelayCount; ++index) {
    snapshots[index] = {static_cast<std::uint8_t>(index + 1), kRelayGpioPins[index], states_[index]};
  }
  return snapshots;
}

std::uint8_t RelayService::getRelayCount() const { return relayCount(boardSize_); }

std::uint8_t RelayService::getGpio(const std::uint8_t channel) const {
  return channel >= 1 && channel <= kMaximumRelayCount ? kRelayGpioPins[channel - 1] : 0;
}

void RelayService::forceDisabledChannelsOff() {
  for (std::size_t index = getRelayCount(); index < kMaximumRelayCount; ++index) {
    deactivate(kRelayGpioPins[index]);
    states_[index] = RelayState::Off;
  }
}

}  // namespace lucky
