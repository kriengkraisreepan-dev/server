# API Map — Sprint -1

All endpoints are implemented in `index.js`. They currently use the JSON store, not a database. There is no authentication or edition authorization on any route.

| Method | Path | Purpose / request | Response and data | Validation / risk |
|---|---|---|---|---|
| GET | `/api/state` | No request body; returns application state | settings, enriched tables, members, products, bills, payments | Exposes all business data to any caller on the reachable server |
| PUT | `/api/settings` | Arbitrary JSON merged into settings | settings object | No allow-list/type validation; no authorization |
| GET | `/api/backups` | List backup metadata | JSON list | No authorization |
| POST | `/api/backups` | Create backup | backup filename/time | Writes data; no authorization |
| GET | `/api/backups/:file/download` | Download validated backup filename | JSON file | basename/regex guard exists; no authorization |
| POST | `/api/backups/:file/restore` | Restore validated backup filename | status message | JSON parse only; destructive; no authorization or schema validation |
| DELETE | `/api/backups/:file` | Delete backup | status message | permanent destructive action without authorization |
| POST | `/api/members` | `name`, optional phone/points/note | created member | Name check only; no update/delete/search API |
| POST | `/api/products` | `name`, `price`, optional category | created product | basic name/non-negative check; no update/deactivate/inventory API |
| POST | `/api/tables/:id/start` | optional `memberId` | enriched table, possible relay warning | checks table/member existence; controls relay indirectly |
| POST | `/api/tables/:id/items` | `productId`, optional quantity | enriched table | product/table checks; quantity lacks strict positive integer validation |
| POST | `/api/tables/:id/checkout` | optional `paymentMethod` | bill; QR payment when selected | payment method not allow-listed; creates a bill |
| POST | `/api/payments/:id/confirm` | No body | bill/payment | confirms a pending QR payment without external proof |
| DELETE | `/api/bills/:id` | No body | status message | permanently deletes bill and linked payments without authorization/audit |
| POST | `/api/relay/:tableId` | `state` (`on` or otherwise `off`) | enriched table/message | can trigger a configured ESP32 relay without authorization |
| GET | `/api/reports/summary` | optional `date` | paid-bill aggregates and bills | date syntax is not validated |
| GET | `/api/reports/analytics` | optional `type`, `period` | revenue/time/product aggregates | period syntax is not validated |

`express.static(public)` additionally exposes the SPA assets. No CORS middleware was found; Express therefore does not add permissive CORS headers by default. Local-network exposure must nevertheless be treated as unauthenticated access.
# Sprint 3 additions and behavior

| Method | Path | Behavior |
|---|---|---|
| POST | `/api/tables/:id/checkout` | Creates bill draft and pending cash/transfer payment; does not release table yet. |
| POST | `/api/payments/:id/confirm` | Confirms a pending payment, closes the session, releases the table. |
| POST | `/api/payments/:id/cancel` | Cancels a pending payment; bill remains awaiting payment. |
| DELETE | `/api/bills/:id` | Compatibility path retained; now voids and audits rather than physically deleting. |
| GET | `/api/bills` | Searches bills by receipt, table, date range, status; returns newest-first paginated results. |
| GET | `/api/bills/:id` | Returns bill, linked payments, and related audit events. |

## Sprint 4 Void requirement

`DELETE /api/bills/:id` now requires a non-empty JSON `reason`. It may include `actorId` (or use the `x-actor-id` header); otherwise the audit event is attributed to `SYSTEM`.

## Sprint 5 authentication

| Method | Path | Access |
|---|---|---|
| POST | `/api/auth/login` | Username/password; sets session cookie. |
| POST | `/api/auth/logout` | Authenticated session; removes session. |
| GET | `/api/auth/me` | Authenticated session; returns safe user profile. |

All non-auth API routes now require a valid session. Authorization middleware returns `403` for a logged-in user without the required permission.

## Sprint 7 session and security APIs

