# REST API v1

All firmware version fields come from the running build's `defaults::kFirmwareVersion`; persisted NVS metadata cannot override them. Remote restart is not supported and this firmware exposes no restart endpoint.

Base path: `/api/v1`  
Content type: `application/json`

All errors:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message."
  }
}
```

## Authentication

Every POST requires:

```http
X-Lucky-Device-Key: <device-key>
```

Missing/invalid/empty configured keys return HTTP 401. The key is never included in logs or responses.

## GET /health

Public. Returns status, identity, versions, uptime, Wi-Fi state/RSSI, configured relay count, active channel count, and free heap bytes.

## GET /device

Public. Returns device ID/name, firmware/hardware/API versions, relay count, supported counts `[2,4,8]`, and board model. A controller migrated from the legacy fixed identity also returns `previousDeviceId`; this is public identity metadata, not a credential.

## POST /device/verify

Authenticated with `X-Lucky-Device-Key`. The request must contain a fresh hexadecimal nonce:

```json
{"nonce":"<32-to-64-hex-characters>"}
```

The response returns `verified: true`, the same nonce, Device ID/name, firmware/API/hardware versions, the configured relay count, identity migration metadata, and `proof`.

`proof` is HMAC-SHA256 over:

```text
nonce:deviceId:identityMigrationVersion
```

using the Device Key. The Backend compares the nonce and proof in constant time.

For a migrated controller:

```json
{
  "success": true,
  "verified": true,
  "nonce": "0123456789abcdef0123456789abcdef",
  "proof": "<hmac-sha256>",
  "deviceId": "LRC-A1B2C3D4E5F6",
  "previousDeviceId": "LRC-0001",
  "identityMigrationVersion": 1,
  "relayCount": 4
}
```

`relayCount` is read from the controller's active configuration. The value above is an example for a four-channel controller, not a hardcoded value.

This endpoint is intentionally side-effect free: it does not open, close, pulse, or otherwise change any Relay.

## GET /relays

Public. Returns only channels `1..relayCount`:

```json
{
  "success": true,
  "relayCount": 2,
  "relays": [
    {"channel": 1, "state": "OFF", "gpio": 13},
    {"channel": 2, "state": "OFF", "gpio": 14}
  ]
}
```

Disabled channels are never listed as usable.

## POST /relays/{id}/state

Authenticated body:

```json
{"state":"ON"}
```

`state` is exactly `ON` or `OFF`. IDs are decimal integers starting at 1. A channel above configured `relayCount` returns 404 `RELAY_CHANNEL_NOT_AVAILABLE`.

## POST /relays/all/off

Authenticated. Ignores no GPIO: all eight known pins are written HIGH. Returns configured count and `state: "OFF"`.

## GET /config/relay

Public:

```json
{
  "success": true,
  "relayCount": 4,
  "supportedRelayCounts": [2,4,8],
  "activeChannels": [1,2,3,4]
}
```

## POST /config/relay

Authenticated body:

```json
{"relayCount":4}
```

Only 2, 4, or 8 are accepted. All pins turn OFF before persistence and reconfiguration. Success returns `restartRequired: false`.

## Status codes

- 200: successful GET/POST
- 400: malformed JSON, unsupported count, invalid state
- 401: authentication failure
- 404: route or relay channel unavailable
- 500: persistence/internal relay failure

HTTP 409 is reserved for a future safe-state conflict. Sprint 11A operations are serialized by the single WebServer loop and configuration changes first force all relays OFF.

## Phase 4 Setup API

Device-Key authenticated endpoints:

- `POST /setup/code/candidate`, `/setup/code/verify`, `/setup/code/commit`, `/setup/code/rollback`
- `POST /setup/mode/start`, `/setup/mode/stop`
- `GET /setup/mode/status`

All paths above use the `/api/v1` base. Start requires a unique Device Key, `confirmed:true`, an enrolled Setup Code, no active Wi-Fi transition, and every Relay OFF.

Portal-local endpoints are `/setup/api/auth`, `/networks`, `/status`, `/candidate`, `/commit`, and `/rollback`. Except authentication, they require `X-Lucky-Setup-Session`. A portal token cannot authorize any `/api/v1` management or Relay endpoint. No GET response contains Setup Code or Wi-Fi credentials.
