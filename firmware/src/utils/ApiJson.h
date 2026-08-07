#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

namespace lucky {

inline String serializeDocument(JsonDocument& document) {
  String output;
  output.reserve(measureJson(document) + 1);
  serializeJson(document, output);
  return output;
}

inline const char* relayStateName(const bool on) { return on ? "ON" : "OFF"; }

}  // namespace lucky
