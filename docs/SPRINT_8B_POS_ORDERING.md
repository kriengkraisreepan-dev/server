# Sprint 8B — POS Ordering & Cart System

## Architecture and lifecycle

`Route → permission middleware → PosOrderService → JsonPosOrderRepository / InventoryService → store.json`.

The lifecycle is `DRAFT → CONFIRMED` or `DRAFT → CANCELLED`; a confirmed order can also become `CANCELLED` only through an OWNER or MANAGER cancellation with stock restoration. Sprint 8B deliberately does not create a payment or a combined table bill.

## JSON model

`posOrders[]` is additive. Each order persists number, type (`WALK_IN`/`TABLE`), optional table reference, item snapshots, totals, status, notes, actors, timestamps, cancel reason, and version. Items snapshot SKU, name, category, selling price, cost, quantity, and stock-tracking flag. Product edits never rewrite an existing order item.

Order numbers use `POS-YYYYMMDD-0001`; the service scans existing daily order numbers, so numbering survives server restart and does not rely on array length.

## Ownership and permissions

- OWNER/MANAGER: view and manage all orders, confirm, cancel draft, and cancel confirmed orders.
- CASHIER: view/create/edit/confirm/cancel only drafts they created.
- STAFF: view/create/edit/cancel only drafts they created; cannot confirm.

The backend enforces ownership. Menu/button visibility is only a usability aid.

## Stock policy and concurrency

Stock is not reserved while a draft is edited. At confirmation, the service serializes mutations through an application-level queue, reloads/validates active products, verifies the complete batch, then deducts every tracked product and writes immutable `SALE` movements with `POS_ORDER` references. A duplicate confirmation is rejected.

Confirmed cancellation is supported for OWNER/MANAGER. It uses `RETURN` movements with the same POS order reference and rejects a duplicate return. Draft cancellation never changes stock. There is no JSON database transaction, so the service uses a single serialized in-memory mutation and one persistence call after all order/stock changes have been prepared.

## API

`/api/pos-orders` supports create/list/get, item add/update/remove, draft metadata update, confirm, and cancel. All responses are JSON. Errors use 400/401/403/404/409 as appropriate.

## UI

The POS page now has active-product cards, category/search filters, a server-backed cart, Draft creation for WALK_IN/TABLE, quantity controls, note, confirmation, cancellation modal, current-order persistence through a local stored order ID, and recent-order summary. The page explicitly states that a table order is for products only.

## Sprint 8B.1 context hotfix

Draft persistence is scoped by user and context: `walk-in` or `table:<tableId>`. Opening POS from a table card records the requested table context before loading a draft. A stored draft is used only when its order type and table ID match that context; a mismatched legacy/local draft is ignored instead of silently switching tables. Table cards show table charge, confirmed POS product total, and an explicitly non-billed temporary total.

## Manual browser checklist

1. OWNER: create WALK_IN and TABLE drafts, add/update/remove items, refresh, confirm, inspect stock/movement, cancel a confirmed order.
2. MANAGER: inspect another user’s draft and confirm/cancel per policy.
3. CASHIER: create and confirm own order; verify confirmed cancellation is forbidden.
4. STAFF: create/edit own draft; verify Confirm is unavailable/forbidden.
5. Verify out-of-stock cards cannot be added, low-stock badge updates, failed confirmation retains cart, and Dashboard/Tables/Products/Bills/Reports still open.

## Deferred to Sprint 8C

- Combining table charges and POS order totals into one bill.
- POS payment collection and receipt integration.
- Discount handling; `discountAmount` remains zero.
