# Sprint 0 — JSON Data Analysis

Source examined: `data/store.json` as of 2026-07-26. JSON remains the active production store.

| Entity | JSON shape / key | Main fields and types | Nullable / nested / redundancy |
|---|---|---|---|
| Settings | singleton object | string shop name; numeric rates/table count; string PromptPay id | promptPay id may be empty; values are global key/value data |
| Table | `tables[]`, numeric `id` | code/name strings, relay integer, status string, memberId string, startTime ISO string, relayState string | memberId/startTime nullable; `items[]` nested; table items duplicate product snapshot data |
| Member | `members[]`, string `id`; display `code` | name/phone/note strings, integer points, createdAt ISO string | phone/note may be empty; no explicit active/deleted state |
| Product | `products[]`, string `id` | name string, price number, category string, active boolean | category may be empty; no cost, stock, category ID |
| Bill | `bills[]`, string `id`; display `number` | table/member IDs and names, timestamps, duration, numeric totals, payment method/status | table/member IDs may be null; `items[]` intentionally duplicates name/price/total snapshots for receipts |
| Payment | `payments[]`, string `id` | billId, amount number, status, reference, createdAt, optional paidAt | paidAt nullable; current records arise from QR flow |

## Logical relationships

```text
members 1 ──< tables.memberId (active association, nullable)
members 1 ──< bills.memberId (historical link, nullable)
snooker table 1 ──< bills.tableId (historical link, nullable)
products 1 ──< table.items[].productId (nullable snapshot reference)
products 1 ──< bills.items[].productId (nullable snapshot reference)
bills 1 ──< payments.billId (required)
```

Primary keys today are application-managed IDs; no database enforces them. The importer validates duplicate IDs, display codes, required arrays, numeric constraints, active-table start times, and broken payment references. Historical broken member/table/product references are warnings: imports preserve snapshot text while nulling only the relational foreign key.

## Data quality observations

- Receipt snapshots (`tableName`, `memberName`, item names/prices/totals) are deliberate denormalization and must be retained in SQLite.
- Product categories are repeated strings, so import deduplicates them into category rows.
- Current tables carry session state and nested items. SQLite separates an open `table_session` and `session_items`.
- Current bills have no discount field; target schema reserves `discount_amount` as zero for imported rows.
- A legacy JSON backup has no schema/version marker, so import validation is mandatory.
# Sprint 3 additive runtime fields

The JSON production store now may contain `auditLogs` (array). New bills add `receiptNumber`, `*Satang` amounts, pricing snapshot, `awaiting_payment`/`paid`/`void` status, and void metadata. New payments add `method`, `amountSatang`, `pending`/`paid`/`cancelled` status, and timestamps. Older bill/payment shapes remain readable.

Sprint 4 adds `voidReason`, `voidedAt`, `voidedBy`, and `originalReceiptNumber` to a voided bill. Audit entries add `actorId` (currently `SYSTEM` by default, or `UNKNOWN` when blank) while retaining the older `userId` compatibility field.

Sprint 5 adds `users[]`: `userId`, `username`, `passwordHash` (`scrypt$salt$hash`), `displayName`, `role`, `status`, `createdAt`, `updatedAt`, and optional `mustChangePassword`. Server sessions are memory-only and deliberately are not stored in backups.

Sprint 6 adds `failedLoginCount`, `lockedUntil`, `passwordChangedAt`, and `lastLoginAt`. These are additive and retained by JSON backup/restore.

Sprint 7 adds `settings.security`: `timeoutMinutes`, `warningMinutes`, `maxLoginAttempts`, and `lockDurationMinutes`. Legacy stores receive safe defaults during settings normalization.

Sprint 7D changes only validation for future passwords: minimum 8 characters, no complexity requirement. Existing `crypto.scrypt` hashes remain compatible; existing users are never reset automatically.

## Sprint 8A additive product and inventory fields

