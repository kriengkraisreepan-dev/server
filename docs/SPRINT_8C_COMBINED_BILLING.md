# Sprint 8C — Combined Billing & POS Payment Integration

## Flow

`ACTIVE/PAUSED table session → billing preview → combined bill draft → existing pending payment → existing payment confirmation → receipt`

`CombinedBillingService` is the only component that joins table-session pricing, confirmed table POS orders, and `BillingService`. Routes do not calculate monetary totals.

## Inclusion and duplicate protection

- Only `TABLE` POS orders with `status: CONFIRMED` and `billingStatus: UNBILLED` are included.
- `DRAFT`, `CANCELLED`, walk-in, and already `BILLED` orders are excluded.
- POS orders move to `BILLED` with `billedBillId`, `billedAt`, and `billedBy` after the bill is created.
- A non-void bill with the same `tableSessionId` is rejected.

## Additive data

`posOrders[]` now has `billingStatus` (`UNBILLED`, `BILLED`, or `VOIDED`) and bill-link metadata. Bills now retain `tableSessionId`, `posOrderIds[]`, `breakdown`, and immutable product snapshots. Existing records continue to load unchanged.

## APIs

| Method | Path | Effect |
|---|---|---|
| GET | `/api/table-sessions/:id/billing-preview` | Read-only breakdown of table charge and eligible POS orders |
| POST | `/api/table-sessions/:id/create-bill` | Creates the combined bill plus the existing pending payment |
| POST | `/api/tables/:id/checkout` | Compatibility route; delegates to the same combined flow |

Payment methods remain `cash`, `transfer`, and `qr`. Partial payment is intentionally not supported.

## Void policy

Voiding a combined bill retains its audit history, cancels a pending payment, marks linked POS orders `VOIDED`, and restores stock using the existing immutable return movement. A voided order cannot enter another bill automatically.

## Reports and receipts

Reports continue to use `playAmount` and `foodAmount`; combined bills populate both, so daily/monthly totals include table and product revenue while retaining the split. Receipts group product snapshots into drinks and food/other categories, then show the table charge and final total.

## Known limitations

- There is no partial payment, split bill, or bill reissue flow.
- Category grouping uses the POS item category snapshot; legacy items without category data appear under food/other.
- Final browser validation requires non-production test accounts for OWNER, CASHIER, and STAFF.
