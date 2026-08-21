# Audit Events

## Sprint 8B POS events

| Event | When recorded |
|---|---|
| `POS_ORDER_CREATED` | A draft order is created. |
| `POS_ORDER_ITEM_ADDED` | A product snapshot is added or its quantity is merged. |
| `POS_ORDER_ITEM_UPDATED` | Quantity or item note changes. |
| `POS_ORDER_ITEM_REMOVED` | An item is removed from a draft. |
| `POS_ORDER_UPDATED` | Draft note/table metadata changes. |
| `POS_ORDER_STOCK_DEDUCTED` | Confirming an order created `SALE` movements. |
| `POS_ORDER_CONFIRMED` | An order is confirmed. |
| `POS_ORDER_STOCK_RESTORED` | OWNER/MANAGER cancellation created `RETURN` movements. |
| `POS_ORDER_CANCELLED` | A draft or confirmed order is cancelled with a reason. |
| `WALK_IN_BILL_CREATED` | A confirmed unbilled walk-in order is linked to a bill. |
| `COMBINED_BILL_CREATED` | Eligible table POS orders are linked to a table-session bill. |

Events use the existing JSON `auditLogs[]` structure and include the actor, POS order entity/reference, before/after data where applicable, timestamp, and cancellation reason. Passwords and other secrets are never recorded.

## Sprint 11 coupon events

| Event | When recorded |
|---|---|
| `COUPON_CREATED` | A coupon campaign is created. Carries the name, code mode and allowed channels. |
| `COUPON_UPDATED` | Editable fields change, with before/after. |
| `COUPON_STATUS_CHANGED` | DRAFT/ACTIVE/PAUSED/EXPIRED moves made by a person, with `from` and `to`. |
| `COUPON_CODES_GENERATED` | A batch of unique voucher codes is generated, with the batch size. |
| `COUPON_RESERVED` | A code is claimed at table open or on a walk-in sale. Carries member, code, channel and the session or POS order. |
| `COUPON_APPLIED` | The reservation is consumed by a bill, with the discount actually given. |
| `COUPON_RELEASED` | Quota is returned, with the reason (`MIN_SPEND_NOT_MET`, `NO_DISCOUNT_AVAILABLE`, `BILL_VOIDED`, or whatever the caller passed). |

`DEPLETED` is a fact about the ledger rather than a decision, so it is derived on every count and is
deliberately not a `COUPON_STATUS_CHANGED` event. Coupon codes themselves are recorded (staff need to
trace a specific voucher); no member personal data beyond the member id is written.
