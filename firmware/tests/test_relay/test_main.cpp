#include <unity.h>

#include <array>
#include <cstdint>
#include <cstring>
#include "lucky/RelayConfig.h"
#include "lucky/DeviceIdentity.h"
#include "logging/ILogger.h"
#include "relay/IGpioDriver.h"
#include "relay/RelayService.h"

namespace {

class FakeLogger final : public lucky::ILogger {
 public:
  void info(const char*, const char*) override {}
  void warning(const char*, const char*) override { ++warnings; }
  void error(const char*, const char*) override { ++errors; }
  int warnings{0};
  int errors{0};
};

class FakeGpio final : public lucky::IGpioDriver {
 public:
  void configureOutput(const std::uint8_t gpio) override { configured[gpio] = true; }
  void writeHigh(const std::uint8_t gpio) override { high[gpio] = true; }
  void writeLow(const std::uint8_t gpio) override { high[gpio] = false; }
  bool isHigh(const std::uint8_t gpio) const override { return high[gpio]; }
  std::array<bool, 40> configured{};
  std::array<bool, 40> high{};
};

void assertAllKnownPinsHigh(const FakeGpio& gpio) {
  for (const auto pin : lucky::kRelayGpioPins) {
    TEST_ASSERT_TRUE(gpio.configured[pin]);
    TEST_ASSERT_TRUE(gpio.high[pin]);
  }
}

void testConfigurationModel() {
  TEST_ASSERT_EQUAL_UINT8(8, lucky::relayCount(lucky::kDefaultRelayBoardSize));
  for (const auto accepted : {2, 4, 8}) TEST_ASSERT_TRUE(lucky::isSupportedRelayCount(accepted));
  for (const auto rejected : {1, 3, 6, 16}) TEST_ASSERT_FALSE(lucky::isSupportedRelayCount(rejected));
  const auto corrupt = lucky::resolveRelayBoardSize(6);
  TEST_ASSERT_TRUE(corrupt.usedFallback);
  TEST_ASSERT_EQUAL_UINT8(8, lucky::relayCount(corrupt.boardSize));
}

void testStableDeviceIdentity() {
  const auto first = lucky::deviceIdFromHardwareValue(0xA1B2C3D4E5F6ULL);
  const auto again = lucky::deviceIdFromHardwareValue(0xA1B2C3D4E5F6ULL);
  const auto other = lucky::deviceIdFromHardwareValue(0xA1B2C3D4E5F7ULL);
  TEST_ASSERT_EQUAL_STRING("LRC-A1B2C3D4E5F6", first.data());
  TEST_ASSERT_EQUAL_STRING(first.data(), again.data());
  TEST_ASSERT_NOT_EQUAL(0, strcmp(first.data(), other.data()));
}

void testSafeBootStartsAllPinsHigh() {
  FakeGpio gpio;
  FakeLogger logger;
  lucky::RelayService service(gpio, logger);
  service.safeInitializeAllPins();
  assertAllKnownPinsHigh(gpio);
}

void testTwoChannelBoard() {
  FakeGpio gpio;
  FakeLogger logger;
  lucky::RelayService service(gpio, logger);
  service.safeInitializeAllPins();
  service.initialize(lucky::RelayBoardSize::Channels2);
  TEST_ASSERT_TRUE(service.turnOn(1));
  TEST_ASSERT_TRUE(service.turnOn(2));
  TEST_ASSERT_FALSE(service.turnOn(3));
  TEST_ASSERT_FALSE(gpio.high[13]);
  TEST_ASSERT_FALSE(gpio.high[14]);
  for (std::size_t index = 2; index < lucky::kMaximumRelayCount; ++index) {
    TEST_ASSERT_TRUE(gpio.high[lucky::kRelayGpioPins[index]]);
  }
}

void testFourChannelBoard() {
  FakeGpio gpio;
  FakeLogger logger;
  lucky::RelayService service(gpio, logger);
  service.initialize(lucky::RelayBoardSize::Channels4);
  for (std::uint8_t channel = 1; channel <= 4; ++channel) TEST_ASSERT_TRUE(service.turnOn(channel));
  TEST_ASSERT_FALSE(service.turnOn(5));
  for (std::size_t index = 4; index < lucky::kMaximumRelayCount; ++index) {
    TEST_ASSERT_TRUE(gpio.high[lucky::kRelayGpioPins[index]]);
  }
}

void testEightChannelBoard() {
  FakeGpio gpio;
  FakeLogger logger;
  lucky::RelayService service(gpio, logger);
  service.initialize(lucky::RelayBoardSize::Channels8);
  for (std::uint8_t channel = 1; channel <= 8; ++channel) TEST_ASSERT_TRUE(service.turnOn(channel));
  TEST_ASSERT_FALSE(service.turnOn(9));
  service.turnAllOff();
  assertAllKnownPinsHigh(gpio);
}

void testRuntimeShrinkTurnsEverythingOff() {
  FakeGpio gpio;
  FakeLogger logger;
  lucky::RelayService service(gpio, logger);
  service.initialize(lucky::RelayBoardSize::Channels8);
  TEST_ASSERT_TRUE(service.turnOn(8));
  service.initialize(lucky::RelayBoardSize::Channels2);
  TEST_ASSERT_EQUAL_UINT8(2, service.getRelayCount());
  assertAllKnownPinsHigh(gpio);
}

}  // namespace

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(testConfigurationModel);
  RUN_TEST(testStableDeviceIdentity);
  RUN_TEST(testSafeBootStartsAllPinsHigh);
  RUN_TEST(testTwoChannelBoard);
  RUN_TEST(testFourChannelBoard);
  RUN_TEST(testEightChannelBoard);
  RUN_TEST(testRuntimeShrinkTurnsEverythingOff);
  return UNITY_END();
}
