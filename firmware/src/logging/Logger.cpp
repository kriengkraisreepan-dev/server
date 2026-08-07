#include "logging/Logger.h"

namespace lucky {

Logger::Logger(Stream& output) : output_(output) {}

void Logger::info(const char* event, const char* message) { write("INFO", event, message); }
void Logger::warning(const char* event, const char* message) { write("WARNING", event, message); }
void Logger::error(const char* event, const char* message) { write("ERROR", event, message); }

void Logger::request(const char* method, const String& path, const int statusCode) {
  const String message = String(method) + " " + path + " " + statusCode;
  write("INFO", "API_REQUEST", message.c_str());
}

String Logger::sanitize(const char* value) {
  String result(value == nullptr ? "" : value);
  result.replace("\\", "\\\\");
  result.replace("\"", "\\\"");
  result.replace("\r", " ");
  result.replace("\n", " ");
  return result;
}

void Logger::write(const char* level, const char* event, const char* message) {
  output_.printf(
      "{\"uptimeMs\":%lu,\"level\":\"%s\",\"event\":\"%s\",\"message\":\"%s\"}\n",
      millis(), sanitize(level).c_str(), sanitize(event).c_str(), sanitize(message).c_str());
}

}  // namespace lucky