`products[]` remains backwards compatible with the original `name`, `price`, `category`, and `active` fields. The runtime adds `sku`, `categoryId`, `categoryName`, `cost`, `trackStock`, `stockQuantity`, `lowStockThreshold`, `status`, `createdAt`, `updatedAt`, `createdBy`, and `updatedBy`. Existing products receive `trackStock=false`, so they remain sellable without an invented stock balance.

`productCategories[]` and `stockMovements[]` are new additive arrays. A movement contains `id`, `productId`, `type`, `quantityBefore`, `quantityChange`, `quantityAfter`, `reason`, optional reference fields, `createdAt`, and `createdBy`. JSON backup/restore copies these arrays as part of the store without changing bills, payments, tables, or user records.

## Sprint 8B POS orders

`posOrders[]` is an additive collection. An order includes an immutable order number, `WALK_IN` or `TABLE` reference, `DRAFT`/`CONFIRMED`/`CANCELLED` status, item snapshots, totals, actor/timestamp fields, cancellation metadata, and a version. Its `items[]` preserve product SKU/name/category, selling price/cost, quantity, and stock-tracking state at the time they are added. Product changes do not rewrite these snapshots.

Sprint 8C adds `billingStatus` (`UNBILLED`, `BILLED`, `VOIDED`) and optional bill-link fields to confirmed POS orders. Combined bills add `tableSessionId`, `posOrderIds[]`, `breakdown`, and POS item snapshots. These fields are additive and therefore preserved by the existing JSON backup/restore process.

Sprint 8C.1 adds `saleSource` to new bills (`TABLE` or `WALK_IN`; old records remain legacy-compatible) and snapshots `tableSessionId` on new table POS orders. This prevents an already billed or earlier-session order being displayed as a current table balance.

Sprint 9A adds additive member identity, status/tier, loyalty balances and `memberPointTransactions[]`. Paid bills can retain `pointsEarned`, `pointsBalance`, and idempotency flags; legacy bills remain readable.

Sprint 9A.1 additionally snapshots `memberCode` and `memberName` on new walk-in POS orders and bills. This avoids changing historical receipts if a member profile is edited later. A point ledger entry includes the bill reference, signed point change, balance before/after, actor, and timestamp.

Sprint 9B adds reward settings under `settings.rewards` and additive bill fields `redeemedPoints`, `redeemValue`, `redeemValueSatang`, `rewardPolicySnapshot`, `memberBalanceBeforeRedeem`, and `memberBalanceAfterRedeem`. Point transactions additionally use `REDEEM` and `REDEEM_ROLLBACK`; all values are retained by the existing JSON backup/restore flow.

The Sprint 9B table-time loyalty hotfix adds `settings.loyalty` and bill snapshots `tablePointsEarned`, `tablePlaySecondsSnapshot`, `tablePlayHoursSnapshot`, and `loyaltyPolicySnapshot`. New EARN/VOID ledger rows use reason `TABLE_TIME`. Walk-in bills neither earn nor redeem points.

## Sprint 11 coupons

Sprint 11 adds three additive top-level collections: `coupons[]` (the campaign — code mode, discount rule, scope, allowed `channels`, validity dates, quota and per-member limit), `couponCodes[]` (the printed vouchers of a `UNIQUE`-mode campaign, each `UNUSED`/`RESERVED`/`USED`/`VOID`), and `couponRedemptions[]` (the ledger, one row per claim, `RESERVED` → `APPLIED` | `RELEASED`).

The ledger is the source of truth for quota; `usedCount`/`reservedCount` on the coupon are a denormalised cache recomputed from it. Each redemption freezes a `couponSnapshot` of the rule it was claimed under, so a receipt reprinted after the coupon has been edited still shows what was actually given — the same approach as `rewardPolicySnapshot` and `pricingSnapshot`.

`channels` holds `TABLE`, `WALK_IN`, or both, matching the `saleSource` values bills already carry. A redemption records which one it was claimed on and references either `tableSessionId` or `posOrderId` accordingly.

Coupons are configuration and redemptions are transactional; `scripts/pre-production-data-reset.js` predates them and clears neither, which only matters if that one-time pre-go-live tool is ever run again.