`GET /api/session/status`, `PATCH /api/session/refresh`, `GET /api/sessions`, `DELETE /api/sessions/:id`, `DELETE /api/sessions`, `GET /api/settings/session`, and `PATCH /api/settings/session` are authenticated. Session list is OWNER/MANAGER; revoke and settings are OWNER-only.

## Sprint 8A product and inventory APIs

All endpoints below require authentication. `product.view` is granted to every role; `product.manage` and `inventory.manage` are OWNER/MANAGER only.

| Method | Path | Request / behavior | Failure cases |
|---|---|---|---|
| GET | `/api/products` | Filters: `search`, `category`, `status`, `lowStock`, `page`, `pageSize`; response includes `items` and `pagination` | 403 without view permission |
| GET | `/api/products/:id` | Returns one visible product | 404 unknown/hidden product |
| POST | `/api/products` | Creates normalized product; accepts initial stock | 400 invalid fields, 409 duplicate SKU |
| PATCH | `/api/products/:id` | Updates metadata only | 400 validation, 404 unknown category/product |
| PATCH | `/api/products/:id/status` | `ACTIVE` or `DISABLED` | 400 invalid status |
| POST | `/api/products/:id/stock/receive` | Positive `quantity`, optional reason/reference | 400 untracked/invalid quantity |
| POST | `/api/products/:id/stock/adjust` | Non-zero `quantityChange`, required reason | 400 invalid/negative resulting stock |
| GET | `/api/products/:id/stock-movements` | Paginated immutable history | 404 unknown product |
| GET | `/api/product-categories` | Lists visible categories | 403 without view permission |
| POST/PATCH | `/api/product-categories` | Create/update name/sort order | 400 invalid, 409 duplicate name |
| PATCH | `/api/product-categories/:id/status` | `ACTIVE` or `DISABLED` | 400/404 |

## Sprint 8B POS order APIs

All POS APIs are authenticated JSON endpoints. See `SPRINT_8B_POS_ORDERING.md` for ownership rules.

| Method | Path | Permission |
|---|---|---|
| POST / GET | `/api/pos-orders` | create / view |
| GET / PATCH | `/api/pos-orders/:id` | view / edit draft |
| POST | `/api/pos-orders/:id/items` | edit draft |
| PATCH / DELETE | `/api/pos-orders/:id/items/:itemId` | edit draft |
| POST | `/api/pos-orders/:id/confirm` | confirm |
| POST | `/api/pos-orders/:id/cancel` | cancel draft; confirmed cancellation requires OWNER/MANAGER |

## Sprint 8B.1 security summary

| Method | Path | Access | Response |
|---|---|---|---|
| GET | `/api/security/summary` | OWNER, MANAGER | `activeSessions`, `onlineUsers`, `lockedAccounts`, `disabledUsers` |

## Sprint 8C combined billing

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/api/table-sessions/:id/billing-preview` | OWNER, MANAGER, CASHIER | Read-only table/POS combined preview |
| POST | `/api/table-sessions/:id/create-bill` | OWNER, MANAGER, CASHIER | Creates combined bill and existing pending payment |

## Sprint 8C.1 walk-in billing

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/api/pos-orders/:id/billing-preview` | OWNER, MANAGER, CASHIER | Read-only preview for a confirmed unbilled walk-in order |
| POST | `/api/pos-orders/:id/create-bill` | OWNER, MANAGER, CASHIER | Creates a `WALK_IN` bill and the existing pending payment |

## Sprint 9A members and loyalty

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/api/members`, `/api/members/search` | Authenticated; STAFF receives ACTIVE only | Search by code, display name, phone, or email; optional status/tier filters |
| GET | `/api/members/:id`, `/api/members/:id/points` | Authenticated | Member profile and immutable loyalty ledger |
| POST / PATCH | `/api/members`, `/api/members/:id` | OWNER, MANAGER | Create or update member identity/tier fields |
| PATCH | `/api/members/:id/status` | OWNER, MANAGER | Enable or disable without deleting history |

Walk-in `POST /api/pos-orders` accepts an optional active `memberId`; the server snapshots member code/name. Draft-only `PATCH /api/pos-orders/:id` can change that walk-in member.

## Sprint 9B rewards

| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/api/rewards/preview` | OWNER, MANAGER, CASHIER | Read-only maximum-redeem, discount, and net-total calculation |
| POST | existing table/walk-in create-bill APIs | OWNER, MANAGER, CASHIER | Optional `redeemedPoints`; validation occurs before creating the bill |

