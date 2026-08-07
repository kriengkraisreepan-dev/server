# Architecture

## Design invariants

1. One firmware supports 2/4/8-channel boards.
2. GPIO mapping is fixed by Lucky Hardware Standard v1.0.
3. All relay outputs are active LOW and default HIGH/OFF.
4. Only `RelayService` manipulates relay GPIO.
5. Only `StorageService` accesses ESP32 Preferences/NVS.
6. Every POST is authenticated before body or state processing.
7. Disabled channels are never returned as active and are continuously forced HIGH.

## Dependency flow

```text
main
 ├─ Logger
 ├─ StorageService ← ConfigService
 ├─ ArduinoGpioDriver ← RelayService
 ├─ ConfigService ← WifiService
 ├─ ConfigService ← AuthService
 ├─ Config/Wifi ← HealthService
 ├─ Config/Relay/Auth/Health/Logger ← ApiServer
 └─ Logger ← WatchdogService
```

Framework-required application objects are static in `main.cpp`; mutable hardware and configuration state remains encapsulated in services.

`SetupModeService` owns Setup AP/DNS/session/button/recovery lifecycle. It may read Relay safety state but has no Relay mutation method. Portal Wi-Fi transitions reuse `WifiProvisioningService` and the confirmed/candidate NVS slots from Phase 3.

## Boot sequence

1. Start serial logging.
2. `RelayService::safeInitializeAllPins()` configures GPIO 13, 14, 16, 17, 18, 19, 25, and 26 and writes HIGH.
3. Load NVS through ConfigService.
4. Resolve relay count to the enum 2/4/8. Invalid data falls back to 8 and is corrected through ConfigService.
5. Initialize RelayService and switch every channel OFF.
6. Start non-blocking Wi-Fi.
7. Register and start REST API v1.
8. Register main task with watchdog.
9. Feed Wi-Fi, API, and watchdog from the non-blocking loop.

After Wi-Fi connects, `DiscoveryService` starts mDNS and UDP discovery. It stops both transports on disconnect and restarts them after reconnect. Discovery only reads Config, Wi-Fi and Relay metadata; it has no GPIO mutation method.

## Stable device identity migration

An absent Device ID is initialized from the ESP32 eFuse MAC. The legacy fixed value `LRC-0001` is replaced once with `LRC-XXXXXXXXXXXX`; both the new ID and previous ID are persisted through `ConfigService`/`StorageService`. Any other stored Device ID is preserved across normal firmware updates.

## Runtime relay-count change

The API validates auth, JSON, and supported count before mutation. RelayService switches every channel OFF. ConfigService persists the value. Only after successful persistence is RelayService reinitialized. Persistence failure returns HTTP 500 with every relay still OFF and the previous in-memory relay count retained.

## Failure boundaries

- Invalid/corrupt relay count: safe fallback 8, warning, all pins OFF.
- Missing API key: GET remains available; every POST returns 401.
- Wi-Fi loss: warning and bounded periodic reconnect attempts without blocking the main loop.
- Invalid/disabled relay: 404 and no GPIO mutation.
- NVS persistence failure: 500 and no runtime configuration activation.
- Firmware freeze: task watchdog restarts; safe boot restores all pins HIGH first.

## Backward compatibility

REST paths, JSON fields, fixed GPIO mapping, active-low semantics, and relay counts are architecture locked. Future milestones extend these modules rather than renaming or merging them.
