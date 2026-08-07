# Lucky Relay Controller v1.1

Production ESP32 firmware for Lucky Snooker Manager. One firmware image supports Lucky Hardware Standard v1.0 relay controllers with 2, 4, or 8 active-low channels.

Version 1.1 adds stable Device ID migration, mDNS `_lucky-relay._tcp.local`, and UDP discovery on port 42101. REST API v1, authentication, GPIO mapping, relay behavior, and Safe Boot remain backward compatible. See `docs/DISCOVERY.md`.

## Supported hardware

- ESP32 DevKitC V4 / ESP32-WROOM-32E, 38-pin board
- 2-channel, 4-channel, or 8-channel 5 V relay board
- Active LOW: GPIO `HIGH` is OFF; GPIO `LOW` is ON
- Optocoupler-isolated relay board preferred

The relay board size is an NVS configuration value. There are no separate firmware variants.

## Architecture

- `config/`: strongly typed device configuration and relay-count policy
- `storage/`: the only direct NVS/Preferences access
- `relay/`: fixed GPIO mapping, active-low control, disabled-channel safety
- `wifi/`: non-blocking station connection monitoring and reconnect
- `api/`: REST API v1 and JSON validation
- `auth/`: constant-time device-key comparison
- `health/`: public operational health snapshot
- `logging/`: structured serial events without credentials
- `watchdog/`: main-loop task watchdog
- `utils/`: JSON response utilities

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Build prerequisites

Install [PlatformIO Core](https://docs.platformio.org/en/latest/core/installation/index.html) or the PlatformIO IDE extension.

```bash
cd firmware
pio run -e esp32dev
```

Native tests:

```bash
pio test -e native
```

## Initial configuration

Before a production build, provide private bootstrap values as build flags or update a private local copy of `include/BuildConfig.h`:

```ini
build_flags =
  -D LUCKY_BOOTSTRAP_WIFI_SSID=\"ClubPrivateWifi\"
  -D LUCKY_BOOTSTRAP_WIFI_PASSWORD=\"replace-with-private-value\"
  -D LUCKY_BOOTSTRAP_API_KEY=\"replace-with-long-random-key\"
```

Bootstrap secrets are copied to NVS only when the respective key is missing. Never commit real secrets. An empty API key intentionally rejects every POST request.

Defaults:

- device ID: `LRC-0001`
- device name: `lucky-relay-01`
- firmware: `1.0.0`
- hardware standard: `LHS-1.0`
- relay count: `8`

## Flash and monitor

Connect the ESP32 by USB:

```bash
pio run -e esp32dev -t upload
pio device monitor -b 115200
```

Confirm `BOOT_COMPLETE` and verify all relay indicators remain OFF before connecting mains-controlled loads.

## Changing relayCount

Read:

```bash
curl http://DEVICE_IP/api/v1/config/relay
```

Update:

```bash
curl -X POST http://DEVICE_IP/api/v1/config/relay \
  -H "Content-Type: application/json" \
  -H "X-Lucky-Device-Key: DEVICE_KEY" \
  -d "{\"relayCount\":4}"
```

Only `2`, `4`, and `8` are valid. Runtime reconfiguration first switches all eight known GPIOs OFF, persists the new value, reconfigures the active channels, and leaves every channel OFF. No restart is required.

## REST API

Public GET endpoints:

- `GET /api/v1/health`
- `GET /api/v1/device`
- `GET /api/v1/relays`
- `GET /api/v1/config/relay`

Authenticated POST endpoints:

- `POST /api/v1/relays/{id}/state`
- `POST /api/v1/relays/all/off`
- `POST /api/v1/config/relay`

Every POST requires `X-Lucky-Device-Key`. See [docs/API.md](docs/API.md).

## GPIO mapping

| Relay | GPIO |
|---:|---:|
| 1 | 13 |
| 2 | 14 |
| 3 | 16 |
| 4 | 17 |
| 5 | 18 |
| 6 | 19 |
| 7 | 25 |
| 8 | 26 |

The mapping is fixed and must not be changed. See [docs/GPIO-MAPPING.md](docs/GPIO-MAPPING.md) and [docs/WIRING.md](docs/WIRING.md).

## Safe boot

Before NVS, Wi-Fi, HTTP, or watchdog initialization, firmware configures all eight known relay GPIO pins as outputs and writes `HIGH`. Configuration is then loaded and validated, RelayService is initialized, and all channels are switched OFF again. Firmware never automatically energizes a relay during boot or restart.

## Milestone exclusions

OTA, command queues/retry, desired-state synchronization, heartbeat, duplicate-command detection, discovery, and captive portal provisioning are intentionally excluded from Sprint 11A.