Points are deducted only by payment confirmation, not by preview or bill creation.

## Sprint 11 coupons

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/api/coupons` | OWNER, MANAGER (`coupon.view`) | Campaign list with live remaining quota and usage summary |
| POST | `/api/coupons` | OWNER, MANAGER (`coupon.manage`) | Create a campaign; `codeCount` also generates the first voucher batch |
| PATCH | `/api/coupons/:id` | OWNER, MANAGER (`coupon.manage`) | Edit; the discount rule and scope are locked once the coupon has been claimed |
| PATCH | `/api/coupons/:id/status` | OWNER, MANAGER (`coupon.manage`) | DRAFT/ACTIVE/PAUSED/EXPIRED. `DEPLETED` is derived and cannot be set by hand |
| GET / POST | `/api/coupons/:id/codes` | `coupon.view` / `coupon.manage` | List or add printed vouchers (UNIQUE mode only) |
| GET | `/api/coupons/:id/redemptions` | OWNER, MANAGER (`coupon.view`) | The redemption ledger for one campaign, plus its summary |
| POST | `/api/coupons/validate` | Any signed-in role | Check a code against a member and a channel; returns the exact discount when `baseSatang` is supplied |

`/api/coupons/validate` is deliberately open to every role: the cashier typing the code in is the one who needs the answer, and a 403 there would read as a broken coupon. Reserve and apply are not endpoints of their own — they happen inside table start, walk-in order creation and bill creation (Sprint 11.3).

### Sprint 11.3 — coupons on the sale

| Method | Path | Change |
|---|---|---|
| POST | `/api/tables/:id/start` | Optional `couponCode`. Validated before the session exists; if the reservation itself fails the session is cancelled, so a refused coupon never leaves a half-open table. Returns the redemption as `coupon` |
| GET | `/api/table-sessions/:id/billing-preview` | Adds `preview.coupon` (resolved discount, `meetsMinSpend`, the scope base) and `preview.netTotalSatang`. The deposit is measured against the post-coupon total |
| DELETE | `/api/table-sessions/:id/coupon` | Take the coupon off at the counter; the quota is returned and a printed voucher goes back in circulation |
| POST | `/api/table-sessions/:id/create-bill` | Applies the reserved coupon before the deposit. Refuses with `COUPON_POINTS_CONFLICT` (409) if points are also requested |
| POST | `/api/pos-orders/:id/create-bill` | Optional `couponCode` — a walk-in claims and consumes in the one request |
| DELETE | `/api/bills/:id` | Voiding releases the coupon (`BILL_VOIDED`) |

Bills carry `couponRedemptionId`, `couponId`, `couponCode`, `couponName`, `couponScope`, `couponDiscountSatang` and `couponDiscount`. The discount is taken off the part of the bill the scope names and the total is rebuilt from the parts, so `tableChargeSatang + foodAmountSatang === totalSatang` still holds. It is also folded into `bill.discount`, the same way point redemption is, because reporting asks how much was given away rather than by which mechanism.

### Sprint 11.4 — coupon reporting

`GET /api/reports/analytics` gains `couponDiscount`, `couponRedemptions`, `couponsUsed`, `couponMembers`, `topCoupons[]` (name, code, scope, per-channel counts, distinct members, discount given), `topCouponMembers[]`, and `outstandingCouponReservations`.

Coupons are counted **through their bill**, not by their own timestamp: only `APPLIED` redemptions whose bill is in the period's paid-bill set are included. That makes the discount given reconcile exactly with the revenue reported for the same period, including the 06:00 business-day roll and the rule that a table counts on the night it opened. Voiding a paid bill therefore takes its discount back out of the report, because the redemption is released and the bill is no longer paid.

`outstandingCouponReservations` is deliberately **live rather than period-scoped**, the same way `outstandingPoints` is — it answers "what has been claimed and not yet paid for", which is a fact about now, not about the reporting window.

## ย้ายโต๊ะ — moving a running session

| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/api/tables/:id/move` | `table.open` | Moves the running (or paused) session on `:id` to `targetTableId`. The destination must be free |

