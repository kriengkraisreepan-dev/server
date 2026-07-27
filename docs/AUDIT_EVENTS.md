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
