#include "auth/AuthService.h"
#include <algorithm>

namespace lucky {

AuthService::AuthService(const ConfigService& config, ILogger& logger)
    : config_(config), logger_(logger) {}

bool AuthService::constantTimeEquals(const String& left, const String& right) {
  const std::size_t maximum = std::max<std::size_t>(left.length(), right.length());
  std::size_t difference = left.length() ^ right.length();
  for (std::size_t index = 0; index < maximum; ++index) {
    const char a = index < left.length() ? left[index] : 0;
    const char b = index < right.length() ? right[index] : 0;
    difference |= static_cast<std::uint8_t>(a ^ b);
  }
  return difference == 0;
}

bool AuthService::authorize(WebServer& server) const {
  const String expected = config_.getConfig().apiKey;
  const String candidate = config_.candidateDeviceKey();
  const String provided = server.header(kHeaderName);
  const bool currentAccepted = !expected.isEmpty() && constantTimeEquals(expected, provided);
  const bool candidateAccepted = !candidate.isEmpty() && constantTimeEquals(candidate, provided);
  const bool accepted = currentAccepted || candidateAccepted;
  authorizedKey_ = currentAccepted ? expected : candidateAccepted ? candidate : "";
  if (!accepted) logger_.warning("AUTHENTICATION_FAILED", "POST request rejected");
  return accepted;
}

const String& AuthService::authorizedKey() const { return authorizedKey_; }

}  // namespace lucky