The session keeps its id, its opened time, its pauses and its `pricingSnapshot` — the customer is charged the rate they were quoted when they sat down, even if the destination table is on a different pricing profile. Re-pricing mid-session would also mean re-cutting the Happy Hour segments around the move.

What follows the session, because it points at the old table by id: the table's POS orders (`CombinedBillingService#ordersForSession` matches on both the table and the session, so without this the food would be orphaned from the bill), the legacy `table.items` list, and the `assignedTableId` of a booking that opened the session. The relays switch: the old table off, the new one on. Every move is audited as `TABLE_SESSION_MOVED` with both table names and how many POS orders travelled, and each one is appended to `session.moves[]`.

Refusals: `NO_ACTIVE_SESSION` (409), `TABLE_NOT_FREE` (409), `SESSION_NOT_MOVABLE` (409, the session is already awaiting payment), `SAME_TABLE` (400), `TABLE_NOT_FOUND` (404).
## Reservation card — early open, table choice, cancel with a deposit decision

| Method | Path | Change |
|---|---|---|
| POST | `/api/reservations/:id/open-now` | Now openable from `BOOKED` and `DUE` as well, for the customer who walks in early. Optional `tableId` picks the table instead of taking the first free one; it must be free and not held for another booking (`TABLE_NOT_FREE`). An early open is recorded on the timeline as `RESERVATION_OPENED_EARLY` |
| PATCH | `/api/reservations/:id/cancel` | Optional `depositAction`: `FORFEIT` (kept, recognised as the shop's income immediately), `REFUND` (given back, never counted as income, OWNER/MANAGER only), or `KEEP` (the previous behaviour and still the default — the deposit is left `AVAILABLE`). Responds with `{ reservation, deposit }` |

Both refusals in `cancel` are checked **before** the booking is cancelled, so a refusal never leaves it cancelled with the deposit in limbo.

`GET /api/reports/analytics` gains `forfeitedDepositSatang` / `forfeitedDepositCount`, `refundedDepositSatang` / `refundedDepositCount`, and `totalIncome`. A forfeited deposit is income but is not a sale, so it is reported on its own line and `revenue` stays bills-only — otherwise `revenue` would stop reconciling against `billCount` and `averageBill`. `totalIncome` is the two added together. A refunded deposit appears in neither, which is the whole reason `FORFEITED` and `REFUNDED` are separate statuses. The reservation dashboard gains `todayForfeitedDepositSatang` on the same basis.
## เปิดโต๊ะแบบกำหนดเวลา — a planned duration on a session

| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/api/tables/:id/start` | `table.open` | Optional `plannedMinutes` sets the limit the customer was quoted |
| POST | `/api/tables/:id/planned-time` | `table.open` | Sets, extends or clears (`0`) the limit on a table that is already running |

**The limit is a reminder and nothing else.** The relay stays on, the table keeps running, and the charge is still whatever time was actually played — running over changes nothing about the bill. The session stores `plannedSeconds` (0 = no limit) and enriched tables carry `plannedSeconds` plus `remainingSeconds`, which is `null` when there is no limit and goes negative once the time is up.

The countdown runs against **billable** seconds, not the wall clock, so pausing the table pauses it — otherwise a table paused for twenty minutes would announce that the customer's time was up while nobody was playing on it. Limits over 24 hours and negative values are refused (`INVALID_PLANNED_TIME`); changing the limit on a table that is not running is refused (`NO_ACTIVE_SESSION` / `SESSION_NOT_RUNNING`).

The limit a table was opened with is recorded on its `TABLE_OPENED` audit entry; later changes get their own `TABLE_PLANNED_TIME_SET`.
