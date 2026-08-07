# Configuration

Configuration is owned by `ConfigService` and persisted through `StorageService` in NVS namespace `lucky-relay`.

| Field | NVS key | Default | Runtime update in Sprint 11A |
|---|---|---|---|
| deviceId | `deviceId` | `LRC-0001` | No |
| deviceName | `deviceName` | `lucky-relay-01` | No |
| apiKey | `apiKey` | bootstrap value | No |
| wifiSSID | `wifiSSID` | bootstrap value | No |
| wifiPassword | `wifiPassword` | bootstrap value | No |
| firmwareVersion | `firmware` | build-time `defaults::kFirmwareVersion` | No |
| hardwareStandard | `hardware` | `LHS-1.0` | No |
| relayCount | `relayCount` | `8` | Yes, authenticated |
| Setup Code | `setupCode` | absent | Transactional, authenticated |
| Setup Code candidate | `setupCandidate` | absent | Rotation only |
| Setup transition | `setupTransId`, `setupState`, `setupVersion` | absent | Rotation metadata |
| Setup recovery | `setupModeSt`, `setupFails` | `NORMAL`, `0` | Setup state and lockout metadata |

NVS key names are shortened where required by the ESP32 Preferences 15-character key limit. Setup Code storage is additive and does not clear identity, Device Key, Wi-Fi, relay count, or provisioning fields.

## Bootstrap

`BuildConfig.h` contains deliberately empty defaults. Supply real Wi-Fi and API credentials using private PlatformIO build flags. Values are copied into NVS only if the keys do not exist. Real secrets must not be committed.

## Firmware version source of truth

The running image always reports `defaults::kFirmwareVersion`. The legacy `firmware` NVS key is synchronized to that value during initialization for compatibility, but it cannot override the running build. A missing, stale, or malformed NVS value requires no NVS erase and cannot change the version returned by Serial, health/device/verify APIs, mDNS, or UDP discovery.

## Relay count policy

The strongly typed values are:

```cpp
enum class RelayBoardSize : uint8_t {
  Channels2 = 2,
  Channels4 = 4,
  Channels8 = 8
};
```

Missing relay count is initialized to 8. Unsupported/corrupt values resolve to 8 while every GPIO remains OFF, emit `CONFIG_RELAY_COUNT_FALLBACK`, and are persisted through ConfigService. Arbitrary values are never accepted.

## Factory reset

`ConfigService::resetToDefaults()` exists for controlled service tooling. Sprint 11A deliberately exposes no remote factory-reset endpoint.
