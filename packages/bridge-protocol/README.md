# @88snooker/bridge-protocol

Zod schemas for the Shop PC ↔ Cloud hub bridge, protocol v1.
Spec: [`docs/ai-assistant/BRIDGE_PROTOCOL.md`](../../docs/ai-assistant/BRIDGE_PROTOCOL.md) §4–7.
Safety rules: [`docs/ai-assistant/SAFETY_RULES.md`](../../docs/ai-assistant/SAFETY_RULES.md).

Plain JavaScript (CommonJS) + JSDoc, no build step. Its only dependency is `zod`.

## Use

```js
const { parseMessage, serializeMessage } = require('../packages/bridge-protocol');

// Shop PC receiving from the Cloud hub
const r = parseMessage(rawFrame, { direction: 'cloud_to_shop' });
if (!r.ok) {
  // r.code: invalid_input | too_large | bad_json | invalid_envelope | unknown_type | invalid_payload
  log('bridge.unknown_message', { code: r.code, type: r.type, id: r.id }); // S-1.3
  return;
}

// Shop PC sending — throws BridgeProtocolError if the payload breaks the schema (S-2.1)
socket.send(serializeMessage('snapshot', snapshot, { direction: 'shop_to_cloud', id: ulid() }));
```

## Exports

| Name | What |
|---|---|
| `Envelope(type, payloadSchema)`, `BaseEnvelope` | Envelope §4 (`v: 1`, ULID `id`, UTC `ts`) |
| `Snapshot` (+ `ShopInfo`, `SnapshotTable`, `PriceListEntry`, `Promotion`, …) | Snapshot §6 |
| `ApprovalItem`, `ApprovalPayload`, `ApprovalStatus`, `RejectReasonCode` | ApprovalItem §7, states §8 |
| `SHOP_TO_CLOUD`, `CLOUD_TO_SHOP` | Payload schema per allowed type, by direction (§5) |
| `MESSAGE_SCHEMAS`, `ShopToCloudMessage`, `CloudToShopMessage` | Full envelope schema per type |
| `ACK_REQUIRED` | Reply each type expects |
| `parseMessage`, `serializeMessage`, `REJECT_CODES` | Central parser / builder |

## Rules

- Every object is strict: unknown fields are rejected when building and when receiving (S-2.1).
- Adding a message type or a snapshot field is **SAFETY GATE G6**. Get the owner's approval first.
- `approval.decision.decidedBy` is an opaque staff id, never a name. `phoneMasked` shows the last 4 digits only.
- This package must not require anything except `zod` and its own files (checked by `tests/ai-a1-strict-audit.test.js`).

Tests: `tests/ai-a1-*.test.js` (run with `npm test`).
