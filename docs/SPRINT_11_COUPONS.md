# Sprint 11 — Coupons

## Scope of this sprint

Members-only coupons that are claimed **when the sale starts** — at table open, or when a walk-in POS sale is rung up — not at checkout. A coupon reserves its quota from that moment and is consumed when the bill is paid. Coupons never combine with loyalty point redemption.

**Which channels a coupon works on is chosen at creation** (owner's decision, 2026-08-21): a `channels` array of `TABLE`, `WALK_IN`, or both. This is the same vocabulary bills already use as `saleSource`, so the rule is checked directly against the sale. A `TABLE_CHARGE`-scope coupon may not be offered on `WALK_IN` — a walk-in bill has no table time on it, so the combination could only ever discount zero, and refusing it at creation beats printing vouchers that silently do nothing at the counter.

## Architecture and lifecycle

`Route → permission middleware → CouponService → JsonCouponRepository → store.json`, with `TableSessionService` reserving at open (or `PosOrderService` on a walk-in sale) and `CombinedBillingService` applying at checkout.

Two independent lifecycles:

**The coupon (the campaign)** — `DRAFT → ACTIVE → PAUSED → ACTIVE → EXPIRED | DEPLETED`. A coupon that has ever been redeemed is never deleted, only paused or expired.

**A redemption** — `RESERVED → APPLIED` or `RESERVED → RELEASED`, plus one way back: `APPLIED → RESERVED` when a bill was created but no valid payment could be attached and the sale was reopened. Releasing there would quietly cost the customer their coupon on a sale that is still in progress.

```
open table  ──► RESERVED   (quota held, code locked, member recorded)
                   │
   pay bill  ──────┼──► APPLIED    (quota consumed, discount on the bill)
                   │
cancel/void ───────┴──► RELEASED   (quota returned, code reusable again)
```

Reserving at open — rather than counting only at payment — is what makes the quota honest. Without it two staff could open two tables on the last remaining voucher and both would succeed.

This mirrors the proven `selectRedeem → redeemPoints → rollbackRedeem` flow in `member-service.js`; the coupon service deliberately copies its shape so both discount sources behave the same way under cancellation.

## JSON model

`coupons[]`, `couponCodes[]`, and `couponRedemptions[]` are additive to `store.json`.

### coupons[]

| Field | Notes |
| --- | --- |
| `id`, `name` | `name` is what prints on the receipt |
| `codeMode` | `SHARED` (one code everybody types) or `UNIQUE` (one code per printed voucher) |
| `code` | The shared code. `SHARED` only; `null` for `UNIQUE` |
| `discountType` | `PERCENT` or `FIXED` |
| `discountValue` | Percent (1–100) or satang |
| `maxDiscountSatang` | Ceiling for `PERCENT`. **Required** when `discountType === "PERCENT"` |
| `scope` | `TABLE_CHARGE`, `PRODUCTS`, or `WHOLE_BILL` |
| `channels` | Subset of `TABLE`, `WALK_IN`. At least one. `TABLE_CHARGE` scope cannot include `WALK_IN` |
| `minSpendSatang` | Checked against the scope base at checkout, not at open |
| `startsAt`, `endsAt` | `YYYY-MM-DD`, inclusive at both ends, in **Bangkok days** — a coupon printed "ใช้ได้ถึง 31 ส.ค." still works at 23:00 on the 31st, which is already 1 September in UTC |
| `totalQuota` | `0` = unlimited. `SHARED` only — for `UNIQUE` the quota *is* the number of codes |
| `usedCount`, `reservedCount` | Denormalised counters; `couponRedemptions[]` remains the source of truth |
| `perMemberLimit` | `0` = unlimited. Defaults to `1` for `SHARED` (a shared code with no limit is one member's licence to use it forever) and to `0` for `UNIQUE` (a printed voucher is already one-use) |
| `status` | `DRAFT`/`ACTIVE`/`PAUSED`/`EXPIRED`/`DEPLETED` |
| `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `version` | Standard |

### couponCodes[] — `UNIQUE` mode only

`{ id, couponId, code, status: UNUSED | RESERVED | USED | VOID, redemptionId, createdAt }`

Generated as a batch at creation time; the operator enters how many vouchers to print. Codes are never re-generated into an existing batch, so a reprint cannot silently duplicate a live code.

### couponRedemptions[] — the ledger

`{ id, couponId, couponCodeId, code, memberId, channel, tableSessionId, posOrderId, billId, status, discountSatang, scopeSnapshot, couponSnapshot, reservedAt, reservedBy, appliedAt, appliedBy, releasedAt, releasedBy, releaseReason }`

Exactly one of `tableSessionId` / `posOrderId` is set, depending on `channel`. Both are used to look up "does this sale already carry a coupon?", which is how a second code on the same sale is refused.

One row per attempt. `couponSnapshot` freezes the rule as it was at reservation so a receipt reprinted months later still shows what was actually given — the same reason `rewardPolicySnapshot` and `pricingSnapshot` exist.

## Code format

Uppercase `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, 8 characters, generated with `crypto.randomInt`. `O`, `0`, `I`, `1`, `L` are excluded on purpose: staff read these off creased paper vouchers and type them on a phone, and a confusable character turns into a support call that looks like a broken coupon.

Input is upper-cased and stripped of spaces and dashes before lookup, so `abcd-2345` matches `ABCD2345`. Codes are unique across all coupons.

## Eligibility — checked in two places

Validation is deliberately split, because half the facts do not exist yet when the table opens.

**At the claim** — table open (`POST /api/tables/:id/start` with `couponCode`) or a walk-in POS sale:

1. Code resolves to a coupon (shared code, or an `UNUSED` unique code).
2. Coupon `status === "ACTIVE"` and today (Bangkok) is within `[startsAt, endsAt]`.
3. The sale's channel is in the coupon's `channels`.
4. Quota remains: `usedCount + reservedCount < totalQuota` (or unlimited / an unused code exists).
5. **A member is bound to the sale, and that member is `ACTIVE`.** No member → refuse.
6. `perMemberLimit` not already reached by that member's `APPLIED` + `RESERVED` rows.
7. The sale does not already carry a coupon.

Each dead end returns its own error code (`COUPON_EXPIRED`, `COUPON_DEPLETED`, `COUPON_CHANNEL_NOT_ALLOWED`, `COUPON_MEMBER_REQUIRED`, `COUPON_MEMBER_LIMIT`, …) rather than one generic refusal, because the cashier's next move differs in each case.

**At checkout** (bill creation):

8. `minSpendSatang` is met by the scope base.
9. No point redemption is selected on this bill.

A coupon that fails step 8 at checkout does **not** block the sale. The redemption is `RELEASED` with reason `MIN_SPEND_NOT_MET`, the bill proceeds without it, and the cashier is told plainly. Blocking payment over a promotion is the wrong trade at a counter with a queue. The same applies when the scope base has nothing left to discount (`NO_DISCOUNT_AVAILABLE`) — handing the voucher back beats burning it for ฿0.

Step 9 is the exception: a genuine conflict between two discounts is not something to resolve silently, so it refuses (`COUPON_POINTS_CONFLICT`) and leaves the reservation intact for the cashier to decide.

### Members only

Refusing non-members is enforced in `CouponService`, not in the dialog. The UI disables the coupon field until a member is chosen, but that is a usability aid only — the same rule the project already applies to permissions.

## Discount calculation

The scope base is resolved against the bill breakdown that already exists:

| `scope` | Base |
| --- | --- |
| `TABLE_CHARGE` | `bill.tableChargeSatang` — already net of any manual ฿ discount |
| `PRODUCTS` | `bill.productSatang` |
| `WHOLE_BILL` | `tableChargeSatang + productSatang` |

```
PERCENT:  discount = min(round(base × value / 100), maxDiscountSatang, base)
FIXED:    discount = min(value, base)
```

Order of operations at checkout: **manual ฿ discount → coupon → (points blocked)**. The manual discount runs first because it is already folded into `tableChargeSatang` before a bill exists; the coupon therefore discounts what is genuinely left to pay and can never drive a line negative.

All arithmetic is integer satang, consistent with the rest of the billing code. Percent discounts round half-up.

## No stacking with points

If a session carries a `RESERVED` coupon, `previewRedeem`/`selectRedeem` refuse with a clear message naming the coupon. If points are already selected on a bill, applying a coupon refuses symmetrically. Neither path silently drops the other.

This is a v1 policy, not a structural limit — the ledger can express both at once if the rule is ever relaxed.

## Interaction with loyalty points earning

None. `calculateTablePoints()` earns from **play time**, not from money, so a coupon changes the bill without changing what the member earns. No decision about gross-vs-net earning is needed.

## API

| Method | Route | Role |
| --- | --- | --- |
| `GET` | `/api/coupons` | OWNER, MANAGER |
| `POST` | `/api/coupons` | OWNER, MANAGER |
| `PATCH` | `/api/coupons/:id` | OWNER, MANAGER |
| `PATCH` | `/api/coupons/:id/status` | OWNER, MANAGER |
| `POST` | `/api/coupons/:id/codes` | OWNER, MANAGER — generate a voucher batch |
| `GET` | `/api/coupons/:id/redemptions` | OWNER, MANAGER |
| `POST` | `/api/coupons/validate` | all roles — preview a code against a member and a channel before the sale starts |

Reserve and apply are not standalone endpoints; they happen inside table start, walk-in order creation and bill creation, so a coupon can never be reserved against a sale that failed to open.

Editing a coupon that already has redemptions may change presentation fields (`name`) and limits going forward, but never `discountType`, `discountValue`, or `scope` — past redemptions keep their snapshot and future ones would silently mean something different.

## UI

**Open-table dialog** — below the existing member search: a coupon input plus an "ตรวจสอบ" button that calls `/api/coupons/validate` and shows the resolved discount in words before the table is opened. Disabled, with an explanatory line, until a member is selected.

**Walk-in POS sale** — the same input and the same rule, on the walk-in order. A coupon whose `channels` exclude `WALK_IN` is refused there with a message that says so, rather than silently doing nothing.

**Coupon form** — a "ใช้ได้ที่" checkbox pair (โต๊ะ / ขายหน้าร้าน) sets `channels`. Ticking ขายหน้าร้าน disables the `TABLE_CHARGE` scope option, since the two cannot be combined.

**Checkout dialog** — the reserved coupon is shown as a read-only line with its computed discount, and a "นำคูปองออก" action that releases it. The points-redemption control is disabled while a coupon is attached, with the reason stated.

**Settings → คูปอง tab** — list, create, edit, pause/resume, generate voucher batches, and a per-coupon usage summary. Follows the existing settings-tab pattern.

**Receipt** — a discount line carrying the coupon `name` and `code`.

## Audit events

`COUPON_CREATED`, `COUPON_UPDATED`, `COUPON_STATUS_CHANGED`, `COUPON_CODES_GENERATED`, `COUPON_RESERVED`, `COUPON_APPLIED`, `COUPON_RELEASED`.

All carry the actor, coupon and redemption references, member and bill where applicable, and the release reason. `docs/AUDIT_EVENTS.md` is updated in the same phase.

## Build order

| Phase | Deliverable |
| --- | --- |
| 11.1 | **Done.** `CouponService` + `JsonCouponRepository` + code generation + validation rules + the reserve/apply/release ledger + unit tests. No UI, no routes, no wiring. |
| 11.2 | **Done.** Settings → คูปอง tab: create, edit, pause, generate batches, usage summary. Routes and the `coupon.view` / `coupon.manage` permissions land here. |
| 11.3 | **Done.** Reserve at table open and on a walk-in POS sale; apply/release at checkout; release on cancel and void; points mutual exclusion; receipt line. |
| 11.4 | Reporting: redemptions per coupon, total discount given, per-member usage. |

Each phase ships as its own branch and PR.

## Deferred

Free-item and buy-one-get-one coupons (needs a cart-level rule engine), automatic promotions with no code (needs promotion precedence), customer segment targeting, and stacking combinations.
