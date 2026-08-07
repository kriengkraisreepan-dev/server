# Device Discovery Protocol v1

Discovery is public metadata only. It never carries the Device Key, Wi-Fi password, API credentials, or provisioning data and never mutates relay state.

## Stable device identity

New installations derive `LRC-XXXXXXXXXXXX` from the ESP32 eFuse MAC and persist it in NVS. A stored non-default Device ID is preserved. The legacy default `LRC-0001` is migrated once; `previousDeviceId` remains available so the manager can perform a fail-closed record migration.

## mDNS

- Hostname: `lucky-relay-<last-four-id-characters>.local`
- Service: `_lucky-relay._tcp.local`
- Port: `80`
- TXT: `protocolVersion`, `deviceId`, `deviceName`, `firmwareVersion`, `apiVersion`, `hardwareStandard`, `relayCount`

mDNS starts only after STA Wi-Fi connects, stops on disconnect, and starts again after reconnect.

## UDP

- UDP port: `42101`
- Maximum request: 512 bytes
- Protocol marker: `lucky-relay-discovery`
- Protocol version: `1`
- Minimum response interval: 250 ms

Request:

```json
{"protocol":"lucky-relay-discovery","protocolVersion":1,"type":"discover"}
```

Response:

```json
{
  "protocol":"lucky-relay-discovery",
  "protocolVersion":1,
  "type":"announce",
  "deviceId":"LRC-A1B2C3D4E5F6",
  "previousDeviceId":"LRC-0001",
  "identityMigrationVersion":1,
  "deviceName":"lucky-relay-01",
  "ip":"192.168.1.50",
  "apiPort":80,
  "firmwareVersion":"1.1.0",
  "apiVersion":"1",
  "hardwareStandard":"LHS-1.0",
  "relayCount":8
}
```

`previousDeviceId` is omitted when no legacy migration occurred. Invalid, oversized, wrong-type, or unsupported-version packets receive no response.

Discovery metadata alone never authorizes migration. Legacy records are migrated only inside the Hardware Setup Wizard after explicit user confirmation and successful nonce/HMAC Device Key verification. Ambiguous records fail closed.

Every discovered address must be verified with:

- `GET /api/v1/health`
- `GET /api/v1/device`
- `GET /api/v1/config/relay`
- `GET /api/v1/relays`
