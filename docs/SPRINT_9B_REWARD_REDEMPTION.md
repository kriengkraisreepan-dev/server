# Sprint 9B — Rewards & Point Redemption

## Policy

- Default: one point equals one THB.
- Default minimum redemption: 100 points.
- Partial redemption, table bills, and walk-in bills are separately configurable by OWNER.
- A reward-policy snapshot is stored with every selected redemption.

## Lifecycle

1. Billing preview requests a read-only reward preview.
2. The cashier selects points; the server validates the active member, current balance, policy, source, and bill amount before any bill is created.
3. A new awaiting-payment bill stores selected points, discount, policy snapshot, and net total. No points are deducted yet.
4. Payment confirmation deducts selected points first, then marks payment paid, then earns points from the discounted net total.
5. A void returns redeemed points once and reverses earned points once.

## Additive bill fields

`redeemedPoints`, `redeemValue`, `redeemValueSatang`, `rewardPolicySnapshot`, `memberBalanceBeforeRedeem`, `memberBalanceAfterRedeem`, and idempotency flags are additive. Old bills remain readable.

## API

`POST /api/rewards/preview` accepts `memberId`, amount, sale source, and points and returns maximum points, discount, and net total. It is available to OWNER, MANAGER, and CASHIER only. Existing bill-creation endpoints accept optional `redeemedPoints`.

## Known limitation

There is no partial payment in this sprint. A selected reward is finalized only when the existing single payment is confirmed.

## Table-time loyalty hotfix

Earning is no longer based on spending. Only a paid `TABLE` bill for an active member earns points: complete 60-minute intervals earn five points by default, using FLOOR rounding. Food, drinks, and all walk-in sales earn no points. Walk-in sales also cannot redeem points or display reward information. New bill snapshots record table play seconds/hours, earned table points, and the table-time loyalty policy.
