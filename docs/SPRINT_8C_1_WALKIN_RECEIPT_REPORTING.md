# Sprint 8C.1 — Walk-in Checkout, Receipt Prompt, Table Reset and Sales Summary

## Root cause and table reset rule

The table card previously summed every confirmed POS order with the same `tableId`. This included orders already billed in an earlier session. New table POS orders snapshot `tableSessionId`; a live table card and combined preview include only `CONFIRMED + UNBILLED` orders whose `tableSessionId` matches the active runtime session. Billed, voided, cancelled, other-table, and earlier-session orders remain in history only.

## Walk-in lifecycle

`DRAFT → CONFIRMED → billing preview → bill draft + pending payment → paid → receipt prompt`.

Only OWNER, MANAGER, and CASHIER may create the bill. Walk-in billing uses the existing Billing and Payment services; stock is deducted only at POS confirmation and never during billing. A paid walk-in clears the saved POS draft and reloads stock. A failed payment retains the existing bill/order for the normal payment retry flow.

## Sale source and reporting

New bills retain `saleSource: TABLE | WALK_IN`; older bills remain readable as legacy data. A walk-in bill has a zero table charge, product snapshots, `posOrderIds`, and the standard receipt number/payment status. Dashboard and report calculations continue to aggregate paid bills only: `playAmount` is table revenue and `foodAmount` is combined table-POS plus walk-in product revenue. Void bills are excluded by the existing paid-only rule.

## APIs

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/pos-orders/:id/billing-preview` | Read-only preview for one confirmed, unbilled walk-in order |
| POST | `/api/pos-orders/:id/create-bill` | Creates a walk-in bill and existing pending payment |

Repeated bill creation returns `409 ORDER_ALREADY_BILLED`; it does not create a second bill or reduce stock again.

## Receipt prompt

After successful payment, the existing system modal asks whether to print. Printing reuses the existing receipt flow. Choosing not to print only closes the modal; no sale, payment, or audit data is removed.

## Known limitations

- Partial/split payments are out of scope.
- Orders created before `tableSessionId` was introduced are intentionally not included in a new session automatically; this prevents accidental cross-session charging.
- Full browser validation still needs authorized non-production OWNER, MANAGER, CASHIER, and STAFF accounts.
